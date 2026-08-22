// File: src/index.ts
import {
  SESSION_COOKIE,
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
  readCookie,
  timingSafeEqual,
  verifySessionToken,
} from "./auth";
import { buildRequest, callClaude, createClientStream, ClientInputError, friendlyUpstreamError } from "./claude";
import { publicModelList } from "./models";

export interface Env {
  CLAUDE_API_KEY?: string;
  SESSION_SECRET?: string;
  ACCESS_CODE?: string;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const DEFAULT_ACCESS_CODE = "1359";

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function isSecure(url: URL): boolean {
  return url.protocol === "https:";
}

async function hasValidSession(request: Request, env: Env): Promise<boolean> {
  if (!env.SESSION_SECRET) return false;
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return verifySessionToken(token, env.SESSION_SECRET);
}

async function handleLogin(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.SESSION_SECRET) {
    console.error("SESSION_SECRET is not configured");
    return json({ error: "サーバーの設定が完了していません。管理者にお問い合わせください。" }, 500);
  }

  let body: { code?: unknown };
  try {
    body = (await request.json()) as { code?: unknown };
  } catch {
    return json({ error: "リクエストの形式が正しくありません。" }, 400);
  }

  const input = typeof body.code === "string" ? body.code : "";
  const expected = env.ACCESS_CODE || DEFAULT_ACCESS_CODE;

  if (!input || !timingSafeEqual(input, expected)) {
    // 総当たりへの気休め程度の緩和
    await new Promise((resolve) => setTimeout(resolve, 400));
    return json({ error: "アクセスコードが正しくありません。" }, 401);
  }

  const token = await createSessionToken(env.SESSION_SECRET);
  return json({ ok: true }, 200, { "set-cookie": buildSessionCookie(token, isSecure(url)) });
}

function handleLogout(url: URL): Response {
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(isSecure(url)) });
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  if (!env.CLAUDE_API_KEY) {
    console.error("CLAUDE_API_KEY is not configured");
    return json({ error: "サーバーの設定が完了していません。管理者にお問い合わせください。" }, 500);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "リクエストの形式が正しくありません。" }, 400);
  }

  if (typeof payload !== "object" || payload === null) {
    return json({ error: "リクエストの形式が正しくありません。" }, 400);
  }

  const { body } = buildRequest(payload as Record<string, unknown>);

  let upstream: Response;
  try {
    upstream = await callClaude(env.CLAUDE_API_KEY, body);
  } catch (err) {
    console.error("upstream fetch failed", err);
    return json({ error: "Claude APIに接続できませんでした。時間をおいて再試行してください。" }, 502);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("anthropic api error", upstream.status, detail.slice(0, 500));
    return json({ error: friendlyUpstreamError(upstream.status) }, upstream.status === 429 ? 429 : 502);
  }

  return new Response(createClientStream(upstream.body), {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function addSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set(
    "content-security-policy",
    [
      "default-src 'self'",
      "base-uri 'none'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
    ].join("; "),
  );
  secured.headers.set("x-content-type-options", "nosniff");
  secured.headers.set("x-frame-options", "DENY");
  secured.headers.set("referrer-policy", "no-referrer");
  return secured;
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;

  if (path === "/api/login" && request.method === "POST") {
    return handleLogin(request, env, url);
  }
  if (path === "/api/logout" && request.method === "POST") {
    return handleLogout(url);
  }
  if (path === "/api/session" && request.method === "GET") {
    return json({ authenticated: await hasValidSession(request, env) });
  }

  const authenticated = await hasValidSession(request, env);
  if (!authenticated) {
    return json({ error: "ログインが必要です。" }, 401);
  }

  if (path === "/api/models" && request.method === "GET") {
    return json({ models: publicModelList() });
  }
  if (path === "/api/chat" && request.method === "POST") {
    return handleChat(request, env);
  }

  return json({ error: "指定されたAPIは見つかりません。" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }
      return addSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (err) {
      if (err instanceof ClientInputError) {
        return json({ error: err.message }, 400);
      }
      console.error("unhandled error", err);
      return json({ error: "予期しないエラーが発生しました。時間をおいて再試行してください。" }, 500);
    }
  },
};
