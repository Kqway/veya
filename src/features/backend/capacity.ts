import "server-only";
import type { DatabaseExecutor } from "@/lib/db/types";
import {
  MAX_GROUP_WINDOWS,
  MAX_PARTICIPANTS,
} from "@/features/scheduling/limits";
import { BackendError } from "./errors";
/** Caller holds the intent write lock, so concurrent admissions cannot overfill it. */
export async function assertPlanCapacity(
  db: DatabaseExecutor,
  intentId: string,
  guestId: string,
  windows: number,
  joining: boolean,
) {
  const result = await db.query<{
    members: number;
    present: boolean;
    other_windows: number;
  }>(
    `SELECT (SELECT count(*)::int FROM participants WHERE intent_id=$1) AS members,
      EXISTS(SELECT 1 FROM participants WHERE intent_id=$1 AND guest_id=$2) AS present,
      (SELECT count(*)::int FROM availability_windows w JOIN participants p ON p.id=w.participant_id WHERE p.intent_id=$1 AND p.guest_id IS DISTINCT FROM $2) AS other_windows`,
    [intentId, guestId],
  );
  const summary = result.rows[0]!;
  if (joining && summary.present) return;
  if (
    (joining && summary.members >= MAX_PARTICIPANTS) ||
    summary.other_windows + windows > MAX_GROUP_WINDOWS
  )
    throw new BackendError("PLAN_LIMIT_REACHED");
}
