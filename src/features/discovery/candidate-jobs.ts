import "server-only";
import { z } from "zod";
import type { Database, DatabaseExecutor } from "@/lib/db/types";
import { lockProfiles, type ProfileRow } from "@/features/social/context";
import { opaqueKey } from "@/features/social/pairs";
import { loadCandidateBatch, type PostRow } from "@/features/social/post-repository";
import { enqueueNotification } from "@/features/notifications/service";
import { publishSocialEvent } from "@/features/realtime/events";
import { rankCompatible } from "./engine";
import { normalizeActivityKey } from "./activity-normalization";

type Job = { id: string; post_id: string; attempts: number; lease_key: string };
type Profile = ProfileRow & { can_seek: boolean; can_connect: boolean; moderation_status: string };
export type CandidateJobResult = { claimed: number; completed: number; retried: number; failed: number; notified: number };

/** Invoke within the successful post-creation transaction. No matching or interest is sent here. */
export async function enqueueCandidateJob(tx: DatabaseExecutor, postId: string): Promise<void> {
  z.uuid().parse(postId);
  await tx.query("INSERT INTO social_candidate_jobs(post_id) VALUES($1) ON CONFLICT(post_id) DO NOTHING", [postId]);
}

async function claim(db: Database, limit: number): Promise<Job[]> {
  return db.transaction(async tx => {
    // Claim transactions finish before profile locking: no job-row -> profile-lock inversion.
    await tx.query(`UPDATE social_candidate_jobs SET status='failed',lease_key=NULL,lease_until=NULL,finished_at=clock_timestamp(),failure_code='LEASE_EXHAUSTED'
      WHERE id IN(SELECT id FROM social_candidate_jobs WHERE attempts>=5 AND ((status='processing' AND lease_until<=clock_timestamp()) OR status='pending') ORDER BY available_at,id LIMIT $1 FOR UPDATE SKIP LOCKED)`, [limit]);
    return (await tx.query<Job>(`WITH chosen AS(SELECT id FROM social_candidate_jobs WHERE attempts<5
      AND ((status='pending' AND available_at<=clock_timestamp()) OR (status='processing' AND lease_until<=clock_timestamp()))
      ORDER BY available_at,id LIMIT $1 FOR UPDATE SKIP LOCKED)
      UPDATE social_candidate_jobs j SET status='processing',attempts=j.attempts+1,lease_key=$2,lease_until=clock_timestamp()+interval '5 minutes',failure_code=NULL
      FROM chosen WHERE j.id=chosen.id RETURNING j.id,j.post_id,j.attempts,j.lease_key`, [limit, opaqueKey()])).rows;
  });
}
async function complete(tx: DatabaseExecutor, job: Job) {
  await tx.query(`UPDATE social_candidate_jobs SET status='completed',lease_key=NULL,lease_until=NULL,finished_at=clock_timestamp(),failure_code=NULL
    WHERE id=$1 AND lease_key=$2 AND status='processing'`, [job.id, job.lease_key]);
}
function eligible(profile: Profile | undefined): profile is Profile {
  return !!profile && profile.moderation_status === "active" && profile.can_seek && profile.can_connect;
}

