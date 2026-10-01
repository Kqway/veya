import "server-only";
import type { Database } from "./types";
import { lockProfiles } from "@/features/social/context";
export type SocialCleanupResult = { dryRun:boolean; reports:number; handles:number; passes:number; posts:number; pairs:number };
type RetentionRow = { id:string; profile_a:string; profile_b:string | null };
/** Explicit maintenance only. Default dry-run counts; stable profiles/bindings/blocks persist. */
export async function cleanupSocial(db: Database,options: {apply?:boolean;batchSize?:number} = {}): Promise<SocialCleanupResult> {
  const apply = options.apply ?? false, batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error("Batch size must be an integer from 1 to 500.");
  // All SQL components below are fixed server constants, never caller input.
  async function purge(table:string,key:string,profiles:string,eligible:string,order:string): Promise<number> {
    return db.transaction(async (tx) => {
      const selected = await tx.query<RetentionRow>(`SELECT ${key} AS id,${profiles} FROM ${table} t WHERE ${eligible} ORDER BY ${order} LIMIT $1`,[batchSize]);
      if (!apply || !selected.rows.length) return selected.rows.length;
      // Follow the application's profile→row lock order, then recheck after waits.
      await lockProfiles(tx,selected.rows.flatMap((row) => row.profile_b ? [row.profile_a,row.profile_b] : [row.profile_a]));
      const rows = await tx.query<RetentionRow>(`SELECT ${key} AS id,${profiles} FROM ${table} t WHERE ${key}=ANY($1::text[]) AND ${eligible} ORDER BY ${order} FOR UPDATE SKIP LOCKED`,[selected.rows.map((row) => row.id)]);
      if (!rows.rows.length) return 0;
      const ids = rows.rows.map((row) => row.id);
      if (table === "seeking_posts") {
        // Clear both references in one update while posts still exist. Independent
        // FK SET NULL actions otherwise see a deleted opposite post in the
        // existing request ownership trigger when both posts are purged together.
        await tx.query(`UPDATE connection_requests SET
          source_post_id=CASE WHEN source_post_id=ANY($1::uuid[]) THEN NULL ELSE source_post_id END,
          target_post_id=CASE WHEN target_post_id=ANY($1::uuid[]) THEN NULL ELSE target_post_id END,
          status=CASE WHEN status='pending' THEN 'declined' ELSE status END
          WHERE source_post_id=ANY($1::uuid[]) OR target_post_id=ANY($1::uuid[])`,[ids]);
      }
      return (await tx.query(`DELETE FROM ${table} t WHERE ${key}=ANY($1::text[])`,[ids])).rowCount;
    });
  }
  const reports = await purge("social_reports","t.id::text","t.reporter_profile_id AS profile_a,t.target_profile_id AS profile_b","t.created_at<clock_timestamp()-interval '365 days'","t.created_at,t.id");
  const handles = await purge("discovery_handles","t.public_handle","t.viewer_profile_id AS profile_a,(SELECT p.profile_id FROM seeking_posts p WHERE p.id=t.target_post_id) AS profile_b","t.created_at<clock_timestamp()-interval '90 days' AND (NOT EXISTS(SELECT 1 FROM seeking_posts p WHERE p.id=t.source_post_id AND p.status='active' AND p.expires_at>clock_timestamp()) OR NOT EXISTS(SELECT 1 FROM seeking_posts p WHERE p.id=t.target_post_id AND p.status='active' AND p.expires_at>clock_timestamp()))","t.created_at,t.public_handle");
  const passes = await purge("discovery_passes","t.viewer_profile_id::text || ':' || t.target_profile_id::text","t.viewer_profile_id AS profile_a,t.target_profile_id AS profile_b","t.created_at<clock_timestamp()-interval '90 days'","t.created_at,t.viewer_profile_id,t.target_profile_id");
  const posts = await purge("seeking_posts","t.id::text","t.profile_id AS profile_a,NULL::uuid AS profile_b","t.expires_at<clock_timestamp()-interval '90 days'","t.expires_at,t.id");
  const pairs = await purge("social_pairs","t.id::text","t.low_profile_id AS profile_a,t.high_profile_id AS profile_b",`
    t.created_at<clock_timestamp()-interval '180 days'
    AND NOT EXISTS(SELECT 1 FROM seeking_posts p WHERE p.profile_id IN(t.low_profile_id,t.high_profile_id) AND p.status='active' AND p.expires_at>clock_timestamp())
    AND NOT EXISTS(SELECT 1 FROM connection_requests r WHERE r.pair_id=t.id AND (
      r.updated_at>=clock_timestamp()-interval '180 days' OR (r.status='pending'
       AND EXISTS(SELECT 1 FROM seeking_posts p WHERE p.id=r.source_post_id AND p.status='active' AND p.expires_at>clock_timestamp())
       AND EXISTS(SELECT 1 FROM seeking_posts p WHERE p.id=r.target_post_id AND p.status='active' AND p.expires_at>clock_timestamp()))))
    AND NOT EXISTS(SELECT 1 FROM social_matches m WHERE m.pair_id=t.id AND (m.status='active' OR COALESCE(m.closed_at,m.created_at)>=clock_timestamp()-interval '180 days'))
    AND NOT EXISTS(SELECT 1 FROM conversations c JOIN social_matches m ON m.id=c.match_id WHERE m.pair_id=t.id AND (c.status='active' OR c.created_at>=clock_timestamp()-interval '180 days'))
    AND NOT EXISTS(SELECT 1 FROM messages msg JOIN conversations c ON c.id=msg.conversation_id JOIN social_matches m ON m.id=c.match_id WHERE m.pair_id=t.id AND msg.created_at>=clock_timestamp()-interval '180 days')
    AND NOT EXISTS(SELECT 1 FROM match_disclosures d JOIN social_matches m ON m.id=d.match_id WHERE m.pair_id=t.id AND d.created_at>=clock_timestamp()-interval '180 days')
    AND NOT EXISTS(SELECT 1 FROM social_reports report WHERE report.created_at>=clock_timestamp()-interval '365 days' AND (
      report.request_id IN(SELECT r.id FROM connection_requests r WHERE r.pair_id=t.id)
      OR report.match_id IN(SELECT m.id FROM social_matches m WHERE m.pair_id=t.id)))`,"t.created_at,t.id");
  return {dryRun:!apply,reports,handles,passes,posts,pairs};
}
