import "server-only";
import type { Database, DatabaseExecutor } from "./types";
/** Explicit maintenance only. Never called by request handlers or automatic startup. */
export async function cleanupExpired(
  db: Database,
  options: { apply?: boolean; batchSize?: number;signal?:AbortSignal } = {},
) {
  const apply = options.apply ?? false,
    batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500)
    throw new Error("Batch size must be an integer from 1 to 500.");
  const lock = apply ? " FOR UPDATE SKIP LOCKED" : "";
  async function purge(
    tx: DatabaseExecutor,
    select: string,
    values: readonly unknown[],
    table: "intents" | "guest_participant_sessions" | "analytics_events",
    type: "uuid" | "bigint",
  ) {
    if(options.signal?.aborted)return [];
    const rows = (await tx.query<{ id: string }>(select, values)).rows;
    if (!apply || !rows.length) return rows.map((r) => r.id);
    return (
      await tx.query<{ id: string }>(
        `DELETE FROM ${table} WHERE id=ANY($1::${type}[]) RETURNING id`,
        [rows.map((r) => r.id)],
      )
    ).rows.map((r) => r.id);
  }
  // Separate transactions preserve the application's guest→intent lock order.
  const intents = await db.transaction((tx) =>
    purge(
      tx,
      `SELECT id FROM intents WHERE expires_at<clock_timestamp()-interval '90 days' ORDER BY expires_at,id LIMIT $1${lock}`,
      [batchSize],
      "intents",
      "uuid",
    ),
  );
  const guests = await db.transaction((tx) =>
    purge(
      tx,
      `SELECT g.id FROM guest_participant_sessions g WHERE COALESCE(g.revoked_at,g.expires_at)<clock_timestamp()-interval '7 days'
      AND NOT EXISTS(SELECT 1 FROM intents i WHERE i.creator_guest_id=g.id AND NOT(i.id=ANY($1::uuid[])))
      AND NOT EXISTS(SELECT 1 FROM participants p WHERE p.guest_id=g.id AND NOT(p.intent_id=ANY($1::uuid[])))
      ORDER BY COALESCE(g.revoked_at,g.expires_at),g.id LIMIT $2${lock}`,
      [intents, batchSize],
      "guest_participant_sessions",
      "uuid",
    ),
  );
  const analytics = await db.transaction((tx) =>
    purge(
      tx,
      `SELECT id FROM analytics_events WHERE created_at<clock_timestamp()-interval '30 days' ORDER BY created_at,id LIMIT $1${lock}`,
      [batchSize],
      "analytics_events",
      "bigint",
    ),
  );
  return {
    dryRun: !apply,
    intents: intents.length,
    guests: guests.length,
    analytics: analytics.length,
  };
}