async function processOne(db: Database, job: Job): Promise<number | null> {
  return db.transaction(async tx => {
    const original = (await tx.query<PostRow>("SELECT * FROM seeking_posts WHERE id=$1", [job.post_id])).rows[0];
    if (!original) return null; // Deleted posts cascade their jobs away.
    const pool = (await tx.query<{id:string;profile_id:string}>(`SELECT id,profile_id FROM seeking_posts WHERE profile_id<>$1
      AND activity_key=$2 AND status='active' AND expires_at>clock_timestamp() ORDER BY created_at DESC,id LIMIT 100`, [original.profile_id, normalizeActivityKey(original.activity_key)])).rows;
    const profileIds = [...new Set([original.profile_id, ...pool.map(post => post.profile_id)])];
    await lockProfiles(tx, profileIds);
    // The lease may have been reclaimed while waiting: only its current owner can emit or finish.
    const owned = await tx.query(`SELECT id FROM social_candidate_jobs WHERE id=$1 AND lease_key=$2 AND status='processing'
      AND lease_until>clock_timestamp() FOR UPDATE`, [job.id, job.lease_key]);
    if (!owned.rows.length) return null;
    const source = (await tx.query<PostRow>("SELECT * FROM seeking_posts WHERE id=$1", [job.post_id])).rows[0];
    const profileRows = await tx.query<Profile>("SELECT * FROM social_profiles WHERE id=ANY($1::uuid[])", [profileIds]);
    const profiles = new Map(profileRows.rows.map(profile => [profile.id, profile]));
    const owner = profiles.get(original.profile_id);
    if (!source || source.profile_id !== original.profile_id || source.status !== "active" || source.expires_at.getTime() <= Date.now() || !eligible(owner)) {
      await complete(tx, job); return 0;
    }
    const ids = pool.map(post => post.id);
    const batch = await loadCandidateBatch(tx, source.profile_id, ids, {row:source, profile:owner});
    // Both directional passes and all request history suppress unsolicited future-candidate nudges.
    const suppressed = await tx.query<{profile_id:string}>(`SELECT p.id profile_id FROM social_profiles p WHERE p.id=ANY($2::uuid[])
      AND (EXISTS(SELECT 1 FROM discovery_passes d WHERE (d.viewer_profile_id=$1 AND d.target_profile_id=p.id) OR (d.viewer_profile_id=p.id AND d.target_profile_id=$1))
      OR EXISTS(SELECT 1 FROM connection_requests r WHERE (r.sender_profile_id=$1 AND r.recipient_profile_id=p.id) OR (r.sender_profile_id=p.id AND r.recipient_profile_id=$1)))`, [source.profile_id, profileIds]);
    const excluded = new Set(suppressed.rows.map(row => row.profile_id));
    const originals = new Map(pool.map(post => [post.id, post.profile_id]));
    const candidates = [...batch.candidates.values()].filter(candidate => candidate.id !== source.id
      && candidate.profileId === originals.get(candidate.id) && eligible(profiles.get(candidate.profileId)) && !excluded.has(candidate.profileId));
    const now = new Date().toISOString();
    const ranked = rankCompatible(batch.candidates.get(source.id)!, candidates, {now, limit:5});
    let notified = 0;
    const changed = new Set<string>();
    for (const match of ranked) {
      const target = match.candidate;
      const dedupeKey = `candidate:${[source.id, target.id].sort().join(":")}`;
      for (const [recipient, peer] of [[source.profile_id, target.profileId], [target.profileId, source.profile_id]] as const) {
        const existing = await tx.query("SELECT 1 FROM social_notifications WHERE recipient_profile_id=$1 AND dedupe_key=$2", [recipient, dedupeKey]);
        if (existing.rows.length) continue;
        await enqueueNotification(tx, {recipientProfileId:recipient, peerProfileId:peer, type:"CANDIDATE_FOUND", dedupeKey});
        notified++; changed.add(recipient);
      }
    }
    if (changed.size) await publishSocialEvent(tx, [...changed], {topic:"discovery"});
    await complete(tx, job);
    return notified;
  });
}

/** Run explicitly from a scheduled worker. A call performs at most twenty persisted jobs. */
export async function processCandidateJobs(db: Database, options: {limit?:number} = {}): Promise<CandidateJobResult> {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Use a candidate worker limit from 1 to 20.");
  const result: CandidateJobResult = {claimed:0, completed:0, retried:0, failed:0, notified:0};
  const jobs = await claim(db, limit); result.claimed = jobs.length;
  for (const job of jobs) {
    try {
      const notified = await processOne(db, job);
      if (notified !== null) { result.notified += notified; result.completed++; }
    }
    catch {
      // Persist only an enumerated code, never activity, profile, database or error content.
      const failed = job.attempts >= 5;
      const changed = await db.query(`UPDATE social_candidate_jobs SET status=$3,lease_key=NULL,lease_until=NULL,
        available_at=clock_timestamp()+($4::integer*interval '1 second'),failure_code='MATCHING_FAILED',
        finished_at=CASE WHEN $3='failed' THEN clock_timestamp() ELSE NULL END
        WHERE id=$1 AND lease_key=$2 AND status='processing'`, [job.id, job.lease_key, failed ? "failed" : "pending", Math.min(3600, 15 * 2 ** job.attempts)]);
      if (changed.rowCount) result[failed ? "failed" : "retried"]++;
    }
  }
  return result;
}
