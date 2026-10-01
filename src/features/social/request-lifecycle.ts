import "server-only";
import type { DatabaseExecutor } from "@/lib/db/types";
import { hasFutureOverlap } from "@/features/discovery/engine";
type Pending = { id: string; source_post_id: string | null; target_post_id: string | null };

async function timePost(tx: DatabaseExecutor, id: string | null) {
  if (!id) return null;
  const post = await tx.query<{ status: string; expires_at: Date }>(
    "SELECT status,expires_at FROM seeking_posts WHERE id=$1", [id],
  );
  const row = post.rows[0];
  if (!row || row.status !== "active" || row.expires_at.getTime() <= Date.now()) return null;
  const windows = await tx.query<{ start_at: Date; end_at: Date }>(
    "SELECT start_at,end_at FROM seeking_availability WHERE post_id=$1 ORDER BY start_at", [id],
  );
  return {
    expiresAt: row.expires_at.toISOString(),
    availability: windows.rows.map((w) => ({ startAt: w.start_at.toISOString(), endAt: w.end_at.toISOString() })),
  };
}

/** Caller holds each request's sender or both participant profile locks. No new locks here. */
export async function retireRequests(tx: DatabaseExecutor, requests: readonly Pending[]) {
  for (const request of requests) {
    const source = await timePost(tx, request.source_post_id);
    const target = await timePost(tx, request.target_post_id);
    if (source && target && hasFutureOverlap(source, target, new Date().toISOString())) continue;
    // Closure/expiry/time exhaustion are monotonic. Preserve history without attributing a decline.
    await tx.query("UPDATE connection_requests SET status='expired',updated_at=clock_timestamp() WHERE id=$1 AND status='pending'", [request.id]);
  }
}
/** At most ten rows, protected by the sender lock shared by every request mutation. */
export async function retireOutgoing(tx: DatabaseExecutor, sender: string) {
  const pending = await tx.query<Pending>(
    "SELECT id,source_post_id,target_post_id FROM connection_requests WHERE sender_profile_id=$1 AND status='pending' LIMIT 10", [sender],
  );
  await retireRequests(tx, pending.rows);
}
