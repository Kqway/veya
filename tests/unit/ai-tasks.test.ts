import { afterEach, describe, expect, it, vi } from "vitest";
import { AiTasks } from "@/lib/ai/tasks";
import { createAiTasks } from "@/lib/ai";
import { MockAiProvider } from "@/lib/ai/mock-provider";
import type { AiProvider } from "@/lib/ai/types";
import { context, parseInput, parsedIntent } from "../support/ai";
const provider = (output: unknown): AiProvider => ({
  name: "openai",
  complete: async () => output,
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("validated optional AI tasks", () => {
  it("accepts valid structured OpenAI output and reports its source", async () => {
    expect(
      await new AiTasks({ provider: provider(parsedIntent) }).parseIntent(
        parseInput,
      ),
    ).toEqual({ data: parsedIntent, source: "openai" });
  });
  it("works in mock mode and falls back without an OpenAI key or network", async () => {
    const fetcher = vi.fn(() => {
      throw new Error("Network must not be used");
    });
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await createAiTasks({ AI_PROVIDER: "mock" }).parseIntent(parseInput))
        .source,
    ).toBe("mock");
    const fallback = createAiTasks({ AI_PROVIDER: "openai" });
    expect(await fallback.parseIntent(parseInput)).toEqual({
      data: parsedIntent,
      source: "fallback",
    });
    expect(
      (await fallback.suggestPlan(context)).data.idea.length,
    ).toBeGreaterThan(0);
    expect((await fallback.explainPlan(context)).data.explanation).toContain(
      "2 of 3",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...parsedIntent, type: "invented" },
    {
      ...parsedIntent,
      dateHint: {
        startDate: "2026-02-30",
        endDate: "2026-03-01",
        text: "soon",
      },
    },
    { ...parsedIntent, unexpected: "data" },
    {
      ...parsedIntent,
      dateHint: {
        startDate: "2026-10-02",
        endDate: "2026-10-01",
        text: "reversed",
      },
    },
  ])("falls back on malformed/schema-invalid output %#", async (output) => {
    expect(
      await new AiTasks({ provider: provider(output) }).parseIntent(parseInput),
    ).toEqual({ data: parsedIntent, source: "fallback" });
  });
  it("never trusts unsupported attendance/budget explanation codes", async () => {
    for (const output of [
      { reasons: ["everyone"] },
      { reasons: ["free_venue"] },
      { reasons: ["largest_group", "largest_group"] },
    ]) {
      const result = await new AiTasks({
        provider: provider(output),
      }).explainPlan(context);
      expect(result.source).toBe("fallback");
      expect(result.data.explanation).toContain("2 of 3");
      expect(result.data.explanation).not.toMatch(/All 3|free/i);
    }
  });
  it("rejects invalid user input rather than hiding it with fallback", async () => {
    const tasks = new AiTasks({ provider: new MockAiProvider() });
    for (const input of [
      { ...parseInput, timeZone: "Invented/Zone" },
      { ...parseInput, text: "" },
      { ...parseInput, name: "not accepted" },
    ])
      await expect(tasks.parseIntent(input)).rejects.toThrow();
    await expect(
      tasks.suggestPlan({
        ...context,
        proposal: { ...context.proposal, availableCount: 5 },
      }),
    ).rejects.toThrow();
  });
  it("falls back on provider failure without returning the error or prompt", async () => {
    const tasks = new AiTasks({
      provider: {
        name: "openai",
        complete: async () => {
          throw new Error("SECRET provider body");
        },
      },
    });
    const result = await tasks.suggestPlan(context);
    expect(result.source).toBe("fallback");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("enforces deadline and aborts even a provider which ignores cancellation", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const tasks = new AiTasks({
      timeoutMs: 25,
      provider: {
        name: "openai",
        complete: async (_, signal) => {
          receivedSignal = signal;
          return new Promise(() => {});
        },
      },
    });
    const pending = tasks.parseIntent(parseInput);
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toEqual({ data: parsedIntent, source: "fallback" });
    expect(receivedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
