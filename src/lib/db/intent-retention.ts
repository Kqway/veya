import "server-only";
import { lockProfiles } from "@/features/social/context";
import type { Database, DatabaseExecutor } from "./types";

export type IntentCleanupResult = { dryRun: boolean; reports: number; searches: number; jobs: number };
export type IntentCleanupOptions = { apply?: boolean; batchSize?: number; signal?: AbortSignal };
const reportEligibility = `r.room_id IS NOT NULL AND r.status IN('resolved','dismissed')
  AND isfinite(r.created_at) AND isfinite(r.updated_at)
  AND r.created_at<clock_timestamp()-interval '365 days'
  AND r.updated_at<clock_timestamp()-interval '365 days'`;
const jobEligibility = `(
  (j.status IN('completed','failed') AND isfinite(j.finished_at) AND j.finished_at<clock_timestamp()-interval '7 days')
  OR (j.status='cancelled' AND isfinite(COALESCE(j.finished_at,j.available_at))
      AND COALESCE(j.finished_at,j.available_at)<clock_timestamp()-interval '7 days'))`;
const relatedProfiles = `SELECT s.profile_id
  UNION SELECT m.profile_id FROM social_lobby_members m JOIN social_lobbies l ON l.id=m.lobby_id WHERE l.search_id=s.id
  UNION SELECT o.recipient_profile_id FROM social_candidate_offers o WHERE o.search_id=s.id`;
const searchColumns = `s.id,(SELECT l.id FROM social_lobbies l WHERE l.search_id=s.id) AS lobby_id,
  ARRAY(SELECT related.profile_id FROM (${relatedProfiles}) related ORDER BY related.profile_id) AS profile_ids`;
// $1 contains only report IDs selected by this bounded maintenance operation.
// In preview it models the preceding report purge; apply has already deleted them.
const searchEligibility = `s.status IN('filled','closed','expired')
  AND s.created_at<clock_timestamp()-interval '180 days'
  AND s.expires_at<clock_timestamp()-interval '180 days'
  AND NOT EXISTS(SELECT 1 FROM social_rooms r JOIN social_lobbies l ON l.id=r.lobby_id WHERE l.search_id=s.id
    AND (r.status NOT IN('closed','completed','archived') OR r.created_at>=clock_timestamp()-interval '180 days'
      OR EXISTS(SELECT 1 FROM social_room_messages msg WHERE msg.room_id=r.id AND msg.created_at>=clock_timestamp()-interval '180 days')))
  AND NOT EXISTS(SELECT 1 FROM social_candidate_offers o WHERE o.search_id=s.id AND o.status='pending' AND o.expires_at>clock_timestamp())
  AND NOT EXISTS(SELECT 1 FROM seeking_posts p WHERE p.profile_id IN(${relatedProfiles}) AND p.status='active' AND p.expires_at>clock_timestamp())
  AND NOT EXISTS(SELECT 1 FROM social_reports report JOIN social_rooms room ON room.id=report.room_id
    JOIN social_lobbies lobby ON lobby.id=room.lobby_id WHERE lobby.search_id=s.id AND NOT(report.id=ANY($1::uuid[])))`;
type SearchRow = { id: string; lobby_id: string | null; profile_ids: string[] };
class ParticipantsChanged extends Error {}

