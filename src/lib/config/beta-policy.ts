import "server-only";
import { getServerEnv } from "./server";

export interface BetaControls {
  signupsEnabled: boolean;
  seekingEnabled: boolean;
  readOnly: boolean;
}

export type BetaOperation = "read" | "mutation" | "signup" | "seeking" | "safety";

/** Read at the request/job boundary, never expose operational flags to clients. */
export function getBetaControls(): BetaControls {
  const config = getServerEnv();
  return {
    signupsEnabled: config.BETA_SIGNUPS_ENABLED,
    seekingEnabled: config.BETA_SEEKING_ENABLED,
    readOnly: config.BETA_READ_ONLY,
  };
}

export class BetaPolicyError extends Error {
  readonly status = 503;
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** Safety actions remain available; pauses apply before quotas/body/service work. */
export function assertBetaOperationAllowed(
  operation: BetaOperation,
  controls: BetaControls = getBetaControls(),
): void {
  if (operation === "read" || operation === "safety") return;
  if (controls.readOnly)
    throw new BetaPolicyError("BETA_READ_ONLY", "The application is temporarily read-only. Please try again later.");
  if (operation === "signup" && !controls.signupsEnabled)
    throw new BetaPolicyError("BETA_SIGNUPS_PAUSED", "New profiles are temporarily paused. Please try again later.");
  if (operation === "seeking" && !controls.seekingEnabled)
    throw new BetaPolicyError("BETA_SEEKING_PAUSED", "New seeking posts are temporarily paused. Please try again later.");
}
