import type { ParticipantInput, StructuredIntent } from "./validation";

export type IntentStatus = "collecting" | "ready" | "decided" | "expired";
export interface PublicIntent {
  publicSlug: string;
  creatorName: string;
  rawText: string;
  title: string;
  structuredIntent: StructuredIntent;
  status: IntentStatus;
  createdAt: string;
  expiresAt: string;
  participantCount: number;
}

export type OwnParticipant = ParticipantInput;
export interface IntentView {
  intent: PublicIntent;
  ownParticipant: OwnParticipant | null;
  isCreator: boolean;
}

export interface IntentRow {
  id: string;
  public_slug: string;
  creator_guest_id: string | null;
  creator_display_name: string;
  raw_text: string;
  title: string;
  structured_intent: StructuredIntent;
  status: IntentStatus;
  created_at: Date;
  expires_at: Date;
}
