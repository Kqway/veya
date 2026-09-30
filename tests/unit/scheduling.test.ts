import { describe, expect, it } from "vitest";
import { suggest } from "@/features/scheduling/engine";
import type {
  SchedulingInput,
  SchedulingParticipant,
} from "@/features/scheduling/types";
const at = (hour: number, day = "2026-10-01") =>
  `${day}T${String(hour).padStart(2, "0")}:00:00Z`;
const window = (start: number, end: number) => ({
  startAt: at(start),
  endAt: at(end),
});
const person = (id: string, start = 9, end = 12): SchedulingParticipant => ({
  id,
  availability: [window(start, end)],
  preferences: [],
  budgetMin: null,
  budgetMax: null,
  currency: null,
});
const input = (participants: SchedulingParticipant[]): SchedulingInput => ({
  participants,
  durationMinutes: 60,
  from: at(0),
  until: at(0, "2026-10-08"),
});
describe("deterministic scheduling", () => {
  it("finds the full group and distinct non-overlapping alternatives", () => {
    const result = suggest(
      input([person("a", 9, 16), person("b", 10, 15), person("c", 10, 15)]),
    );
    expect(result.bestMatch?.availableParticipantIds).toEqual(["a", "b", "c"]);
    const all = [result.bestMatch!, ...result.alternatives];
    expect(result.alternatives.length).toBe(3);
    for (const [i, a] of all.entries()) {
      expect(Date.parse(a.window.endAt) - Date.parse(a.window.startAt)).toBe(
        3600000,
      );
      for (const b of all.slice(i + 1))
        expect(
          Date.parse(a.window.endAt) <= Date.parse(b.window.startAt) ||
            Date.parse(b.window.endAt) <= Date.parse(a.window.startAt),
        ).toBe(true);
    }
  });
  it("offers maximum partial-group compromises rather than no matches", () => {
    const result = suggest(
      input([person("a", 9, 12), person("b", 10, 13), person("c", 18, 20)]),
    );
    expect(result.bestMatch?.availableParticipantIds).toHaveLength(2);
    expect(result.bestMatch?.explanation).toMatch(/2 of 3/);
    const disjoint = suggest(input([person("a", 9, 10), person("b", 18, 19)]));
    expect(disjoint.bestMatch?.availableParticipantIds).toHaveLength(1);
    expect(disjoint.bestMatch?.explanation).toMatch(
      /Nothing works for everyone/,
    );
  });
  it("handles zero, missing and past availability with actionable guidance", () => {
    expect(suggest(input([]))).toMatchObject({
      bestMatch: null,
      alternatives: [],
      message: expect.stringMatching(/availability/i),
    });
    expect(
      suggest(input([{ ...person("a"), availability: [] }])).bestMatch,
    ).toBeNull();
    const past = {
      ...person("a"),
      availability: [
        { startAt: at(9, "2026-09-01"), endAt: at(10, "2026-09-01") },
      ],
    };
    expect(suggest(input([past])).message).toMatch(/future/i);
  });
  it("handles single participants and multiple merged windows without double counting", () => {
    const a = {
      ...person("a"),
      availability: [
        { startAt: at(9), endAt: "2026-10-01T09:30:00Z" },
        { startAt: "2026-10-01T09:30:00Z", endAt: at(10) },
        window(18, 21),
      ],
    };
    expect(
      suggest(input([a, person("b", 9, 10)])).bestMatch
        ?.availableParticipantIds,
    ).toEqual(["a", "b"]);
    expect(
      suggest(input([person("a")])).bestMatch?.availableParticipantIds,
    ).toEqual(["a"]);
  });
  it("returns shorter real shared periods and marks partial attendance honestly", () => {
    const b = {
      ...person("b"),
      availability: [
        { startAt: "2026-10-01T09:20:00Z", endAt: "2026-10-01T09:50:00Z" },
      ],
    };
    const result = suggest(input([person("a", 9, 10), b]));
    expect(result.bestMatch).toMatchObject({
      availableParticipantIds: ["a", "b"],
      shortened: true,
      durationMinutes: 30,
    });
    const tiny = {
      ...person("a"),
      availability: [{ startAt: at(9), endAt: "2026-10-01T09:05:00Z" }],
    };
    expect(suggest(input([tiny])).bestMatch?.durationMinutes).toBe(5);
  });
  it("prefers compatible budgets without dropping people or comparing currencies", () => {
    const people = [
      {
        ...person("a", 9, 12),
        budgetMin: 1000,
        budgetMax: 2000,
        currency: "USD",
      },
      {
        ...person("b", 9, 12),
        budgetMin: 3000,
        budgetMax: 4000,
        currency: "USD",
      },
      {
        ...person("c", 18, 21),
        budgetMin: 0,
        budgetMax: 5000,
        currency: "USD",
      },
      {
        ...person("d", 18, 21),
        budgetMin: 2000,
        budgetMax: 4000,
        currency: "USD",
      },
    ];
    expect(suggest(input(people)).bestMatch).toMatchObject({
      availableParticipantIds: ["c", "d"],
      budgetAssessment: "compatible",
    });
    expect(
      suggest(input([{ ...people[0]!, currency: "JPY" }, people[1]!])).bestMatch
        ?.budgetAssessment,
    ).toBe("different-currencies");
    expect(suggest(input([person("a")])).bestMatch?.budgetAssessment).toBe(
      "unknown",
    );
  });
  it("scores shared/requested preferences only after attendance", () => {
    const preference = (value: string) => [
      { category: "activity" as const, value },
    ];
    const people = [
      { ...person("a", 9, 12), preferences: preference("coffee") },
      { ...person("b", 9, 12), preferences: preference("coffee") },
      { ...person("c", 18, 21), preferences: preference("games") },
      { ...person("d", 18, 21), preferences: preference("walk") },
    ];
    expect(
      suggest({ ...input(people), activities: ["coffee"] }).bestMatch,
    ).toMatchObject({
      availableParticipantIds: ["a", "b"],
      activity: "coffee",
    });
    const more = {
      ...person("e", 18, 21),
      preferences: preference("walk"),
      budgetMin: 999999,
      currency: "JPY",
      budgetMax: null,
    };
    expect(
      suggest({ ...input([...people, more]), activities: ["coffee"] }).bestMatch
        ?.availableParticipantIds,
    ).toHaveLength(3);
  });
  it("never promotes a private activity preference to a public proposal label", () => {
    const people = [
      {
        ...person("a"),
        preferences: [
          {
            category: "activity" as const,
            value: "private sensitive activity",
          },
        ],
      },
      person("b"),
    ];
    const result = suggest(input(people));
    for (const proposal of [result.bestMatch!, ...result.alternatives])
      expect(proposal.activity).toBeNull();
    expect(JSON.stringify(result)).not.toContain("private sensitive activity");
  });
  it("finds shared short spans even when unrelated windows split their boundaries", () => {
    const span = (start: string, end: string) => ({
      startAt: `2026-10-01T${start}:00Z`,
      endAt: `2026-10-01T${end}:00Z`,
    });
    const people = [
      { ...person("a"), availability: [span("09:00", "09:40")] },
      { ...person("b"), availability: [span("09:00", "09:40")] },
      { ...person("c"), availability: [span("09:10", "09:20")] },
      { ...person("d"), availability: [span("09:25", "09:35")] },
      person("e", 8, 12),
    ];
    expect(suggest(input(people)).bestMatch).toMatchObject({
      availableParticipantIds: ["a", "b", "e"],
      durationMinutes: 40,
      shortened: true,
    });
  });
  it("normalizes offset/DST instants and exact boundaries without timezone math", () => {
    const a = {
      ...person("a"),
      availability: [
        {
          startAt: "2026-10-01T12:00:00+03:00",
          endAt: "2026-10-01T13:00:00+03:00",
        },
      ],
    };
    expect(suggest(input([a, person("b", 9, 10)])).bestMatch?.window).toEqual({
      startAt: "2026-10-01T09:00:00.000Z",
      endAt: "2026-10-01T10:00:00.000Z",
    });
    const dst = {
      ...input([a]),
      from: "2026-03-08T06:00:00Z",
      until: "2026-03-09T06:00:00Z",
      participants: [
        {
          ...person("a"),
          availability: [
            {
              startAt: "2026-03-08T01:30:00-05:00",
              endAt: "2026-03-08T03:30:00-04:00",
            },
          ],
        },
      ],
    };
    expect(suggest(dst).bestMatch?.durationMinutes).toBe(60);
  });
  it("is invariant to participant/window order and never mutates input", () => {
    const data = input([person("b", 9, 14), person("a", 10, 15)]),
      before = JSON.stringify(data);
    expect(suggest(data)).toEqual(
      suggest({ ...data, participants: [...data.participants].reverse() }),
    );
    expect(JSON.stringify(data)).toBe(before);
  });
  it.each([
    { durationMinutes: 0 },
    { until: at(0) },
    { from: "no date" },
    { durationMinutes: 1441 },
  ])("rejects malformed search input %#", (patch) => {
    expect(() => suggest({ ...input([person("a")]), ...patch })).toThrow();
  });
});
