export type BackendErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVITE_EXPIRED"
  | "INTENT_CLOSED"
  | "STALE_RESULTS";

const messages: Record<BackendErrorCode, string> = {
  STALE_RESULTS: "These suggestions changed. Reload the latest results.",
  INVALID_INPUT: "Check the submitted fields.",
  UNAUTHORIZED: "A valid guest session is required.",
  FORBIDDEN: "You do not have permission for this action.",
  NOT_FOUND: "The requested plan or membership was not found.",
  INVITE_EXPIRED: "This invitation has expired.",
  INTENT_CLOSED: "This plan no longer accepts changes.",
};

export class BackendError extends Error {
  constructor(readonly code: BackendErrorCode) {
    super(messages[code]);
    this.name = "BackendError";
  }
}
