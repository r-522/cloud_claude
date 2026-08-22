// File: test/claude.test.ts
import { describe, expect, it } from "vitest";
import { buildRequest, ClientInputError, createClientStream } from "../src/claude";

describe("buildRequest", () => {
  it("adds effort for Haiku 4.5", () => {
    const { body } = buildRequest({
      model: "claude-haiku-4-5",
      effort: "medium",
      messages: [{ role: "user", content: "こんにちは" }],
    });

    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.stream).toBe(true);
  });

  it("adds effort for Sonnet 5", () => {
    const { body } = buildRequest({
      model: "claude-sonnet-5",
      effort: "xhigh",
      messages: [{ role: "user", content: "詳しく説明してください" }],
    });

    expect(body.output_config).toEqual({ effort: "xhigh" });
  });

  it("adds effort for Opus 5", () => {
    const { body } = buildRequest({
      model: "claude-opus-5",
      effort: "high",
      messages: [{ role: "user", content: "検討してください" }],
    });

    expect(body.output_config).toEqual({ effort: "high" });
  });

  it("rejects unknown models", () => {
    expect(() =>
      buildRequest({
        model: "claude-unknown-model",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).toThrow(ClientInputError);
  });

  it("applies all effort levels to Haiku 4.5", () => {
    const levels = ["low", "medium", "high", "xhigh", "max"] as const;
    for (const level of levels) {
      const { body } = buildRequest({
        model: "claude-haiku-4-5",
        effort: level,
        messages: [{ role: "user", content: "test" }],
      });
      expect(body.output_config).toEqual({ effort: level });
    }
  });

  it("applies all effort levels to Sonnet 5", () => {
    const levels = ["low", "medium", "high", "xhigh", "max"] as const;
    for (const level of levels) {
      const { body } = buildRequest({
        model: "claude-sonnet-5",
        effort: level,
        messages: [{ role: "user", content: "test" }],
      });
      expect(body.output_config).toEqual({ effort: level });
    }
  });

  it("applies all effort levels to Opus 5", () => {
    const levels = ["low", "medium", "high", "xhigh", "max"] as const;
    for (const level of levels) {
      const { body } = buildRequest({
        model: "claude-opus-5",
        effort: level,
        messages: [{ role: "user", content: "test" }],
      });
      expect(body.output_config).toEqual({ effort: level });
    }
  });

  it("rejects invalid effort values silently (does not throw, just omits)", () => {
    const { body } = buildRequest({
      model: "claude-sonnet-5",
      effort: "ultra",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body.output_config).toBeUndefined();
  });

  it("omits effort when not provided", () => {
    const { body } = buildRequest({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body.output_config).toBeUndefined();
  });

  it("requires the final message to be from the user", () => {
    expect(() =>
      buildRequest({
        model: "claude-haiku-4-5",
        messages: [{ role: "assistant", content: "回答" }],
      }),
    ).toThrow(ClientInputError);
  });

  it("rejects empty message lists", () => {
    expect(() =>
      buildRequest({ model: "claude-haiku-4-5", messages: [] }),
    ).toThrow(ClientInputError);
  });
});

describe("createClientStream", () => {
  function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let i = 0;
    return new ReadableStream({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(encoder.encode(chunks[i]));
          i++;
        } else {
          controller.close();
        }
      },
    });
  }

  async function collect(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events: unknown[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    for (const line of buffer.split("\n")) {
      if (line.trim()) events.push(JSON.parse(line));
    }
    return events;
  }

  it("converts text deltas to delta events and emits done", async () => {
    const upstream = sseStream([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}\n\n',
      "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
    ]);

    const events = await collect(createClientStream(upstream));
    expect(events).toEqual([
      { type: "delta", text: "Hello" },
      { type: "delta", text: " world" },
      { type: "done" },
    ]);
  });

  it("emits an error event and stops on an error payload", async () => {
    const upstream = sseStream([
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"secret internal detail"}}\n\n',
    ]);

    const events = await collect(createClientStream(upstream));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error" });
    expect(JSON.stringify(events[0])).not.toContain("secret internal detail");
  });
});
