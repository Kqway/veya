export type AnalyticsEventName =
  | "landing_view"
  | "intent_started"
  | "intent_created"
  | "invite_link_copied"
  | "invite_opened"
  | "participant_joined"
  | "result_viewed"
  | "vote_submitted"
  | "new_intent_from_invite";

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  /** Enumerated surfaces only: do not send intent text, names or credentials. */
  surface: "landing" | "create" | "invite" | "result";
}

export interface AnalyticsClient {
  track(event: AnalyticsEvent): Promise<void>;
}
