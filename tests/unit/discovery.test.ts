import { describe, expect, it } from "vitest";
import { hasFutureOverlap, rankCompatible } from "@/features/discovery/engine";
import type { SeekingCandidate } from "@/features/discovery/types";

const now = "2026-10-01T08:00:00Z";
const at = (time: string, day = "2026-10-01") => `${day}T${time}:00Z`;
const window = (start: string, end: string, day?: string) => ({
  startAt: at(start, day), endAt: at(end, day),
});
const post = (id: string, patch: Partial<SeekingCandidate> = {}): SeekingCandidate => ({
  id, profileId: `profile-${id}`, activityKey: "chess", activityLabel: "Chess",
  interactionMode: "in_person", format: "one_to_one", city: "Moscow", area: "Central",
  availability: [window("09:00", "10:00")], skill: "casual", languages: ["ru"],
  tags: [], ageBand: "25–34", desiredAgeBands: [], groupSize: null,
  expiresAt: at("08:00", "2026-10-08"), status: "active", ...patch,
});
const source = () => post("source");
const ranked = (candidate: SeekingCandidate, sourcePost = source()) =>
  rankCompatible(sourcePost, [candidate], { now });
const ids = (candidates: readonly SeekingCandidate[], sourcePost = source()) =>
  rankCompatible(sourcePost, candidates, { now }).map((item) => item.candidate.id);

describe("deterministic discovery compatibility", () => {
  it("returns internal candidates with coarse reasons and time hints", () => {
    const candidate = post("target");
    expect(ranked(candidate)).toEqual([{
      candidate, score: expect.any(Number),
      reasons: expect.arrayContaining(["SAME_ACTIVITY", "TIME_OVERLAP", "SHARED_LANGUAGE", "FORMAT_COMPATIBLE"]),
      timeHint: "Compatible today",
    }]);
    const { reasons, timeHint } = ranked(candidate)[0]!;
    expect(JSON.stringify({ reasons, timeHint })).not.toMatch(/Moscow|Central|09:00|profile-target|25–34/);
  });
  it("normalizes activity keys rather than matching labels or substrings", () => {
    expect(ids([post("yes", { activityKey: "  CHESS  ", activityLabel: "Another label" }),
      post("no", { activityKey: "chess-club", activityLabel: "Chess" })])).toEqual(["yes"]);
  });
  it("excludes self posts, own profiles, blocked, closed, and expired candidates", () => {
    const candidates = [source(), post("own", { profileId: source().profileId }),
      post("blocked"), post("closed", { status: "closed" }),
      post("expired", { expiresAt: now }), post("ok")];
    expect(rankCompatible(source(), candidates, { now, blockedProfileIds: ["profile-blocked"] })
      .map((entry) => entry.candidate.id)).toEqual(["ok"]);
    expect(ids([post("ok")], post("source", { status: "closed" }))).toEqual([]);
    expect(ids([post("ok")], post("source", { expiresAt: now }))).toEqual([]);
  });
  it.each([
    ["in_person", "in_person", "Moscow", "Москва", true],
    ["in_person", "either", "Moscow", " mOsCoW ", true],
    ["either", "in_person", "Moscow", "London", false],
    ["in_person", "online", "Moscow", null, false],
    ["online", "in_person", null, "Moscow", false],
    ["online", "online", null, "London", true],
    ["online", "either", null, "London", true],
    ["either", "online", "Moscow", null, true],
    ["either", "either", "Moscow", "London", true],
    ["in_person", "in_person", "Saint Petersburg", "saint petersburg", true],
    ["in_person", "in_person", "Moscow", "Moscow region", false],
  ] as const)("intersects modes and cities %s/%s", (a, b, cityA, cityB, compatible) => {
    expect(ranked(post("target", { interactionMode: b, city: cityB }),
      post("source", { interactionMode: a, city: cityA }))).toHaveLength(compatible ? 1 : 0);
  });
  it.each([
    ["one_to_one", "group", null, null, false],
    ["group", "one_to_one", null, null, false],
    ["group", "group", 4, 5, false],
    ["group", "group", 4, 4, true],
    ["group", "either", 4, null, true],
    ["either", "group", null, 4, true],
    ["either", "group", 4, 5, false],
    ["either", "either", 4, 5, true],
    ["one_to_one", "either", null, 4, true],
  ] as const)("intersects format and group sizes %s/%s", (a, b, sizeA, sizeB, compatible) => {
    expect(ranked(post("target", { format: b, groupSize: sizeB }),
      post("source", { format: a, groupSize: sizeA }))).toHaveLength(compatible ? 1 : 0);
  });
  it("requires shared normalized language", () => {
    expect(ranked(post("target", { languages: ["EN", " RU "] }))).toHaveLength(1);
    expect(ranked(post("target", { languages: ["en"] }))).toEqual([]);
  });
  it("applies mutual coarse age restrictions, rejecting unknown restricted ages", () => {
    expect(ranked(post("target", { desiredAgeBands: ["35–44"] }))).toEqual([]);
    const restricted = post("source", { desiredAgeBands: ["35–44"] });
    expect(ranked(post("target", { ageBand: "35–44" }), restricted)).toHaveLength(1);
    expect(ranked(post("target", { ageBand: null }), restricted)).toEqual([]);
    expect(ranked(post("target", { ageBand: null }))).toHaveLength(1);
    expect(ranked(post("target", { desiredAgeBands: ["25–34"] }),
      post("source", { ageBand: null }))).toEqual([]);
  });
  it.each([
    ["09:00", "09:14", 0], ["09:00", "09:15", 1], ["10:00", "11:00", 0],
  ])("requires at least 15 real continuous minutes %s–%s", (start, end, count) => {
    expect(ranked(post("target", { availability: [window(start, end)] }))).toHaveLength(count);
  });
  it("does not combine separated sub-15-minute overlaps", () => {
    expect(ranked(post("target", { availability: [window("09:00", "09:10"), window("09:20", "09:30")] }))).toEqual([]);
  });
  it("clips overlap to now and both expiries", () => {
    const early = post("source", { availability: [window("07:00", "08:10")] });
    expect(ranked(post("target", { availability: [window("07:00", "08:10")] }), early)).toEqual([]);
    expect(ranked(post("target", { expiresAt: at("09:10") }))).toEqual([]);
    expect(ranked(post("target"), post("source", { expiresAt: at("09:10") }))).toEqual([]);
    expect(ranked(post("target", { expiresAt: at("09:15") }))).toHaveLength(1);
  });
  it("normalizes offset instants before intersecting", () => {
    expect(ranked(post("target", { availability: [{ startAt: "2026-10-01T12:00:00+03:00", endAt: "2026-10-01T13:00:00+03:00" }] }))).toHaveLength(1);
  });
  it.each([
    ["2026-10-01", "Compatible today"], ["2026-10-02", "Compatible tomorrow"],
    ["2026-10-06", "Compatible this week"], ["2026-10-09", "Compatible soon"],
  ])("returns only coarse time hints for %s", (day, timeHint) => {
    const availability = [window("09:00", "10:00", day)];
    const expiry = at("08:00", "2026-10-20");
    expect(ranked(post("target", { availability, expiresAt: expiry }),
      post("source", { availability, expiresAt: expiry }))[0]?.timeHint).toBe(timeHint);
  });
  it("uses the first qualifying overlap, ignoring earlier short overlaps", () => {
    const availability = [window("09:00", "09:10"), window("09:00", "10:00", "2026-10-02")];
    expect(ranked(post("target", { availability }))[0]?.timeHint).toBeUndefined();
    expect(ranked(post("target", { availability }), post("source", { availability }))[0]?.timeHint).toBe("Compatible tomorrow");
  });
});

