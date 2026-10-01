import { z } from "zod";
import type { DiscoveryOptions, RankedCandidate, ReasonCode, SeekingCandidate } from "./types";
import { normalizeActivityKey } from "./activity-normalization";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const HORIZON = 30 * DAY;
const MIN_OVERLAP = 15 * MINUTE;
const normalize = (value: string) => value.normalize("NFC").trim().toLowerCase().replace(/\s+/gu, " ");
const text = (max: number) => z.string().max(max).trim().min(1);
const instant = z.iso.datetime({ offset: true }).refine((value) => {
  const year = new Date(value).getUTCFullYear();
  return year >= 2000 && year <= 2100;
}, "Invalid date bounds.");
const windowSchema = z.strictObject({ startAt: instant, endAt: instant }).refine((value) => {
  const duration = Date.parse(value.endAt) - Date.parse(value.startAt);
  return duration > 0 && duration <= DAY;
}, "Invalid availability range.");
const candidateSchema = z.strictObject({
  id: text(128), profileId: text(128), activityKey: text(40), activityLabel: text(80),
  interactionMode: z.enum(["in_person", "online", "either"]),
  format: z.enum(["one_to_one", "group", "either"]),
  city: text(60).nullable(), area: text(60).nullable(),
  availability: z.array(windowSchema).min(1).max(14),
  skill: z.enum(["beginner", "casual", "intermediate", "advanced", "expert", "any"]),
  languages: z.array(text(40)).min(1).max(5), tags: z.array(text(40)).max(8),
  ageBand: text(20).nullable(), desiredAgeBands: z.array(text(20)).max(5),
  groupSize: z.number().int().min(2).max(12).nullable(), expiresAt: instant,
  status: z.enum(["active", "closed"]),
}).refine((value) => value.interactionMode === "online" || value.city !== null, "City required.");
const optionsSchema = z.strictObject({
  now: instant, blockedProfileIds: z.array(text(128)).max(1000).optional(),
  limit: z.number().int().min(1).max(5).optional(),
});
type Window = { start: number; end: number };

