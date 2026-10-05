import 'server-only';
import type { Database, DatabaseExecutor } from '@/lib/db/types';
import { lockProfiles, type ProfileRow } from '@/features/social/context';
import { opaqueKey } from '@/features/social/pairs';
import { loadCandidateBatch, type PostRow } from '@/features/social/post-repository';
import { rankCompatible } from '@/features/discovery/engine';
import { enqueueNotification } from '@/features/notifications/service';
import { trackFunnel } from '@/lib/analytics/funnel';
import { searchRow, activeProfiles, preferencesFor, preferencesBatch, publishIntents, closeLobby, type SearchRow } from './repository';
import { compatibleAttributes } from './compatibility';
import type { SearchDraft } from './schema';
type Job = {
    id: string;
    search_id: string;
    attempts: number;
    lease_key: string;
};
export async function enqueueIntentJob(tx: DatabaseExecutor, searchId: string) { await tx.query(`INSERT INTO social_intent_jobs(search_id) VALUES($1) ON CONFLICT(search_id) DO UPDATE SET status='pending',attempts=0,lease_key=NULL,lease_until=NULL,finished_at=NULL,failure_code=NULL,available_at=clock_timestamp()`, [searchId]); }
/** Only bounded job enqueueing; caller already holds its own profile lock. */
export async function enqueueRelevantIntentJobs(tx: DatabaseExecutor, post: PostRow) { await tx.query(`INSERT INTO social_intent_jobs(search_id) SELECT s.id FROM social_action_searches s JOIN seeking_posts p ON p.id=s.post_id WHERE s.status='active' AND s.expires_at>clock_timestamp() AND p.activity_key=$1 AND s.profile_id<>$2 ORDER BY s.created_at DESC,s.id LIMIT 100 ON CONFLICT(search_id) DO UPDATE SET status='pending',attempts=0,lease_key=NULL,lease_until=NULL,finished_at=NULL,failure_code=NULL,available_at=clock_timestamp()`, [post.activity_key, post.profile_id]); }
function quiet(preferences: Awaited<ReturnType<typeof preferencesFor>>) { if (!preferences.quietHours)
    return false; const hour = Number(new Intl.DateTimeFormat('en', { timeZone: preferences.timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date())); const { startHour: a, endHour: b } = preferences.quietHours; return a < b ? hour >= a && hour < b : hour >= a || hour < b; }
/** Caller holds every candidate profile lock. Recheck all exclusions, preferences and posts after waiting. */
export async function compatiblePool(tx: DatabaseExecutor, s: SearchRow, postIds: string[], profiles: Map<string, ProfileRow>, allowQuiet = false) {
    const owner = profiles.get(s.profile_id);
    if (!owner)
        return [];
    const source = (await tx.query<PostRow>("SELECT s.* FROM seeking_posts s JOIN social_profiles p ON p.id=s.profile_id WHERE s.id=$1 AND s.status='active' AND s.expires_at>clock_timestamp() AND p.can_seek", [s.post_id])).rows[0];
    if (!source)
        return [];
    const batch = await loadCandidateBatch(tx, s.profile_id, postIds, { row: source, profile: owner });
    const suppression = (await tx.query<{
        profile_id: string;
    }>(`SELECT p.id profile_id FROM social_profiles p WHERE p.id=ANY($2::uuid[]) AND (EXISTS(SELECT 1 FROM discovery_passes d WHERE (d.viewer_profile_id=$1 AND d.target_profile_id=p.id) OR (d.viewer_profile_id=p.id AND d.target_profile_id=$1)) OR EXISTS(SELECT 1 FROM connection_requests r WHERE (r.sender_profile_id=$1 AND r.recipient_profile_id=p.id) OR (r.sender_profile_id=p.id AND r.recipient_profile_id=$1)))`, [s.profile_id, [...profiles.keys()]])).rows;
    const excluded = new Set(suppression.map(p => p.profile_id));
    const attributes = (await tx.query<{
        post_id: string;
        draft: SearchDraft;
    }>("SELECT post_id,draft FROM social_action_searches WHERE post_id=ANY($1::uuid[]) AND status='active'", [postIds])).rows;
    const attrs = new Map(attributes.map(a => [a.post_id, a.draft.attributes]));
    const preferences=await preferencesBatch(tx,[...profiles.keys()]);
    const eligible = [];
    let deferredQuiet = false;
    for (const c of batch.candidates.values()) {
        if (c.id === source.id || !profiles.has(c.profileId) || excluded.has(c.profileId))
            continue;
        const prefs = preferences.get(c.profileId)!, rule = prefs.activities.find(a => a.activityKey === source.activity_key);
        if (!prefs.offersEnabled || (rule && !rule.enabled) || !compatibleAttributes(source.activity_key, s.draft.attributes, attrs.get(c.id) ?? {}) || !compatibleAttributes(source.activity_key, attrs.get(c.id) ?? {}, s.draft.attributes) || (rule && !compatibleAttributes(source.activity_key, rule.attributes, s.draft.attributes)))
            continue;
        if (!allowQuiet && quiet(prefs)) {
            deferredQuiet = true;
            continue;
        }
        eligible.push(c);
    }
    // Rank the full bounded pool by repeated deterministic chunks so compatibleCount remains actual.
    const compatible = eligible.filter(c => rankCompatible(batch.candidates.get(source.id)!, [c], { now: new Date().toISOString(), limit: 1 }).length > 0);
    return { source, batch, compatible, deferredQuiet };
}
async function claim(db: Database, limit: number, key?: string) {
    return db.transaction(async (tx) => {
        await tx.query(`UPDATE social_intent_jobs SET status='failed',lease_key=NULL,lease_until=NULL,finished_at=clock_timestamp(),failure_code='LEASE_EXHAUSTED' WHERE id IN(SELECT id FROM social_intent_jobs WHERE attempts>=5 AND (status='pending' OR(status='processing' AND lease_until<=clock_timestamp())) ORDER BY available_at,id LIMIT $1 FOR UPDATE SKIP LOCKED)`, [limit]);
        return (await tx.query<Job>(`WITH chosen AS(SELECT j.id FROM social_intent_jobs j JOIN social_action_searches s ON s.id=j.search_id WHERE j.attempts<5 AND ((j.status='pending' AND j.available_at<=clock_timestamp()) OR(j.status='processing' AND j.lease_until<=clock_timestamp())) AND ($3::text IS NULL OR s.public_key=$3) ORDER BY j.available_at,j.id LIMIT $1 FOR UPDATE OF j SKIP LOCKED) UPDATE social_intent_jobs j SET status='processing',attempts=j.attempts+1,lease_key=$2,lease_until=clock_timestamp()+interval '5 minutes',failure_code=NULL FROM chosen WHERE j.id=chosen.id RETURNING j.id,j.search_id,j.attempts,j.lease_key`, [limit, opaqueKey(), key ?? null])).rows;
    });
}
async function finish(tx: DatabaseExecutor, j: Job) { await tx.query("UPDATE social_intent_jobs SET status='completed',lease_key=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE id=$1 AND lease_key=$2 AND status='processing'", [j.id, j.lease_key]); }
async function processOne(db: Database, j: Job, analyticsEnabled = false) {
    return db.transaction(async (tx) => {
        const initial = (await tx.query<{
            public_key: string;
            profile_id: string;
            post_id: string;
        }>('SELECT public_key,profile_id,post_id FROM social_action_searches WHERE id=$1', [j.search_id])).rows[0];
        if (!initial)
            return null;
        const pool = (await tx.query<{
            id: string;
            profile_id: string;
        }>(`SELECT t.id,t.profile_id FROM seeking_posts t JOIN seeking_posts source ON source.id=$1 WHERE t.profile_id<>source.profile_id AND t.activity_key=source.activity_key AND t.status='active' AND t.expires_at>clock_timestamp() ORDER BY t.created_at DESC,t.id LIMIT 100`, [initial.post_id])).rows;
        await lockProfiles(tx, [initial.profile_id, ...pool.map(p => p.profile_id)]);
        const owned = await tx.query("SELECT id FROM social_intent_jobs WHERE id=$1 AND status='processing' AND lease_key=$2 AND lease_until>clock_timestamp() FOR UPDATE", [j.id, j.lease_key]);
        if (!owned.rows.length)
            return null;
        const s = await searchRow(tx, initial.public_key, undefined, true);
        const profiles = await activeProfiles(tx, [initial.profile_id, ...pool.map(p => p.profile_id)]);
        if (s.status !== 'active' || s.expires_at.getTime() <= Date.now() || !profiles.has(initial.profile_id)) {
            if (s.status === 'active' && s.expires_at.getTime() <= Date.now()) {
                await tx.query("UPDATE social_action_searches SET status='expired' WHERE id=$1", [s.id]);
                await tx.query("UPDATE seeking_posts SET status='closed' WHERE id=$1", [s.post_id]);
                const expired=(await tx.query<{recipient_profile_id:string}>("UPDATE social_candidate_offers SET status='expired' WHERE search_id=$1 AND status='pending' RETURNING recipient_profile_id", [s.id])).rows;
                await tx.query("UPDATE social_lobbies SET status='closed' WHERE id=$1 AND status='forming'",[s.lobby_id]);await publishIntents(tx,[s.profile_id,...expired.map(o=>o.recipient_profile_id)]);
            }
            await finish(tx, j);
            return 0;
        }
        const poolResult = await compatiblePool(tx, s, pool.map(p => p.id), profiles);
        if (Array.isArray(poolResult)) {
            await closeLobby(tx,s.lobby_id);
            await finish(tx, j);
            return 0;
        }
        await tx.query('UPDATE social_action_searches SET compatible_count=$2 WHERE id=$1', [s.id, poolResult.compatible.length]);
        await tx.query("UPDATE social_candidate_offers SET status='expired' WHERE search_id=$1 AND status='pending' AND expires_at<=clock_timestamp()", [s.id]);
        const slots = (await tx.query<{
            pending_slot: number;
        }>("SELECT pending_slot FROM social_candidate_offers WHERE search_id=$1 AND status='pending'", [s.id])).rows;
        const free = Array.from({ length: 10 }, (_, i) => i + 1).filter(n => !slots.some(s => s.pending_slot === n));
        const already = (await tx.query<{
            recipient_profile_id: string;
        }>("SELECT recipient_profile_id FROM social_candidate_offers WHERE search_id=$1 AND (source_revision=$2 OR status IN('pending','accepted','declined'))", [s.id,s.revision])).rows;
        const previous = new Set(already.map(o => o.recipient_profile_id));
        const unoffered = poolResult.compatible.filter(c => !previous.has(c.profileId));
        const ranked = rankCompatible(poolResult.batch.candidates.get(poolResult.source.id)!, unoffered, { now: new Date().toISOString(), limit: 5 });
        let offered = 0;
        for (const match of ranked) {
            if (!free.length)
                break;
            const target = match.candidate;
            const expires = new Date(Math.min(Date.now() + 86400000, s.expires_at.getTime(), Date.parse(target.expiresAt), ...s.draft.seeking.availability.map(w => Date.parse(w.endAt)), ...target.availability.map(w => Date.parse(w.endAt))));
            if (expires.getTime() <= Date.now())
                continue;
            const key = opaqueKey();
            const inserted = await tx.query(`INSERT INTO social_candidate_offers(public_key,search_id,recipient_profile_id,target_post_id,pending_slot,source_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(search_id,recipient_profile_id,source_revision) DO NOTHING RETURNING id`, [key, s.id, target.profileId, target.id, free[0], s.revision, expires]);
            if (!inserted.rows.length)
                continue;
            free.shift();
            offered++;
            await enqueueNotification(tx, { recipientProfileId: target.profileId, peerProfileId: s.profile_id, type: 'OFFER_RECEIVED', offerKey: key, dedupeKey: 'offer:' + key });
            await trackFunnel(tx, 'offer_delivered', analyticsEnabled);
            await publishIntents(tx, [target.profileId]);
        }
        await publishIntents(tx, [s.profile_id]);
        if (poolResult.deferredQuiet) {
            await tx.query("UPDATE social_intent_jobs SET status='pending',attempts=0,lease_key=NULL,lease_until=NULL,available_at=clock_timestamp()+interval '1 hour' WHERE id=$1 AND lease_key=$2", [j.id, j.lease_key]);
        }
        else
            await finish(tx, j);
        return poolResult.deferredQuiet ? {offered,deferred:true as const} : offered;
    });
}
export async function processIntentJobs(db: Database, options: {
    limit?: number;
    signal?: AbortSignal;
    searchKey?: string;
    analyticsEnabled?: boolean;
} = {}) {
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
        throw new Error('Intent job limit must be 1..20');
    const result = { claimed: 0, completed: 0, retried: 0, failed: 0, offered: 0 };
    if (options.signal?.aborted)
        return result;
    const jobs = await claim(db, limit, options.searchKey);
    result.claimed = jobs.length;
    for (const [i, j] of jobs.entries()) {
        if (options.signal?.aborted) {
            await db.query("UPDATE social_intent_jobs SET status='pending',attempts=attempts-1,lease_key=NULL,lease_until=NULL WHERE id=ANY($1::uuid[]) AND lease_key=$2 AND status='processing'", [jobs.slice(i).map(j => j.id), j.lease_key]);
            break;
        }
        try {
            const offered = await processOne(db, j, options.analyticsEnabled ?? false);
            if (typeof offered === 'number') {
                result.completed++;
                result.offered += offered;
            } else if(offered !== null) { result.offered += offered.offered; }
        }
        catch {
            const failed = j.attempts >= 5;
            const changed = await db.query(`UPDATE social_intent_jobs SET status=$3,lease_key=NULL,lease_until=NULL,available_at=clock_timestamp()+($4::int*interval '1 second'),failure_code='MATCHING_FAILED',finished_at=CASE WHEN $3='failed' THEN clock_timestamp() ELSE NULL END WHERE id=$1 AND lease_key=$2 AND status='processing'`, [j.id, j.lease_key, failed ? 'failed' : 'pending', Math.min(3600, 15 * 2 ** j.attempts)]);
            if (changed.rowCount)
                result[failed ? 'failed' : 'retried']++;
        }
    }
    return result;
}
export async function processIntentSearch(db: Database, searchKey: string, options: {
    analyticsEnabled?: boolean;
} = {}) { return processIntentJobs(db, { limit: 1, searchKey, ...options }); }
