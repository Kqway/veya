import "server-only";
import type { Database } from "@/lib/db/types";
import { lockProfiles } from "@/features/social/context";
import { cleanupGoalArtifacts } from "./repository";
/** Explicit operator preview/apply only; never run automatically. */
export async function cleanupGoals(
  db: Database,
  options: { apply?: boolean; batchSize?: number; signal?: AbortSignal } = {},
) {
  const limit = options.batchSize ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error("Invalid batch size");
  const candidates = (
    await db.query<{ id: string; profile_id: string }>(
      "SELECT id,profile_id FROM agent_goals WHERE status IN('COMPLETED','FAILED','CANCELLED') AND updated_at<clock_timestamp()-interval '180 days' ORDER BY updated_at,id LIMIT $1",
      [limit],
    )
  ).rows;
  let goals = 0;
  for (const row of candidates) {
    if (options.signal?.aborted) break;
    if (!options.apply) {
      goals++;
      continue;
    }
    goals += await db.transaction(async (tx) => {
      await lockProfiles(tx, [row.profile_id]);
      const current = await tx.query(
        "SELECT id FROM agent_goals WHERE id=$1 AND status IN('COMPLETED','FAILED','CANCELLED') AND updated_at<clock_timestamp()-interval '180 days' FOR UPDATE",
        [row.id],
      );
      if (!current.rowCount) return 0;
      await tx.query(
        "INSERT INTO agent_artifact_erasure(goal_id) VALUES($1) ON CONFLICT DO NOTHING",
        [row.id],
      );
      await tx.query("DELETE FROM agent_goals WHERE id=$1", [row.id]);
      return 1;
    });
  }
  if (options.apply) await cleanupGoalArtifacts(db, limit);
  return { dryRun: !options.apply, goals };
}
