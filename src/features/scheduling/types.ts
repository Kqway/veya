/** Domain-only extension point. Implement the deterministic engine in Phase 4. */
export interface AvailabilityWindow {
  startAt: string; // ISO 8601 instant with UTC offset; never an ambiguous local time.
  endAt: string;
}

export interface SchedulingParticipant {
  id: string;
  availability: readonly AvailabilityWindow[];
  preferences: readonly string[];
  budgetMin?: number;
  budgetMax?: number;
}

export interface SchedulingInput {
  participants: readonly SchedulingParticipant[];
  durationMinutes: number;
}

export interface PlanCandidate {
  window: AvailabilityWindow;
  availableParticipantIds: readonly string[];
  score: number;
}

export interface SchedulingResult {
  bestMatch: PlanCandidate | null;
  alternatives: readonly PlanCandidate[];
}

export interface SchedulingEngine {
  suggest(input: SchedulingInput): SchedulingResult;
}
