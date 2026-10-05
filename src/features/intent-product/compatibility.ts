import { attributesForActivity, dotaRanks } from "./schema";

/** Both sides' explicit constraints must hold. Missing required rank is never a match. */
export function compatibleAttributes(activityKey: string, required: unknown, candidate: unknown): boolean {
  const schema = attributesForActivity(activityKey);
  const a = schema.safeParse(required), b = schema.safeParse(candidate);
  if (!a.success || !b.success) return false;
  const left = a.data as Record<string, string>;
  const right = b.data as Record<string, string>;
  if (activityKey === "dota2") {
    for (const [rule, person] of [[left, right], [right, left]] as const) {
      if (rule.minRank && rule.minRank !== "any") {
        const actual = person.rank;
        if (!actual || actual === "any" || dotaRanks.indexOf(actual as typeof dotaRanks[number]) < dotaRanks.indexOf(rule.minRank as typeof dotaRanks[number])) return false;
      }
    }
  }
  for (const key of Object.keys(left)) {
    if (key === "minRank" || left[key] === "any") continue;
    const other = right[key];
    if (other && other !== "any" && left[key]!.toLocaleLowerCase() !== other.toLocaleLowerCase()) return false;
  }
  return true;
}
