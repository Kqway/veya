import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interpretConversation } from "@/features/intent-product/parser";
import { interpretationSchema } from "@/features/intent-product/schema";
import { createAiTasks } from "@/lib/ai";
import { AiTasks } from "@/lib/ai/tasks";
import { OpenAiProvider } from "@/lib/ai/openai-provider";
import type { AiProvider } from "@/lib/ai/types";
import { openAiEnvelope } from "../support/ai";

const input = { text: "Дота завтра вечером, нужен пятый, саппорт не ниже легенды", timezone: "Europe/Moscow", referenceDate: "2026-10-04" };
const provider = (output: unknown): AiProvider => ({ name: "openai", complete: async () => output });
// These parsing fixtures refer to tomorrow relative to this date. The production
// parser correctly rejects elapsed windows; the suite must own its wall clock.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-04T09:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("optional own conversation AI interpretation", () => {
  it("uses the deterministic parser in mock mode without network", async () => {
    const fetcher = vi.fn(() => { throw new Error("No network"); });
    vi.stubGlobal("fetch", fetcher);
    const result = await createAiTasks({ AI_PROVIDER: "mock" }).interpretConversation(input);
    expect(result).toEqual({ data: interpretConversation(input), source: "mock" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts bounded normalization and preserves the owner's original text", async () => {
    const normalized = "Завтра вечером Дота, нужен пятый, саппорт не ниже легенды.";
    const result = await new AiTasks({ provider: provider({ text: normalized }) }).interpretConversation(input);
    expect(result).toEqual({ data: interpretConversation(input), source: "openai" });
    expect(interpretationSchema.safeParse(result.data).success).toBe(true);
  });

  it("normalizes an obvious own activity synonym without supplying city or time", async () => {
    const own = { ...input, text: "В качалку завтра вечером в Москве" };
    expect(interpretConversation(own).kind).toBe("clarification");
    const result = await new AiTasks({ provider: provider({ text: "В зал завтра вечером в Москве" }) }).interpretConversation(own);
    expect(result.source).toBe("openai");
    expect(result.data.kind).toBe("draft");
    if (result.data.kind !== "draft") throw new Error("Expected a reviewed draft");
    expect(result.data.draft.seeking).toMatchObject({ activityKey: "gym", city: "Moscow", rawText: own.text });
    expect(result.data.draft.seeking.availability).toEqual([{ startAt: "2026-10-05T15:00:00.000Z", endAt: "2026-10-05T20:00:00.000Z" }]);
  });

  it.each([
    { text: "Дота завтра вечером, нужен пятый, саппорт не ниже титана" },
    { text: "Дота 2026-10-05 с 18 до 23, нужен пятый, саппорт не ниже легенды" },
    { text: "Дота сегодня вечером, нужен пятый, саппорт не ниже легенды" },
    { text: "Дота завтра вечером, нужен пятый, саппорт не ниже легенды", candidateId: "foreign" },
    { text: "x".repeat(501) },
    { text: "стоп" },
    { text: "не присылай предложения" },
    null,
  ])("falls back when normalization invents conditions or actions %#", async (output) => {
    expect(await new AiTasks({ provider: provider(output) }).interpretConversation(input)).toEqual({ data: interpretConversation(input), source: "fallback" });
  });

  it.each([
    ["В зал завтра вечером", "В зал завтра вечером в Москве"],
    ["Дота завтра", "Дота завтра вечером"],
    ["Дота 2026-02-30 вечером", "Дота завтра вечером"],
  ])("keeps missing or invalid critical conditions unknown (%s)", async (text, normalized) => {
    const own = { ...input, text };
    expect(await new AiTasks({ provider: provider({ text: normalized }) }).interpretConversation(own)).toEqual({ data: interpretConversation(own), source: "fallback" });
  });

  it("rejects extra input and invalid dates before consulting any provider", async () => {
    const complete = vi.fn(async () => ({ text: input.text }));
    const tasks = new AiTasks({ provider: { name: "openai", complete } });
    for (const invalid of [{ ...input, referenceDate: "2026-02-30" }, { ...input, timezone: "Invented/Zone" }, { ...input, candidates: [] }]) {
      await expect(tasks.interpretConversation(invalid)).rejects.toThrow();
    }
    expect(complete).not.toHaveBeenCalled();
  });

  it("uses strict JSON with only the own input, no storage and existing response limits", async () => {
    let captured: RequestInit | undefined;
    const fetcher: typeof fetch = async (_, init) => { captured = init; return new Response(JSON.stringify(openAiEnvelope({ text: input.text }))); };
    const result = await new AiTasks({ provider: new OpenAiProvider({ apiKey: "test-only-key", fetcher }) }).interpretConversation(input);
    expect(result.source).toBe("openai");
    const payload = JSON.parse(captured?.body as string);
    expect(payload).toMatchObject({ store: false, max_completion_tokens: 1000, response_format: { type: "json_schema", json_schema: { name: "parse_conversation", strict: true, schema: { additionalProperties: false, required: ["text"], properties: { text: { maxLength: 500 } } } } } });
    expect(JSON.parse(payload.messages[1].content)).toEqual(input);
    expect(captured?.redirect).toBe("error");
    expect(JSON.stringify(payload)).not.toContain("test-only-key");
  });

  it("falls back once on oversized transport, provider errors and missing key", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(" ".repeat(65_537)));
    const tasks = new AiTasks({ provider: new OpenAiProvider({ apiKey: "test-only-key", fetcher }) });
    expect(await tasks.interpretConversation(input)).toEqual({ data: interpretConversation(input), source: "fallback" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await createAiTasks({ AI_PROVIDER: "openai" }).interpretConversation(input)).toEqual({ data: interpretConversation(input), source: "fallback" });
    expect(await new AiTasks({ provider: { name: "openai", complete: async () => { throw new Error("SECRET provider failure"); } } }).interpretConversation(input)).toEqual({ data: interpretConversation(input), source: "fallback" });
  });

  it("aborts stalled interpretation and uses the deterministic fallback", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const tasks = new AiTasks({ timeoutMs: 25, provider: { name: "openai", complete: async (_, currentSignal) => { signal = currentSignal; return new Promise(() => {}); } } });
    const pending = tasks.interpretConversation(input);
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toEqual({ data: interpretConversation(input), source: "fallback" });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
