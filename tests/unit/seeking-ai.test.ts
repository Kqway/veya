import { afterEach, describe, expect, it, vi } from "vitest";
import { AiTasks } from "@/lib/ai/tasks";
import { createAiTasks } from "@/lib/ai";
import { MockAiProvider } from "@/lib/ai/mock-provider";
import { OpenAiProvider } from "@/lib/ai/openai-provider";
import type { AiProvider, ParseInput } from "@/lib/ai/types";
import { openAiEnvelope } from "../support/ai";

const empty = {
  activityKey: null,
  activityLabel: null,
  interactionMode: null,
  format: null,
  city: null,
  area: null,
  skill: null,
  languages: [],
  tags: [],
  timeHint: null,
};
const input: ParseInput = {
  text: "Ищу одного человека для шахмат в Москве, очно, средний уровень, завтра вечером",
  referenceDate: "2026-12-31",
  timeZone: "Europe/Moscow",
};
const chess = {
  ...empty,
  activityKey: "chess",
  activityLabel: "Шахматы",
  interactionMode: "in_person",
  format: "one_to_one",
  city: "Moscow",
  skill: "intermediate",
  timeHint: "2027-01-01 вечером",
};
const provider = (output: unknown): AiProvider => ({
  name: "openai",
  complete: async () => output,
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("optional own-text seeking assistance", () => {
  it("parses the Russian chess example with only advisory time", async () => {
    expect(await new AiTasks({ provider: new MockAiProvider() }).parseSeeking(input))
      .toEqual({ data: chess, source: "mock" });
  });
  it.each([
    ["chess in Moscow online", "chess", "Шахматы"],
    ["Зал", "gym", "Спортзал"],
    ["gym", "gym", "Спортзал"],
    ["Study calculus", "calculus", "Математический анализ"],
    ["Учить матанализ", "calculus", "Математический анализ"],
    ["walking", "walk", "Прогулка"],
    ["прогулка", "walk", "Прогулка"],
    ["board games", "board-games", "Настольные игры"],
    ["настолки", "board-games", "Настольные игры"],
    ["coffee", "coffee", "Кофе"],
    ["кофе", "coffee", "Кофе"],
    ["English practice", "english-practice", "Практика английского"],
    ["Практика английского", "english-practice", "Практика английского"],
    ["football", "football", "Футбол"],
    ["футбол", "football", "Футбол"],
  ])("recognizes the narrow vocabulary: %s", async (text, activityKey, activityLabel) => {
    expect((await new AiTasks().parseSeeking({ ...input, text })).data)
      .toMatchObject({ activityKey, activityLabel });
  });
  it("leaves unfamiliar ideas fully available for manual entry", async () => {
    expect(await new AiTasks().parseSeeking({ ...input, text: "Something wonderful" }))
      .toEqual({ data: empty, source: "fallback" });
  });
  it("does not treat embedded keywords or unspecified games/language as a known activity", async () => {
    for (const text of ["coffeehouse somedaytomorrow", "studious", "games", "English"])
      expect((await new AiTasks().parseSeeking({ ...input, text })).data).toEqual(empty);
  });
  it("structures general study locally without requiring an AI key", async () => {
    expect((await new AiTasks().parseSeeking({ ...input, text: "study" })).data)
      .toEqual({ ...empty, activityKey: "study", activityLabel: "Учёба" });
  });
  it("extracts explicitly written online and one-person preferences", async () => {
    expect((await new AiTasks().parseSeeking({
      ...input, text: "Chess online one-to-one intermediate",
    })).data).toEqual({
      ...empty, activityKey: "chess", activityLabel: "Шахматы",
      interactionMode: "online", format: "one_to_one", skill: "intermediate",
    });
  });
  it.each([
    ["Coffee today evening", "2026-12-31 вечером"],
    ["Кофе сегодня вечером", "2026-12-31 вечером"],
    ["Coffee tomorrow", "2027-01-01"],
    ["Coffee evening", "вечером"],
  ])("resolves local advisory dates for %s", async (text, timeHint) => {
    expect((await new AiTasks().parseSeeking({
      ...input, text, timeZone: "Pacific/Kiritimati",
    })).data.timeHint).toBe(timeHint);
  });
  it("does not misread day after tomorrow as tomorrow", async () => {
    for (const text of ["coffee day after tomorrow", "кофе послезавтра"])
      expect((await new AiTasks().parseSeeking({ ...input, text })).data.timeHint).toBeNull();
  });
  it("keeps a manual fallback valid at the end of the ISO date range", async () => {
    expect((await new AiTasks().parseSeeking({
      ...input, text: "chess tomorrow", referenceDate: "9999-12-31",
    })).data.timeHint).toBeNull();
  });
  it("accepts validated remote suggestions without match decisions", async () => {
    const output = { ...empty, activityKey: "pottery", activityLabel: "Pottery" };
    expect(await new AiTasks({ provider: provider(output) }).parseSeeking(input))
      .toEqual({ data: output, source: "openai" });
  });
  it.each([
    null,
    { activityKey: "chess" },
    { ...chess, activityKey: "Chess" },
    { ...chess, activityKey: "../chess" },
    { ...chess, activityKey: "a".repeat(41) },
    { ...chess, activityLabel: "a".repeat(81) },
    { ...chess, interactionMode: "private" },
    { ...chess, format: "match" },
    { ...chess, city: "a".repeat(61) },
    { ...chess, area: "a".repeat(61) },
    { ...chess, skill: "unknown" },
    { ...chess, languages: ["e"] },
    { ...chess, languages: ["a".repeat(21)] },
    { ...chess, languages: Array(6).fill("en") },
    { ...chess, tags: ["a".repeat(41)] },
    { ...chess, tags: Array(9).fill("tag") },
    { ...chess, timeHint: "a".repeat(81) },
    { ...chess, windows: [{ startAt: "2027-01-01T18:00:00Z" }] },
    { ...chess, candidateId: "private-profile-id", compatible: true },
  ])("falls back on missing, malformed, unbounded or extraneous output %#", async (output) => {
    expect(await new AiTasks({ provider: provider(output) }).parseSeeking(input))
      .toEqual({ data: chess, source: "fallback" });
  });
  it("exports a strict bounded schema that accepts all-null manual fields", async () => {
    const { seekingSuggestionSchema } = await import("@/features/discovery/seeking-suggestion");
    expect(seekingSuggestionSchema.parse(empty)).toEqual(empty);
    expect(seekingSuggestionSchema.safeParse({ ...empty, profile: {} }).success).toBe(false);
    expect(seekingSuggestionSchema.safeParse({ ...empty, activityKey: "" }).success).toBe(false);
  });
  it("rejects private inputs before invoking any provider", async () => {
    let calls = 0;
    const tasks = new AiTasks({ provider: {
      name: "openai", complete: async () => { calls++; return chess; },
    } });
    for (const invalid of [
      { ...input, candidates: [{ profileId: "secret" }] },
      { ...input, profile: { ageBand: "secret" } },
      { ...input, text: "" },
      { ...input, text: "a".repeat(501) },
      { ...input, timeZone: "Invented/Zone" },
      { ...input, referenceDate: "2026-02-30" },
    ]) await expect(tasks.parseSeeking(invalid)).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it("works without a key or network and exposes no provider errors", async () => {
    const fetcher = vi.fn(() => { throw new Error("SECRET key prompt"); });
    vi.stubGlobal("fetch", fetcher);
    expect(await createAiTasks({ AI_PROVIDER: "openai" }).parseSeeking(input))
      .toEqual({ data: chess, source: "fallback" });
    expect(fetcher).not.toHaveBeenCalled();
    const result = await new AiTasks({ provider: {
      name: "openai", complete: async () => { throw new Error("SECRET key prompt"); },
    } }).parseSeeking(input);
    expect(result).toEqual({ data: chess, source: "fallback" });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("enforces the deadline even when the provider ignores cancellation", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const tasks = new AiTasks({ timeoutMs: 25, provider: {
      name: "openai", complete: async (_, signal) => {
        receivedSignal = signal;
        return new Promise(() => {});
      },
    } });
    const pending = tasks.parseSeeking(input);
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toEqual({ data: chess, source: "fallback" });
    expect(receivedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("sends only text and local date context with the strict schema and transport bounds", async () => {
    let captured: RequestInit | undefined;
    const fetcher: typeof fetch = async (_, init) => {
      captured = init;
      return new Response(JSON.stringify(openAiEnvelope(chess)));
    };
    const tasks = new AiTasks({ provider: new OpenAiProvider({ apiKey: "test-secret", fetcher }) });
    expect(await tasks.parseSeeking(input)).toEqual({ data: chess, source: "openai" });
    const payload = JSON.parse(captured?.body as string);
    expect(payload.messages[1].content).toBe(JSON.stringify(input));
    expect(payload).toMatchObject({
      store: false, max_completion_tokens: 1000,
      response_format: { type: "json_schema", json_schema: {
        name: "parse_seeking", strict: true,
        schema: { additionalProperties: false, required: Object.keys(empty) },
      } },
    });
    expect(captured?.redirect).toBe("error");
    expect(captured?.signal?.aborted).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/test-secret|candidateId|profileId|startAt/);
  });
  it.each([
    "not json",
    JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "not json" } }] }),
    " ".repeat(65_537),
  ])("falls back on malformed or oversized remote content without retry %#", async (body) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(body));
    expect(await new AiTasks({ provider: new OpenAiProvider({ apiKey: "test-secret", fetcher }) })
      .parseSeeking(input)).toEqual({ data: chess, source: "fallback" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
