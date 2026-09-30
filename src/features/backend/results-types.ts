import type { IntentView } from "./types";
import type {
  AvailabilityWindow,
  BudgetAssessment,
} from "@/features/scheduling/types";
export type VoteValue = "yes" | "maybe" | "no";
export interface ResultProposal {
  suggestionKey: string;
  title: string;
  window: AvailabilityWindow;
  availableCount: number;
  partialCount: number;
  totalCount: number;
  score: number;
  durationMinutes: number;
  shortened: boolean;
  activity: string | null;
  budgetAssessment: BudgetAssessment;
  explanation: string;
  votes: Record<VoteValue, number>;
  ownVote: VoteValue | null;
  attendance?: {
    displayName: string;
    status: "available" | "partial" | "unavailable";
  }[];
}
export interface ResultsView extends IntentView {
  revision: number;
  selectedSuggestionKey: string | null;
  suggestions: ResultProposal[];
  message: string;
  canVote: boolean;
  summary: {
    participantsWithAvailability: number;
    participantsMissingAvailability: number;
  };
}
