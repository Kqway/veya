/** Pure scheduling domain: UTC instants, no SQL, UI, clock or AI dependencies. */
export interface AvailabilityWindow {
  startAt: string;
  endAt: string;
}
export interface SchedulingPreference {
  category: "activity" | "dietary" | "location";
  value: string;
}
export interface SchedulingParticipant {
  id: string;
  availability: readonly AvailabilityWindow[];
  preferences: readonly SchedulingPreference[];
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string | null;
}
export interface SchedulingInput {
  participants: readonly SchedulingParticipant[];
  durationMinutes: number;
  from: string;
  until: string;
  activities?: readonly string[];
}
export type BudgetAssessment =
  | "compatible"
  | "incompatible"
  | "different-currencies"
  | "unknown";
export interface PlanCandidate {
  window: AvailabilityWindow;
  availableParticipantIds: readonly string[];
  partialParticipantIds: readonly string[];
  score: number;
  quality: number;
  durationMinutes: number;
  shortened: boolean;
  activity: string | null;
  budgetAssessment: BudgetAssessment;
  explanation: string;
}
export interface SchedulingResult {
  bestMatch: PlanCandidate | null;
  alternatives: readonly PlanCandidate[];
  message: string;
}
export interface SchedulingEngine {
  suggest(input: SchedulingInput): SchedulingResult;
}
