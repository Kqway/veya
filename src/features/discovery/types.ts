import type { AvailabilityWindow } from "@/features/scheduling/types";

/** Internal matching input. Never serialize candidate rows into discovery cards. */
export interface SeekingCandidate {
  id: string;
  profileId: string;
  activityKey: string;
  activityLabel: string;
  interactionMode: "in_person" | "online" | "either";
  format: "one_to_one" | "group" | "either";
  city: string | null;
  area: string | null;
  availability: readonly AvailabilityWindow[];
  skill: "beginner" | "casual" | "intermediate" | "advanced" | "expert" | "any";
  languages: readonly string[];
  tags: readonly string[];
  ageBand: string | null;
  desiredAgeBands: readonly string[];
  groupSize: number | null;
  expiresAt: string;
  status: "active" | "closed";
}
export type ReasonCode =
  | "SAME_ACTIVITY"
  | "TIME_OVERLAP"
  | "SAME_AREA"
  | "SKILL_COMPATIBLE"
  | "SHARED_LANGUAGE"
  | "SHARED_INTEREST"
  | "FORMAT_COMPATIBLE";
export interface RankedCandidate {
  candidate: SeekingCandidate;
  score: number;
  reasons: ReasonCode[];
  timeHint: "Compatible today" | "Compatible tomorrow" | "Compatible this week" | "Compatible soon";
}
export interface DiscoveryOptions {
  now: string;
  blockedProfileIds?: readonly string[];
  limit?: number;
}