describe("discovery scoring and determinism", () => {
  it("ranks similar known skill over large gaps without hard filtering", () => {
    const results = rankCompatible(source(), [post("expert", { skill: "expert" }),
      post("near", { skill: "beginner" }), post("same")], { now });
    expect(results.map((r) => r.candidate.id)).toEqual(["same", "near", "expert"]);
    expect(results[0]!.reasons).toContain("SKILL_COMPATIBLE");
    expect(results[2]!.reasons).not.toContain("SKILL_COMPATIBLE");
    expect(ranked(post("target", { skill: "any" }))[0]!.reasons).not.toContain("SKILL_COMPATIBLE");
  });
  it("ranks shared tags and normalized coarse areas without exposing their values", () => {
    const s = post("source", { tags: ["relaxed", "outdoors"] });
    const results = rankCompatible(s, [post("neither", { area: "North" }),
      post("area"), post("both", { tags: [" RELAXED "] })], { now });
    expect(results.map((r) => r.candidate.id)).toEqual(["both", "area", "neither"]);
    expect(results[0]!.reasons).toEqual(expect.arrayContaining(["SAME_AREA", "SHARED_INTEREST"]));
    expect(ranked(post("target", { area: " central " }))[0]!.reasons).toContain("SAME_AREA");
    expect(ranked(post("target", { interactionMode: "online" }),
      post("source", { interactionMode: "online" }))[0]!.reasons).not.toContain("SAME_AREA");
    expect(ranked(post("target", { interactionMode: "either", city: "London" }),
      post("source", { interactionMode: "either" }))[0]!.reasons).not.toContain("SAME_AREA");
  });
  it("scores unioned windows without duplicate or fragmentation inflation", () => {
    const candidate = post("target");
    const split = [window("09:00", "09:10"), window("09:10", "10:00"), window("09:00", "10:00")];
    expect(ranked(post("target", { availability: split }))[0]!.score).toBe(ranked(candidate)[0]!.score);
    expect(ranked(candidate, post("source", { availability: split }))[0]!.score).toBe(ranked(candidate)[0]!.score);
    expect(ranked(post("target", { tags: ["relaxed", " RELAXED "] }),
      post("source", { tags: ["relaxed"] }))[0]!.score).toBe(
      ranked(post("target", { tags: ["relaxed"] }), post("source", { tags: ["relaxed"] }))[0]!.score);
    expect(ranked(post("target", { availability: [window("09:00", "09:15")] }))[0]!.score)
      .toBeLessThan(ranked(candidate)[0]!.score);
  });
  it("returns at most five, deterministic tie order, and accepts a smaller limit", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => post(`p${7 - i}`));
    expect(ids(candidates)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(rankCompatible(source(), candidates, { now, limit: 2 }).map((r) => r.candidate.id)).toEqual(["p0", "p1"]);
  });
  it("never mutates frozen inputs and is invariant to candidate and window order", () => {
    const s = post("source", { availability: [window("09:00", "10:00"), window("11:00", "12:00")] });
    const candidates = [post("b"), post("a")];
    const before = JSON.stringify({ s, candidates });
    Object.freeze(s.availability); Object.freeze(s); Object.freeze(candidates);
    expect(rankCompatible(s, candidates, { now })).toEqual(rankCompatible({ ...s, availability: [...s.availability].reverse() }, [...candidates].reverse(), { now }));
    expect(JSON.stringify({ s, candidates })).toBe(before);
  });
});

