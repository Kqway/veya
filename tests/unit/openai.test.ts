import { describe, expect, it, vi } from "vitest";
import { OpenAiProvider } from "@/lib/ai/openai-provider";
import { AiTasks } from "@/lib/ai/tasks";
import { openAiEnvelope, parsedIntent, parseInput } from "../support/ai";
const request = { task: "parse_intent" as const, input: parseInput };
const ok = () =>
  new Response(JSON.stringify(openAiEnvelope(parsedIntent)), {
    headers: { "content-type": "application/json" },
  });
describe("server OpenAI JSON transport", () => {
  it("uses the fixed endpoint, JSON schema, token cap, no storage and caller deadline", async () => {
    let captured: RequestInit | undefined,
      url: string | URL | Request | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      url = input;
      captured = init;
      return ok();
    };
    const signal = new AbortController().signal;
    const provider = new OpenAiProvider({ apiKey: "test-only-key", fetcher });
    expect(await provider.complete(request, signal)).toEqual(parsedIntent);
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(captured?.redirect).toBe("error");
    expect(captured?.signal).toBe(signal);
    const payload = JSON.parse(captured?.body as string);
    expect(payload).toMatchObject({
      model: "gpt-4.1-mini",
      store: false,
      max_completion_tokens: 1000,
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(payload.messages[1].content).toBe(JSON.stringify(parseInput));
    expect(JSON.stringify(payload)).not.toContain("test-only-key");
  });
  it.each([429, 500, 302])(
    "falls back safely on HTTP status %s",
    async (status) => {
      const provider = new OpenAiProvider({
        apiKey: "test-only-key",
        fetcher: async () => new Response("SECRET provider error", { status }),
      });
      const result = await new AiTasks({ provider }).parseIntent(parseInput);
      expect(result).toEqual({ data: parsedIntent, source: "fallback" });
    },
  );
  it.each([
    { choices: [{ finish_reason: "length", message: { content: "{}" } }] },
    {
      choices: [
        { finish_reason: "stop", message: { refusal: "No", content: "{}" } },
      ],
    },
    { choices: [{ finish_reason: "stop", message: { content: "not json" } }] },
    { choices: [] },
  ])("falls back on truncated/refused/invalid envelopes %#", async (body) => {
    const provider = new OpenAiProvider({
      apiKey: "test-only-key",
      fetcher: async () => new Response(JSON.stringify(body)),
    });
    expect(
      (await new AiTasks({ provider }).parseIntent(parseInput)).source,
    ).toBe("fallback");
  });
  it("bounds oversized response envelopes", async () => {
    const provider = new OpenAiProvider({
      apiKey: "test-only-key",
      fetcher: async () => new Response(" ".repeat(65_537)),
    });
    await expect(
      provider.complete(request, new AbortController().signal),
    ).rejects.toThrow();
  });
  it("falls back on network failures and never retries", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("SECRET network error");
    });
    const tasks = new AiTasks({
      provider: new OpenAiProvider({ apiKey: "test-only-key", fetcher }),
    });
    expect((await tasks.parseIntent(parseInput)).source).toBe("fallback");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds a response stream which stalls even when transport ignores abort", async () => {
    vi.useFakeTimers();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    let receivedSignal: AbortSignal | null | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const fetcher: typeof fetch = async (_, init) => {
      receivedSignal = init?.signal;
      return new Response(stream);
    };
    try {
      const tasks = new AiTasks({
        timeoutMs: 25,
        provider: new OpenAiProvider({ apiKey: "test-only-key", fetcher }),
      });
      const pending = tasks.parseIntent(parseInput);
      await vi.advanceTimersByTimeAsync(25);
      expect(await pending).toEqual({ data: parsedIntent, source: "fallback" });
      expect(receivedSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      streamController.close();
      vi.useRealTimers();
    }
  });
});
