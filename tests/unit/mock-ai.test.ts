import { describe, expect, it } from "vitest";
import { MockAiProvider } from "@/lib/ai/mock-provider";
import { AiTasks } from "@/lib/ai/tasks";
import { context, parsedIntent, parseInput } from "../support/ai";
const signal = () => new AbortController().signal;
describe("deterministic structured mock assistance", () => {
  it.each([
    ["2026-09-30", "2026-10-04"],
    ["2026-10-04", "2026-10-04"],
    ["2026-12-28", "2027-01-03"],
  ])("ends this week on Sunday from %s", async (referenceDate, endDate) => {
    const result = await new MockAiProvider().complete(
      {
        task: "parse_intent",
        input: { ...parseInput, text: "Coffee this week", referenceDate },
      },
      signal(),
    );
    expect(result).toMatchObject({
      dateHint: { startDate: referenceDate, endDate, text: "this week" },
    });
  });
  it.each([
    "Кофе в Москве послезавтра",
    "Coffee in Bristol day after tomorrow",
  ])("distinguishes day after tomorrow: %s", async (text) => {
    const result = await new MockAiProvider().complete(
      { task: "parse_intent", input: { ...parseInput, text } },
      signal(),
    );
    expect(result).toMatchObject({
      dateHint: { startDate: "2026-10-02", endDate: "2026-10-02" },
    });
    expect(result).toMatchObject({
      location: text.startsWith("Кофе") ? "Москве" : "Bristol",
    });
  });
  it("does not interpret date words embedded in other words", async () => {
    const result = await new MockAiProvider().complete(
      {
        task: "parse_intent",
        input: { ...parseInput, text: "Coffee somedaytomorrow and позавтра" },
      },
      signal(),
    );
    expect(result).toMatchObject({ dateHint: null });
  });
  it("keeps local fallback valid when relative arithmetic exceeds the ISO date range", async () => {
    const tasks = new AiTasks({ provider: null });
    for (const text of [
      "Coffee tomorrow",
      "Coffee day after tomorrow",
      "Coffee this week",
    ]) {
      const result = await tasks.parseIntent({
        ...parseInput,
        text,
        referenceDate: "9999-12-31",
      });
      expect(result).toMatchObject({
        source: "fallback",
        data: { activities: ["coffee"], dateHint: null },
      });
    }
  });
  it("parses activities, local relative dates and literal hints without credentials", async () => {
    const provider = new MockAiProvider();
    const request = { task: "parse_intent" as const, input: parseInput };
    expect(await provider.complete(request, signal())).toEqual(parsedIntent);
    expect(await provider.complete(request, signal())).toEqual(parsedIntent);
  });
  it("keeps unfamiliar intent fields unknown for manual review", async () => {
    expect(
      await new MockAiProvider().complete(
        {
          task: "parse_intent",
          input: { ...parseInput, text: "Something wonderful" },
        },
        signal(),
      ),
    ).toMatchObject({
      type: "general",
      activities: [],
      location: null,
      dateHint: null,
      budgetHint: null,
    });
  });
  it("handles Russian activity/tomorrow and year/leap transitions using explicit dates", async () => {
    const provider = new MockAiProvider();
    for (const [referenceDate, expected] of [
      ["2026-12-31", "2027-01-01"],
      ["2028-02-28", "2028-02-29"],
    ] as const) {
      expect(
        await provider.complete(
          {
            task: "parse_intent",
            input: {
              text: "Кофе завтра",
              referenceDate,
              timeZone: "Pacific/Kiritimati",
            },
          },
          signal(),
        ),
      ).toMatchObject({
        activities: ["coffee"],
        dateHint: { startDate: expected, endDate: expected },
      });
    }
  });
  it("preserves an explicit date and literal currency hint without currency conversion", async () => {
    expect(
      await new MockAiProvider().complete(
        {
          task: "parse_intent",
          input: { ...parseInput, text: "Games on 2026-10-04 up to 2000 JPY" },
        },
        signal(),
      ),
    ).toMatchObject({
      type: "game",
      activities: ["games"],
      dateHint: { startDate: "2026-10-04" },
      budgetHint: "up to 2000 JPY",
    });
  });
  it("offers a human-friendly idea from only public activity", async () => {
    expect(
      await new MockAiProvider().complete(
        { task: "suggest_plan", input: context },
        signal(),
      ),
    ).toMatchObject({
      title: expect.stringMatching(/coffee/i),
      idea: expect.any(String),
    });
    expect(
      await new MockAiProvider().complete(
        {
          task: "suggest_plan",
          input: {
            ...context,
            intent: { ...context.intent, activities: [] },
            proposal: { ...context.proposal, activity: null },
          },
        },
        signal(),
      ),
    ).toMatchObject({ title: "A little time together" });
  });
  it("selects only grounded explanation reasons", async () => {
    const result = await new MockAiProvider().complete(
      { task: "explain_plan", input: context },
      signal(),
    );
    expect(result).toEqual({
      reasons: ["largest_group", "partial", "budget_overlap", "activity"],
    });
  });
  it.each(["", " ".repeat(3), "a".repeat(501)])(
    "rejects invalid input before parsing %#",
    async (text) => {
      await expect(
        new MockAiProvider().complete(
          { task: "parse_intent", input: { ...parseInput, text } },
          signal(),
        ),
      ).rejects.toThrow();
    },
  );
});