describe("strict bounded discovery input", () => {
  it("accepts exactly 100 candidates and fourteen bounded windows", () => {
    expect(ids(Array.from({ length: 100 }, (_, i) => post(String(i))))).toHaveLength(5);
    expect(ranked(post("target", { availability: Array.from({ length: 14 }, () => window("09:00", "10:00")) }))).toHaveLength(1);
  });
  it.each([
    { availability: Array.from({ length: 15 }, () => window("09:00", "10:00")) },
    { availability: [] },
    { availability: [window("10:00", "09:00")] },
    { availability: [{ startAt: at("09:00"), endAt: at("09:01", "2026-10-02") }] },
    { availability: [{ startAt: "not a date", endAt: at("10:00") }] },
    { availability: [{ startAt: "2026-02-30T09:00:00Z", endAt: "2026-02-30T10:00:00Z" }] },
    { availability: [{ startAt: "9999-10-01T09:00:00Z", endAt: "9999-10-01T10:00:00Z" }] },
    { expiresAt: "2026-10-31T08:00:01Z" },
    { city: null }, { activityKey: "x".repeat(41) }, { languages: [] },
    { languages: Array(6).fill("ru") }, { tags: Array(9).fill("tag") },
    { desiredAgeBands: Array(6).fill("25–34") }, { groupSize: 13 },
  ])("rejects malformed or oversized candidate %#", (patch) => {
    expect(() => ranked(post("target", patch))).toThrow();
  });
  it("enforces bounds on source, options and the whole pool before filtering", () => {
    expect(() => ids(Array.from({ length: 101 }, (_, i) => post(String(i))))).toThrow();
    expect(() => ranked(post("target"), post("source", { tags: Array(9).fill("tag") }))).toThrow();
    expect(() => rankCompatible(source(), [post("target")], { now: "bad" })).toThrow();
    expect(() => rankCompatible(source(), [post("target")], { now, limit: 6 })).toThrow();
    expect(() => rankCompatible(source(), [post("target")], { now, limit: 0 })).toThrow();
    expect(() => rankCompatible(source(), [post("target"), post("target")], { now })).toThrow();
  });
  it("bounds raw text length before normalization", () => {
    expect(() => ranked(post("target", { activityKey: " ".repeat(1000) + "chess" }))).toThrow();
    expect(() => ranked(post("target", { tags: [" ".repeat(1000) + "relaxed"] }))).toThrow();
  });
  it("rejects extra fields rather than trusting or serializing unbounded private data", () => {
    expect(() => ranked({ ...post("target"), rawText: "private" } as SeekingCandidate)).toThrow();
  });
  it("allows exact 24-hour windows and thirty-day expiry bounds", () => {
    const expiresAt = "2026-10-31T08:00:00Z";
    expect(ranked(post("target", { expiresAt, availability: [{ startAt: at("09:00"), endAt: at("09:00", "2026-10-02") }] }))).toHaveLength(1);
  });
});

it("pending expiry shares matching interval union and keeps adjacent short windows valid", () => {
  const a = post("source", { availability: [window("09:00", "09:10"), window("09:10", "09:20")] });
  expect(hasFutureOverlap(a, post("target"), now)).toBe(true);
  expect(hasFutureOverlap(a, post("target"), at("09:06"))).toBe(false);
});
