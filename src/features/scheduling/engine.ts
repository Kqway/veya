import { MAX_GROUP_WINDOWS, MAX_PARTICIPANTS } from "./limits";
import { z } from "zod";
import type {
  BudgetAssessment,
  PlanCandidate,
  SchedulingInput,
  SchedulingParticipant,
  SchedulingResult,
} from "./types";
export const ENGINE_VERSION = "deterministic-v2";
const minute = 60_000;
const instant = z.iso.datetime({ offset: true });
const schema = z.object({
  from: instant,
  until: instant,
  durationMinutes: z.number().int().min(1).max(1440),
  activities: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  participants: z.array(
    z.object({
      id: z.string().min(1),
      availability: z.array(z.object({ startAt: instant, endAt: instant })),
      preferences: z.array(
        z.object({
          category: z.enum(["activity", "dietary", "location"]),
          value: z.string().trim().min(1).max(80),
        }),
      ),
      budgetMin: z.number().int().min(0).max(100_000_000).nullable(),
      budgetMax: z.number().int().min(0).max(100_000_000).nullable(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable(),
    }),
  ),
});
type Normalized = SchedulingParticipant & {
  windows: { start: number; end: number }[];
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function budget(people: Normalized[]): BudgetAssessment {
  const known = people.filter((p) => p.currency !== null);
  if (!known.length) return "unknown";
  if (new Set(known.map((p) => p.currency)).size > 1)
    return "different-currencies";
  return Math.max(...known.map((p) => p.budgetMin ?? 0)) <=
    Math.min(...known.map((p) => p.budgetMax ?? Infinity))
    ? "compatible"
    : "incompatible";
}
function preferences(
  people: Normalized[],
  activities: string[],
): { activity: string | null; score: number } {
  const counts = new Map<string, number>();
  for (const p of people)
    for (const pref of new Set(
      p.preferences.map((p) => `${p.category}:${p.value.trim().toLowerCase()}`),
    ))
      counts.set(pref, (counts.get(pref) ?? 0) + 1);
  // Labels are public. Private preference text may influence score, never labels.
  const choices = activities;
  const activity =
    [...new Set(choices)].sort(
      (a, b) =>
        (counts.get(`activity:${b}`) ?? 0) -
          (counts.get(`activity:${a}`) ?? 0) || compare(a, b),
    )[0] ?? null;
  const categories = (["activity", "dietary", "location"] as const).filter(
    (c) => [...counts.keys()].some((k) => k.startsWith(`${c}:`)),
  );
  const score = categories.length
    ? (categories.reduce((sum, category) => {
        const frequencies = [...counts]
          .filter(
            ([key]) =>
              key.startsWith(`${category}:`) &&
              (category !== "activity" ||
                !activities.length ||
                activities.includes(key.slice(9))),
          )
          .map(([, count]) => count);
        return sum + Math.max(0, ...frequencies);
      }, 0) /
        categories.length /
        people.length) *
      100
    : 0;
  return { activity, score };
}
export function suggest(input: SchedulingInput): SchedulingResult {
  const data = schema.parse(input),
    from = Date.parse(data.from),
    until = Date.parse(data.until),
    target = data.durationMinutes * minute;
  if (
    data.participants.length > MAX_PARTICIPANTS ||
    data.participants.reduce((sum, p) => sum + p.availability.length, 0) >
      MAX_GROUP_WINDOWS
  )
    throw new Error("Scheduling input exceeds limits.");
  if (
    until <= from ||
    until - from > 30 * 86400000 ||
    new Set(data.participants.map((p) => p.id)).size !==
      data.participants.length
  )
    throw new Error("Invalid scheduling bounds or identities.");
  const people: Normalized[] = data.participants
    .map((p) => {
      if (
        (p.budgetMin !== null &&
          p.budgetMax !== null &&
          p.budgetMin > p.budgetMax) ||
        (p.budgetMin !== null || p.budgetMax !== null) !== (p.currency !== null)
      )
        throw new Error("Invalid budget.");
      const windows: { start: number; end: number }[] = [];
      const ranges = p.availability
        .map((w) => ({
          start: Date.parse(w.startAt),
          end: Date.parse(w.endAt),
        }))
        .sort((a, b) => a.start - b.start || a.end - b.end);
      for (const w of ranges) {
        if (w.end <= w.start || w.end - w.start > 86400000)
          throw new Error("Invalid availability range.");
        const clipped = {
          start: Math.max(from, w.start),
          end: Math.min(until, w.end),
        };
        if (clipped.end <= clipped.start) continue;
        const previous = windows.at(-1);
        if (previous && clipped.start <= previous.end)
          previous.end = Math.max(previous.end, clipped.end);
        else windows.push(clipped);
      }
      return { ...p, windows };
    })
    .sort((a, b) => compare(a.id, b.id));
  const boundaries = [
    ...new Set(
      people.flatMap((p) => p.windows.flatMap((w) => [w.start, w.end])),
    ),
  ].sort((a, b) => a - b);
  const pairs = new Map<string, { start: number; duration: number }>();
  function add(start: number, duration: number) {
    if (duration >= minute && start >= from && start + duration <= until)
      pairs.set(`${start}:${duration}`, { start, duration });
  }
  for (const time of boundaries) {
    add(time, target);
    add(time - target, target);
  }
  if (boundaries.length) {
    for (
      let start = Math.ceil(boundaries[0]! / (30 * minute)) * 30 * minute;
      start + target <= boundaries.at(-1)!;
      start += 30 * minute
    )
      add(start, target);
  }
  // Unrelated windows can split a shared period into tiny adjacent segments.
  // Include spans across those boundaries so the real shared period survives.
  for (const [index, start] of boundaries.entries()) {
    for (let next = index + 1; next < boundaries.length; next++) {
      const duration = boundaries[next]! - start;
      if (duration > target) break;
      if (duration >= Math.min(15 * minute, target)) add(start, duration);
    }
  }
  function candidates(): PlanCandidate[] {
    const result: PlanCandidate[] = [];
    for (const { start, duration } of pairs.values()) {
      const end = start + duration,
        available = people.filter((p) =>
          p.windows.some((w) => w.start <= start && w.end >= end),
        );
      if (!available.length) continue;
      const partial = people.filter(
        (p) =>
          !available.includes(p) &&
          p.windows.some((w) => w.start < end && w.end > start),
      );
      const flexibility =
        available.reduce((sum, p) => {
          const w = p.windows.find((w) => w.start <= start && w.end >= end)!;
          return sum + Math.min(target, start - w.start, w.end - end) / target;
        }, 0) / available.length;
      const quality = Math.round((80 * duration) / target + 20 * flexibility),
        pref = preferences(
          available,
          data.activities.map((a) => a.toLowerCase()),
        ),
        assessment = budget(available);
      const score = Math.round(
        (700 * available.length) / people.length +
          (150 * quality) / 100 +
          pref.score +
          (assessment === "compatible"
            ? 50
            : assessment === "unknown"
              ? 25
              : 0),
      );
      const explanation =
        (available.length === people.length
          ? `All ${people.length} can make this time.`
          : `Nothing works for everyone, but ${available.length} of ${people.length} can make this time.`) +
        (duration < target
          ? ` A shorter ${duration / minute}-minute meetup.`
          : "") +
        (assessment === "incompatible"
          ? " Shared budget ranges need a compromise."
          : assessment === "different-currencies"
            ? " Budgets use different currencies; compare costs together."
            : "");
      result.push({
        window: {
          startAt: new Date(start).toISOString(),
          endAt: new Date(end).toISOString(),
        },
        availableParticipantIds: available.map((p) => p.id),
        partialParticipantIds: partial.map((p) => p.id),
        score,
        quality,
        durationMinutes: duration / minute,
        shortened: duration < target,
        activity: pref.activity,
        budgetAssessment: assessment,
        explanation,
      });
    }
    return result.sort(
      (a, b) =>
        b.availableParticipantIds.length - a.availableParticipantIds.length ||
        b.score - a.score ||
        Date.parse(a.window.startAt) - Date.parse(b.window.startAt) ||
        b.durationMinutes - a.durationMinutes ||
        compare(
          a.availableParticipantIds.join(","),
          b.availableParticipantIds.join(","),
        ),
    );
  }
  let ranked = candidates();
  if (!ranked.length) {
    for (const [index, start] of boundaries.entries()) {
      for (let next = index + 1; next < boundaries.length; next++) {
        const duration = boundaries[next]! - start;
        if (duration >= Math.min(15 * minute, target)) break;
        add(start, duration);
      }
    }
    ranked = candidates();
  }
  const selected: PlanCandidate[] = [];
  for (const c of ranked) {
    if (
      selected.every(
        (p) =>
          Date.parse(c.window.endAt) <= Date.parse(p.window.startAt) ||
          Date.parse(p.window.endAt) <= Date.parse(c.window.startAt),
      )
    )
      selected.push(c);
    if (selected.length === 4) break;
  }
  return {
    bestMatch: selected[0] ?? null,
    alternatives: selected.slice(1),
    message:
      selected[0]?.explanation ??
      "Ask friends to add longer future availability so we can find a good time together.",
  };
}
