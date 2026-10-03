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
    throw new BetaPolicyError("BETA_READ_ONLY", "Приложение временно доступно только для просмотра. Попробуйте позже.");
  if (operation === "signup" && !controls.signupsEnabled)
    throw new BetaPolicyError("BETA_SIGNUPS_PAUSED", "Создание новых профилей временно приостановлено. Попробуйте позже.");
  if (operation === "seeking" && !controls.seekingEnabled)
    throw new BetaPolicyError("BETA_SEEKING_PAUSED", "Создание новых объявлений о поиске компании временно приостановлено. Попробуйте позже.");
}