/** Explicit bounded maintenance. Preview is the default; never run from a request or startup. */
export async function cleanupIntentData(db: Database, options: IntentCleanupOptions = {}): Promise<IntentCleanupResult> {
  const apply = options.apply ?? false, batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error("Batch size must be an integer from 1 to 500.");
  const empty: IntentCleanupResult = { dryRun: !apply, reports: 0, searches: 0, jobs: 0 };
  if (options.signal?.aborted) return empty;
  if (!(await db.query<{ relation: string | null }>("SELECT to_regclass('public.social_action_searches') AS relation")).rows[0]?.relation) return empty;

  const reports = await db.transaction(async (tx) => {
    if (options.signal?.aborted) return [];
    const selected = (await tx.query<{ id: string; reporter_profile_id: string; target_profile_id: string }>(
      `SELECT r.id,r.reporter_profile_id,r.target_profile_id FROM social_reports r WHERE ${reportEligibility} ORDER BY r.created_at,r.id LIMIT $1`, [batchSize],
    )).rows;
    if (!apply || !selected.length) return selected.map((r) => r.id);
    await lockProfiles(tx, selected.flatMap((r) => [r.reporter_profile_id, r.target_profile_id]));
    if (options.signal?.aborted) return [];
    const locked = (await tx.query<{ id: string }>(`SELECT r.id FROM social_reports r WHERE r.id=ANY($1::uuid[]) AND ${reportEligibility} ORDER BY r.created_at,r.id FOR UPDATE SKIP LOCKED`, [selected.map((r) => r.id)])).rows;
    return (await tx.query<{ id: string }>("DELETE FROM social_reports WHERE id=ANY($1::uuid[]) RETURNING id", [locked.map((r) => r.id)])).rows.map((r) => r.id);
  });
  // Count direct terminal-job deletion before cascading contexts, in preview and apply alike.
  const jobs = await db.transaction(async (tx) => {
    if (options.signal?.aborted) return 0;
    const selected = (await tx.query<{ id: string; profile_id: string }>(`SELECT j.id,s.profile_id FROM social_intent_jobs j JOIN social_action_searches s ON s.id=j.search_id WHERE ${jobEligibility} ORDER BY COALESCE(j.finished_at,j.available_at),j.id LIMIT $1`, [batchSize])).rows;
    if (!apply || !selected.length) return selected.length;
    await lockProfiles(tx, selected.map((r) => r.profile_id));
    if (options.signal?.aborted) return 0;
    const locked = (await tx.query<{ id: string }>(`SELECT j.id FROM social_intent_jobs j WHERE j.id=ANY($1::uuid[]) AND ${jobEligibility} ORDER BY COALESCE(j.finished_at,j.available_at),j.id FOR UPDATE SKIP LOCKED`, [selected.map((r) => r.id)])).rows;
    return (await tx.query("DELETE FROM social_intent_jobs WHERE id=ANY($1::uuid[])", [locked.map((r) => r.id)])).rowCount;
  });

  async function purgeSearches(tx: DatabaseExecutor): Promise<number> {
    if (options.signal?.aborted) return 0;
    const selected = (await tx.query<SearchRow>(`SELECT ${searchColumns} FROM social_action_searches s WHERE ${searchEligibility} ORDER BY s.expires_at,s.id LIMIT $2`, [reports, batchSize])).rows;
    if (!apply || !selected.length) return selected.length;
    const lockedProfiles = new Set(selected.flatMap((r) => r.profile_ids));
    await lockProfiles(tx, [...lockedProfiles]);
    if (options.signal?.aborted) return 0;
    // Match domain ordering: every participant profile first, then search, then lobby.
    const searches = (await tx.query<SearchRow>(`SELECT ${searchColumns} FROM social_action_searches s WHERE s.id=ANY($2::uuid[]) AND ${searchEligibility} ORDER BY s.expires_at,s.id FOR UPDATE OF s SKIP LOCKED`, [reports, selected.map((r) => r.id)])).rows;
    if (!searches.length) return 0;
    const lobbyIds = searches.flatMap((r) => r.lobby_id ? [r.lobby_id] : []);
    const lobbies = new Set((await tx.query<{ id: string }>("SELECT id FROM social_lobbies WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE SKIP LOCKED", [lobbyIds])).rows.map((r) => r.id));
    const available = searches.filter((r) => !r.lobby_id || lobbies.has(r.lobby_id));
    const refreshed = (await tx.query<SearchRow>(`SELECT ${searchColumns} FROM social_action_searches s WHERE s.id=ANY($2::uuid[]) AND ${searchEligibility} ORDER BY s.expires_at,s.id`, [reports, available.map((r) => r.id)])).rows;
    if (refreshed.some(row => row.profile_ids.some(id => !lockedProfiles.has(id)))) throw new ParticipantsChanged();
    if (options.signal?.aborted || !refreshed.length) return 0;
    // No report references remain. FK cascades remove offers, lobby members, rooms,
    // messages, contextual notifications and jobs without dangling protected evidence.
    return (await tx.query("DELETE FROM social_action_searches WHERE id=ANY($1::uuid[])", [refreshed.map((r) => r.id)])).rowCount;
  }
  let searches = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { searches = await db.transaction(purgeSearches); break; }
    catch (error) { if (!(error instanceof ParticipantsChanged)) throw error; }
  }
  return { dryRun: !apply, reports: reports.length, searches, jobs };
}
