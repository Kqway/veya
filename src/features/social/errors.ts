export type SocialErrorCode = "INVALID_INPUT" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT";
const descriptions: Record<SocialErrorCode, { status: number; message: string }> = {
  INVALID_INPUT: { status: 400, message: "Check the submitted fields." },
  UNAUTHORIZED: { status: 401, message: "A valid guest session is required." },
  FORBIDDEN: { status: 403, message: "This action is unavailable." },
  NOT_FOUND: { status: 404, message: "The requested social resource is unavailable." },
  CONFLICT: { status: 409, message: "This action is unavailable in the current state." },
};
/** Safe for the HTTP boundary; never includes keys, identifiers or DB errors. */
export class SocialError extends Error {
  readonly status: number;
  constructor(readonly code: SocialErrorCode) {
    super(descriptions[code].message);
    this.name = "SocialError";
    this.status = descriptions[code].status;
  }
}
export function fail(code: SocialErrorCode): never { throw new SocialError(code); }