function unionWindows(post: Pick<SeekingCandidate, "availability" | "expiresAt">, now: number): Window[] {
  const expiry = Date.parse(post.expiresAt);
  const ranges = post.availability.map((window) => ({
    start: Math.max(now, Date.parse(window.startAt)),
    end: Math.min(expiry, Date.parse(window.endAt)),
  })).filter((window) => window.end > window.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const union: Window[] = [];
  for (const window of ranges) {
    const previous = union.at(-1);
    if (previous && window.start <= previous.end) previous.end = Math.max(previous.end, window.end);
    else union.push({ ...window });
  }
  return union;
}
function overlaps(a: readonly Window[], b: readonly Window[]): Window[] {
  const result: Window[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const left = a[i]!, right = b[j]!;
    const start = Math.max(left.start, right.start), end = Math.min(left.end, right.end);
    if (end - start >= MIN_OVERLAP) result.push({ start, end });
    if (left.end <= right.end) i++;
    else j++;
  }
  return result;
}
/** Shares the matching engine's merged intervals and minimum meeting duration. */
export function hasFutureOverlap(
  source: Pick<SeekingCandidate, "availability" | "expiresAt">,
  target: Pick<SeekingCandidate, "availability" | "expiresAt">,
  now: string,
): boolean {
  return overlaps(unionWindows(source, Date.parse(now)), unionWindows(target, Date.parse(now))).length > 0;
}
function cityKey(city: string | null): string | null {
  if (city === null) return null;
  const value = normalize(city);
  return value === "moscow" || value === "москва" ? "moscow" : value;
}
function physicalCompatible(a: SeekingCandidate, b: SeekingCandidate): boolean {
  return a.interactionMode !== "online" && b.interactionMode !== "online" &&
    cityKey(a.city) !== null && cityKey(a.city) === cityKey(b.city);
}
function modeCompatible(a: SeekingCandidate, b: SeekingCandidate): boolean {
  return (a.interactionMode !== "in_person" && b.interactionMode !== "in_person") ||
    physicalCompatible(a, b);
}
function formatCompatible(a: SeekingCandidate, b: SeekingCandidate): boolean {
  const oneToOne = a.format !== "group" && b.format !== "group";
  const group = a.format !== "one_to_one" && b.format !== "one_to_one" &&
    (a.groupSize === null || b.groupSize === null || a.groupSize === b.groupSize);
  return oneToOne || group;
}
function ageCompatible(a: SeekingCandidate, b: SeekingCandidate): boolean {
  return !a.desiredAgeBands.length || (b.ageBand !== null &&
    a.desiredAgeBands.some((age) => normalize(age) === normalize(b.ageBand!)));
}
function shared(a: readonly string[], b: readonly string[]): number {
  const values = new Set(a.map(normalize));
  return [...new Set(b.map(normalize))].filter((value) => values.has(value)).length;
}
function timeHint(start: number, now: number): RankedCandidate["timeHint"] {
  // UTC calendar days: deterministic and intentionally coarse, without exact windows.
  const days = Math.floor(start / DAY) - Math.floor(now / DAY);
  return days === 0 ? "Compatible today" : days === 1 ? "Compatible tomorrow" :
    days < 7 ? "Compatible this week" : "Compatible soon";
}
const skills = ["beginner", "casual", "intermediate", "advanced", "expert"];

/** Pure bounded matching. Returns internal objects; privacy projections belong at the server boundary. */
export function rankCompatible(
  source: SeekingCandidate,
  candidates: readonly SeekingCandidate[],
  options: DiscoveryOptions,
): readonly RankedCandidate[] {
  const settings = optionsSchema.parse(options);
  const sourcePost = candidateSchema.parse(source);
  const pool = z.array(candidateSchema).max(100).parse(candidates);
  const now = Date.parse(settings.now);
  const all = [sourcePost, ...pool];
  for (const post of all) {
    if (post.status === "active" && (Date.parse(post.expiresAt) > now + HORIZON ||
      post.availability.some((window) => Date.parse(window.endAt) > now + HORIZON)))
      throw new Error("Discovery input exceeds the thirty-day horizon.");
  }
  if (new Set(pool.map((post) => post.id)).size !== pool.length)
    throw new Error("Duplicate discovery candidate identities.");
  if (sourcePost.status !== "active" || Date.parse(sourcePost.expiresAt) <= now) return [];
  const blocked = new Set(settings.blockedProfileIds ?? []);
  const sourceWindows = unionWindows(sourcePost, now);
  const result: RankedCandidate[] = [];
  for (const [index, candidate] of pool.entries()) {
    if (candidate.id === sourcePost.id || candidate.profileId === sourcePost.profileId ||
      blocked.has(candidate.profileId) || candidate.status !== "active" ||
      Date.parse(candidate.expiresAt) <= now ||
      normalizeActivityKey(candidate.activityKey) !== normalizeActivityKey(sourcePost.activityKey) ||
      !modeCompatible(sourcePost, candidate) || !formatCompatible(sourcePost, candidate) ||
      !shared(sourcePost.languages, candidate.languages) ||
      !ageCompatible(sourcePost, candidate) || !ageCompatible(candidate, sourcePost)) continue;
    const windows = overlaps(sourceWindows, unionWindows(candidate, now));
    if (!windows.length) continue;
    const reasons: ReasonCode[] = ["SAME_ACTIVITY", "TIME_OVERLAP", "SHARED_LANGUAGE", "FORMAT_COMPATIBLE"];
    const sharedMinutes = windows.reduce((total, window) => total + (window.end - window.start) / MINUTE, 0);
    let score = 100 + Math.round(Math.min(sharedMinutes, 180) / 6);
    const sourceSkill = skills.indexOf(sourcePost.skill), candidateSkill = skills.indexOf(candidate.skill);
    if (sourceSkill >= 0 && candidateSkill >= 0) {
      const gap = Math.abs(sourceSkill - candidateSkill);
      score += 20 - 4 * gap;
      if (gap <= 1) reasons.push("SKILL_COMPATIBLE");
    } else score += 10; // Unknown skill is neutral; it is not evidence of compatibility.
    if (sourcePost.area !== null && candidate.area !== null &&
      physicalCompatible(sourcePost, candidate) && normalize(sourcePost.area) === normalize(candidate.area)) {
      score += 12;
      reasons.push("SAME_AREA");
    }
    const interests = shared(sourcePost.tags, candidate.tags);
    if (interests) {
      score += interests * 3;
      reasons.push("SHARED_INTEREST");
    }
    result.push({ candidate: candidates[index]!, score, reasons, timeHint: timeHint(windows[0]!.start, now) });
  }
  return result.sort((a, b) => b.score - a.score ||
    (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0))
    .slice(0, settings.limit ?? 5);
}
