import 'server-only';
import { z } from 'zod';
import type { Database } from '@/lib/db/types';
import { validate, validateWindows, participantSchema } from '@/features/backend/validation';
import { requireProfile, lockProfiles, reauthorize, requireCapability } from '@/features/social/context';
import {normalizeActivityKey} from '@/features/discovery/activity-normalization';
import { SeekingService } from '@/features/social/seeking';
import { publicKeySchema, strongerMode } from '@/features/social/seeking-schema';
import { opaqueKey } from '@/features/social/pairs';
import { fail } from '@/features/social/errors';
import { trackFunnel } from '@/lib/analytics/funnel';
import { enqueueNotification } from '@/features/notifications/service';
import { searchDraftSchema, preferencesSchema, commandSchema, type SearchDraft } from './schema';
import { transactionFacade, ownSearch, searchRow, projectSearch, projectOffer, addMember, preferencesFor, invalidateSearch, activeProfiles, publishIntents, publishRooms, type OfferRow } from './repository';
import { enqueueIntentJob, processIntentSearch, compatiblePool } from './worker';
const createSchema = z.object({ draft: searchDraftSchema, consent: z.literal(true) }).strict();
function expiry(d: SearchDraft) { const end = new Date(d.seeking.expiresAt ?? Math.max(...d.seeking.availability.map(w => Date.parse(w.endAt)))); if (end.getTime() <= Date.now() || end.getTime() > Date.now() + 30 * 86400000)
    fail('INVALID_INPUT'); validateWindows(participantSchema.parse({ displayName: 'Seeking', availability: d.seeking.availability }), end); if (d.seeking.availability.some(w => Date.parse(w.startAt) <= Date.now()))
    fail('INVALID_INPUT'); return end; }
