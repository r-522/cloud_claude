// File: src/claude.ts
/**
 * Anthropic Messages API 呼び出しとストリーミング変換。
 * 参照: platform.claude.com/docs/en/api/messages, .../build-with-claude/streaming
 */
import { findModel, isValidEffort, type EffortLevel } from "./models";

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const MAX_TOKENS = 8192;
export const MAX_MESSAGES = 40;

export class ClientInputError extends Error {}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  stream: true;
  messages: ChatMessage[];
  output_config?: { effort: EffortLevel };
}

export interface ChatRequestInput {
  model?: unknown;
  effort?: unknown;
  messages?: unknown;
}

export interface ValidatedChat {
  body: AnthropicRequestBody;
}

/** クライアント入力を検証し、Anthropic APIへのリクエストボディを組み立てる */
export function buildRequest(input: ChatRequestInput): ValidatedChat {
  const model = findModel(input.model);
  if (!model) {
    throw new ClientInputError("選択されたモデルは利用できません。");
  }

  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new ClientInputError("メッセージが空です。");
  }
  if (input.messages.length > MAX_MESSAGES) {
    throw new ClientInputError("会話が長くなりすぎました。新しい会話を開始してください。");
  }

  const messages: ChatMessage[] = [];
  for (const raw of input.messages) {
    if (typeof raw !== "object" || raw === null) {
      throw new ClientInputError("メッセージ形式が不正です。");
    }
    const role = (raw as Record<string, unknown>).role;
    const content = (raw as Record<string, unknown>).content;
    if (role !== "user" && role !== "assistant") {
      throw new ClientInputError("メッセージ形式が不正です。");
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new ClientInputError("空のメッセージは送信できません。");
    }
    messages.push({ role, content });
  }

  if (messages[messages.length - 1]?.role !== "user") {
    throw new ClientInputError("メッセージの順序が正しくありません。");
  }

  const body: AnthropicRequestBody = {
    model: model.id,
    max_tokens: MAX_TOKENS,
    stream: true,
    messages,
  };

  // effort は対応モデルかつ有効な値のときだけ採用する（非対応モデルへは送信しない）
  if (model.supportsEffort && input.effort !== undefined && isValidEffort(input.effort)) {
    body.output_config = { effort: input.effort };
  }

  return { body };
}

function encodeLine(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
}

interface ParsedSseEvent {
  event: string;
  data: string;
}

function parseSseBlock(block: string): ParsedSseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function extractTextDelta(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (obj.type !== "content_block_delta") return null;
  const delta = obj.delta;
  if (typeof delta !== "object" || delta === null) return null;
  const d = delta as Record<string, unknown>;
  if (d.type !== "text_delta" || typeof d.text !== "string") return null;
  return d.text;
}

/**
 * Anthropicの生SSEをそのままブラウザへ転送せず、
 * 安全な最小限のNDJSONイベント（delta / done / error）へ変換する。
 */
export function createClientStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let sentDone = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            const parsed = parseSseBlock(block);
            if (!parsed) continue;

            if (parsed.event === "error") {
              console.error("anthropic stream error event");
              controller.enqueue(
                encodeLine({ type: "error", message: "応答の生成中にエラーが発生しました。" }),
              );
              sentDone = true;
              controller.close();
              return;
            }

            let data: unknown;
            try {
              data = JSON.parse(parsed.data);
            } catch {
              continue;
            }

            if (typeof data === "object" && data !== null && (data as Record<string, unknown>).type === "error") {
              console.error("anthropic error payload", JSON.stringify(data).slice(0, 500));
              controller.enqueue(
                encodeLine({ type: "error", message: "応答の生成中にエラーが発生しました。" }),
              );
              sentDone = true;
              controller.close();
              return;
            }

            const text = extractTextDelta(data);
            if (text !== null) {
              controller.enqueue(encodeLine({ type: "delta", text }));
            }
          }
        }

        if (!sentDone) {
          controller.enqueue(encodeLine({ type: "done" }));
        }
        controller.close();
      } catch (err) {
        console.error("stream relay failed", err);
        try {
          controller.enqueue(
            encodeLine({ type: "error", message: "通信が中断されました。もう一度お試しください。" }),
          );
        } catch {
          /* controller already closed */
        }
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

export async function callClaude(apiKey: string, body: AnthropicRequestBody): Promise<Response> {
  return fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
}

/** 上流のステータスコードを、内部情報を含まないユーザー向け文言へ変換する */
export function friendlyUpstreamError(status: number): string {
  if (status === 400) return "リク���ストの内容が受け付けられませんでした。入力を短くして再試行してください。";
  if (status === 401 || status === 403) return "サーバー側の設定に問題があります。管理者にお問い合わせください。";
  if (status === 404) return "指定されたモデルを利用できません。別のモデルを選択してください。";
  if (status === 413) return "入力が長すぎます。会話を新しく開始するか、内容を短くしてください。";
  if (status === 429) return "現在混み合っています。しばらく待ってから再試行してください。";
  if (status === 529) return "サービスが一時的に混雑しています。時間をおいて再試行してください。";
  if (status >= 500) return "応答の生成に失敗しました。時間をおいて再試行してください。";
  return "応答の生成に失敗しました。時間をおいて再試行してください。";
}