class RetryMembers extends Error {
}
export class IntentProductService {
    constructor(private readonly db: Database, private readonly options: {
        analyticsEnabled?: boolean;
    } = {}) { }
    async create(token: string, input: unknown) {
        const { draft } = validate(createSchema, input);
        const end = expiry(draft);
        const search = await this.db.transaction(async (tx) => {
            const own = await requireProfile(tx, token);
            await lockProfiles(tx, [own.id]);
            await reauthorize(tx, token, own.id);
            await requireCapability(tx, own.id, 'connect');
            const savedDraft = { ...draft, seeking: { ...draft.seeking, expiresAt: end.toISOString() } };
            const post = await new SeekingService(transactionFacade(tx), this.options).create(token, savedDraft.seeking);
            const s = (await tx.query<{
                id: string;
                public_key: string;
            }>(`INSERT INTO social_action_searches(public_key,profile_id,post_id,activity_label,draft,needed_people,existing_people,expires_at) VALUES($1,$2,(SELECT id FROM seeking_posts WHERE public_key=$3),$4,$5,$6,$7,$8) RETURNING id,public_key`, [opaqueKey(), own.id, post.publicKey, post.activityLabel, JSON.stringify(savedDraft), draft.neededPeople, draft.existingPeople, end])).rows[0]!;
            const lobby = (await tx.query<{
                id: string;
            }>(`INSERT INTO social_lobbies(search_id,owner_profile_id,capacity,external_count) VALUES($1,$2,$3,$4) RETURNING id`, [s.id, own.id, draft.neededPeople + draft.existingPeople, draft.existingPeople - 1])).rows[0]!;
            await addMember(tx, lobby.id, own, post.privacyMode);
            await enqueueIntentJob(tx, s.id);
            await trackFunnel(tx, 'intent_created', this.options.analyticsEnabled ?? false);
            await trackFunnel(tx, 'search_started', this.options.analyticsEnabled ?? false);
            await publishIntents(tx, [own.id]);
            return projectSearch(tx, await searchRow(tx, s.public_key, own.id));
        });
        // Persistence is committed first. Worker failure leaves a durable retry, never rolls back Start.
        await processIntentSearch(this.db, search.publicKey, this.options).catch(() => undefined);
        return this.get(token, search.publicKey);
    }
    async list(token: string) { return this.db.transaction(async (tx) => { let p = await requireProfile(tx, token); await lockProfiles(tx, [p.id]); p = await reauthorize(tx, token, p.id); const rows = await tx.query<{
        public_key: string;
    }>('SELECT public_key FROM social_action_searches WHERE profile_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20', [p.id]); const result = []; for (const row of rows.rows)
        result.push(await projectSearch(tx, await searchRow(tx, row.public_key, p.id))); return result; }); }
    async get(token: string, key: string) { validate(publicKeySchema, key); return this.db.transaction(async (tx) => { const { search } = await ownSearch(tx, token, key); return projectSearch(tx, search); }); }
    async update(token: string, key: string, input: unknown) {
        validate(publicKeySchema, key);
        const { draft } = validate(createSchema, input), end = expiry(draft);
        await this.db.transaction(async (tx) => {
            const { own, search: s } = await ownSearch(tx, token, key);
            await requireCapability(tx, own.id, 'seek');
            await requireCapability(tx, own.id, 'connect');
            if (s.status !== 'active' || s.expires_at.getTime() <= Date.now())
                fail('CONFLICT');
            if ((await tx.query("SELECT 1 FROM social_candidate_offers WHERE search_id=$1 AND status='accepted'", [s.id])).rows.length)
                fail('CONFLICT');
            const mode = draft.seeking.privacyMode ?? own.privacy_mode;
            if (strongerMode(own.privacy_mode, mode) !== mode)
                fail('INVALID_INPUT');
            await invalidateSearch(tx, s.id);
            const d = { ...draft, seeking: { ...draft.seeking, expiresAt: end.toISOString() } };
            await tx.query(`UPDATE seeking_posts SET raw_text=$2,activity_key=$3,activity_label=$4,interaction_mode=$5,format=$6,city=$7,area=$8,skill=$9,languages=$10,desired_age_bands=$11,group_size=$12,privacy_mode=$13,expires_at=$14 WHERE id=$1`, [s.post_id, d.seeking.rawText, normalizeActivityKey(d.seeking.activityKey), d.seeking.activityLabel, d.seeking.interactionMode, d.seeking.format, d.seeking.city, d.seeking.area, d.seeking.skill, d.seeking.languages, d.seeking.desiredAgeBands, d.seeking.groupSize, mode, end]);
            await tx.query('DELETE FROM seeking_availability WHERE post_id=$1', [s.post_id]);
            await tx.query('DELETE FROM seeking_tags WHERE post_id=$1', [s.post_id]);
            for (const [i, w] of d.seeking.availability.entries())
                await tx.query('INSERT INTO seeking_availability(post_id,slot,start_at,end_at) VALUES($1,$2,$3,$4)', [s.post_id, i + 1, w.startAt, w.endAt]);
            for (const [i, t] of d.seeking.tags.entries())
                await tx.query('INSERT INTO seeking_tags(post_id,slot,value) VALUES($1,$2,$3)', [s.post_id, i + 1, t]);
            await tx.query('UPDATE social_action_searches SET draft=$2,activity_label=$3,needed_people=$4,existing_people=$5,expires_at=$6,revision=revision+1,compatible_count=0 WHERE id=$1', [s.id, JSON.stringify(d), d.seeking.activityLabel, d.neededPeople, d.existingPeople, end]);
            await tx.query('UPDATE social_lobbies SET capacity=$2,external_count=$3 WHERE id=$1', [s.lobby_id, d.neededPeople + d.existingPeople, d.existingPeople - 1]);
            await tx.query("UPDATE social_lobby_members SET privacy_mode=CASE WHEN privacy_mode='INCOGNITO' OR $3='INCOGNITO' THEN 'INCOGNITO' WHEN privacy_mode='PRIVATE' OR $3='PRIVATE' THEN 'PRIVATE' ELSE 'OPEN' END WHERE lobby_id=$1 AND profile_id=$2", [s.lobby_id, own.id, mode]);
            await enqueueIntentJob(tx, s.id);
            await publishIntents(tx, [own.id]);
        });
        await processIntentSearch(this.db, key, this.options).catch(() => undefined);
        return this.get(token, key);
    }
    async command(token: string, key: string, input: unknown) {
        validate(publicKeySchema, key);
        const command = validate(commandSchema, input);
        const result = await this.db.transaction(async (tx) => {
            const { own, search: s } = await ownSearch(tx, token, key);
            if (s.status !== 'active' || s.expires_at.getTime() <= Date.now())
                fail('CONFLICT');
            if (command.type === 'stop') {
                await tx.query("UPDATE social_action_searches SET status='closed' WHERE id=$1", [s.id]);
                await tx.query("UPDATE social_lobbies SET status='closed' WHERE id=$1 AND status='forming'",[s.lobby_id]);
                await tx.query("UPDATE seeking_posts SET status='closed' WHERE id=$1", [s.post_id]);
                await invalidateSearch(tx, s.id);
            }
            else {
                const end = new Date(s.expires_at.getTime() + (command.minutes ?? 60) * 60000);
                if (end.getTime() > s.created_at.getTime() + 30 * 86400000)
                    fail('INVALID_INPUT');
                await invalidateSearch(tx, s.id);
                const d = { ...s.draft, seeking: { ...s.draft.seeking, expiresAt: end.toISOString() } };
                await tx.query('UPDATE social_action_searches SET expires_at=$2,draft=$3,revision=revision+1 WHERE id=$1', [s.id, end, JSON.stringify(d)]);
                await tx.query('UPDATE seeking_posts SET expires_at=$2 WHERE id=$1', [s.post_id, end]);
                await enqueueIntentJob(tx, s.id);
            }
            await publishIntents(tx, [own.id]);
            return projectSearch(tx, await searchRow(tx, key, own.id));
        });
        if (command.type === 'extend')
            await processIntentSearch(this.db, key, this.options).catch(() => undefined);
        return result;
    }
    async preferences(token: string) { return this.db.transaction(async (tx) => { const p = await requireProfile(tx, token); await lockProfiles(tx, [p.id]); await reauthorize(tx, token, p.id); return preferencesFor(tx, p.id); }); }
    async savePreferences(token: string, input: unknown) { const settings = validate(preferencesSchema, input); return this.db.transaction(async (tx) => { const p = await requireProfile(tx, token); await lockProfiles(tx, [p.id]); await reauthorize(tx, token, p.id); await tx.query('INSERT INTO social_conversation_preferences(profile_id,settings) VALUES($1,$2) ON CONFLICT(profile_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=clock_timestamp()', [p.id, JSON.stringify(settings)]); await publishIntents(tx, [p.id]); return settings; }); }
    async offers(token: string) { return this.db.transaction(async (tx) => { const p = await requireProfile(tx, token); await lockProfiles(tx, [p.id]); await reauthorize(tx, token, p.id); const rows = await tx.query<OfferRow>(`SELECT o.* FROM social_candidate_offers o JOIN social_action_searches s ON s.id=o.search_id JOIN social_profiles owner ON owner.id=s.profile_id WHERE o.recipient_profile_id=$1 AND owner.deleted_at IS NULL AND owner.moderation_status='active' AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_profile_id=$1 AND b.blocked_profile_id=s.profile_id) OR(b.blocker_profile_id=s.profile_id AND b.blocked_profile_id=$1)) ORDER BY o.created_at DESC,o.id DESC LIMIT 30`, [p.id]); return Promise.all(rows.rows.map(o => projectOffer(tx, o))); }); }
    async offer(token: string, key: string) {
        validate(publicKeySchema,key);
        return this.db.transaction(async tx=>{
            const p=await requireProfile(tx,token);await lockProfiles(tx,[p.id]);await reauthorize(tx,token,p.id);
            const row=(await tx.query<OfferRow>(`SELECT o.* FROM social_candidate_offers o JOIN social_action_searches s ON s.id=o.search_id JOIN social_profiles owner ON owner.id=s.profile_id WHERE o.public_key=$2 AND o.recipient_profile_id=$1 AND owner.deleted_at IS NULL AND owner.moderation_status='active' AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_profile_id=$1 AND b.blocked_profile_id=s.profile_id) OR(b.blocker_profile_id=s.profile_id AND b.blocked_profile_id=$1))`,[p.id,key])).rows[0]??fail('NOT_FOUND');
            return projectOffer(tx,row);
        });
    }
    async respond(token: string, key: string, input: unknown) {
        validate(publicKeySchema, key);
        const { action } = validate(z.object({ action: z.enum(['accept', 'decline']) }).strict(), input);
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                return await this.db.transaction(async (tx) => {
                    const p = await requireProfile(tx, token);
                    const initial = (await tx.query<OfferRow>('SELECT * FROM social_candidate_offers WHERE public_key=$1 AND recipient_profile_id=$2', [key, p.id])).rows[0] ?? fail('NOT_FOUND');
                    const lookup = (await tx.query<{
                        public_key: string;
                    }>('SELECT public_key FROM social_action_searches WHERE id=$1', [initial.search_id])).rows[0] ?? fail('NOT_FOUND');
                    const s0 = await searchRow(tx, lookup.public_key);
                    const members = (await tx.query<{
                        profile_id: string;
                    }>('SELECT profile_id FROM social_lobby_members WHERE lobby_id=$1 AND status=\'active\'', [s0.lobby_id])).rows.map(m => m.profile_id);
                    const locked = [p.id, s0.profile_id, ...members];
                    await lockProfiles(tx, locked);
                    const own = await reauthorize(tx, token, p.id);
                    await requireCapability(tx, own.id, 'connect');
                    const s = await searchRow(tx, lookup.public_key, undefined, true);
                    const current = (await tx.query<{
                        profile_id: string;
                    }>("SELECT profile_id FROM social_lobby_members WHERE lobby_id=$1 AND status='active'", [s.lobby_id])).rows.map(m => m.profile_id);
                    if (current.some(id => !locked.includes(id)))
                        throw new RetryMembers();
                    const profiles = await activeProfiles(tx, locked);
                    if (!profiles.has(s.profile_id) || current.some(id => !profiles.has(id)))
                        fail('CONFLICT');
                    const o = (await tx.query<OfferRow>('SELECT * FROM social_candidate_offers WHERE id=$1 FOR UPDATE', [initial.id])).rows[0] ?? fail('NOT_FOUND');
                    if ((await tx.query('SELECT 1 FROM social_blocks WHERE blocker_profile_id=ANY($1::uuid[]) AND blocked_profile_id=ANY($1::uuid[])', [[...current, p.id]])).rows.length)
                        fail('CONFLICT');
                    if (o.status === 'accepted' && action === 'accept') {
                        if (!current.includes(p.id) || s.lobby_status === 'closed')
                            fail('CONFLICT');
                        return projectOffer(tx, o);
                    }
                    if (o.status !== 'pending' || o.source_revision !== s.revision || o.expires_at.getTime() <= Date.now() || s.expires_at.getTime() <= Date.now() || s.status !== 'active')
                        fail('CONFLICT');
                    if (action === 'decline') {
                        await tx.query("UPDATE social_candidate_offers SET status='declined' WHERE id=$1", [o.id]);
                        o.status = 'declined';
                        await publishIntents(tx, [p.id, s.profile_id]);
                        return projectOffer(tx, o);
                    }
                    const candidates = await compatiblePool(tx, s, [o.target_post_id], profiles, true);
                    if (Array.isArray(candidates) || !candidates.compatible.some(c => c.profileId === p.id && c.id === o.target_post_id))
                        fail('CONFLICT');
                    // Authorize every current member against the joining participant, after all sorted locks.
                    if ((await tx.query(`SELECT 1 FROM social_blocks WHERE (blocker_profile_id=$1 AND blocked_profile_id=ANY($2::uuid[])) OR(blocked_profile_id=$1 AND blocker_profile_id=ANY($2::uuid[]))`, [p.id, current])).rows.length)
                        fail('CONFLICT');
                    if (current.length + s.external_count >= s.capacity)
                        fail('CONFLICT');
                    await tx.query("UPDATE social_candidate_offers SET status='accepted' WHERE id=$1", [o.id]);
                    o.status = 'accepted';
                    const target = candidates.batch.rows.get(o.target_post_id)!;
                    await addMember(tx, s.lobby_id, own, target.privacy_mode);
                    await trackFunnel(tx, 'offer_accepted', this.options.analyticsEnabled ?? false);
                    if (current.length + 1 + s.external_count === s.capacity) {
                        await tx.query("UPDATE social_lobbies SET status='ready' WHERE id=$1", [s.lobby_id]);
                        const roomKey = opaqueKey();
                        await tx.query('INSERT INTO social_rooms(public_key,lobby_id) VALUES($1,$2)', [roomKey, s.lobby_id]);
                        await tx.query("UPDATE social_action_searches SET status='filled' WHERE id=$1", [s.id]);
                        await tx.query("UPDATE seeking_posts SET status='closed' WHERE id=$1", [s.post_id]);
                        await invalidateSearch(tx, s.id);
                        for (const id of [...current, p.id])
                            await enqueueNotification(tx, { recipientProfileId: id, type: 'LOBBY_READY', roomKey, dedupeKey: 'ready:' + roomKey });
                        await trackFunnel(tx, 'lobby_filled', this.options.analyticsEnabled ?? false);
                        await trackFunnel(tx, 'room_opened', this.options.analyticsEnabled ?? false);
                        await publishRooms(tx, [...current, p.id]);
                    }
                    await publishIntents(tx, [...current, p.id]);
                    return projectOffer(tx, o);
                });
            }
            catch (error) {
                if (!(error instanceof RetryMembers))
                    throw error;
            }
        }
        return fail('CONFLICT');
    }
}
