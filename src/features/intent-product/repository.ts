import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Database, DatabaseExecutor } from '@/lib/db/types';
import { requireProfile, reauthorize, lockProfiles, requireCapability, type ProfileRow } from '@/features/social/context';
import { fail } from '@/features/social/errors';
import { opaqueKey } from '@/features/social/pairs';
import { strongerMode } from '@/features/social/seeking-schema';
import { publishSocialEvent } from '@/features/realtime/events';
import { searchDTOSchema, offerDTOSchema, preferencesSchema, defaultPreferences, type SearchDraft, type Preference } from './schema';
export type SearchRow = {
    id: string;
    public_key: string;
    profile_id: string;
    post_id: string;
    status: 'active' | 'filled' | 'closed' | 'expired';
    draft: SearchDraft;
    needed_people: number;
    existing_people: number;
    compatible_count: number;
    revision: number;
    created_at: Date;
    expires_at: Date;
    lobby_id: string;
    capacity: number;
    external_count: number;
    lobby_status: string;
    activity_label: string;
    room_key: string | null;
};
export type OfferRow = {
    id: string;
    public_key: string;
    search_id: string;
    recipient_profile_id: string;
    target_post_id: string;
    status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
    source_revision: number;
    expires_at: Date;
};
export const transactionFacade = (tx: DatabaseExecutor): Database => ({ query: (sql, args) => tx.query(sql, args), transaction: fn => fn(tx), close: async () => { } });
export async function searchRow(tx: DatabaseExecutor, key: string, owner?: string, lock = false): Promise<SearchRow> {
    const r = await tx.query<SearchRow>(`SELECT s.*,l.id lobby_id,l.capacity,l.external_count,l.status lobby_status,s.activity_label,r.public_key room_key FROM social_action_searches s JOIN social_lobbies l ON l.search_id=s.id LEFT JOIN seeking_posts p ON p.id=s.post_id LEFT JOIN social_rooms r ON r.lobby_id=l.id WHERE s.public_key=$1 ${owner ? 'AND s.profile_id=$2' : ''} ${lock ? 'FOR UPDATE OF s,l' : ''}`, [key, ...(owner ? [owner] : [])]);
    return r.rows[0] ?? fail('NOT_FOUND');
}
export async function ownSearch(tx: DatabaseExecutor, token: string, key: string) { const p = await requireProfile(tx, token); await lockProfiles(tx, [p.id]); const own = await reauthorize(tx, token, p.id); return { own, search: await searchRow(tx, key, own.id, true) }; }
/** Coarse action scheduling only: never expose exact candidate intervals or their timezone. */
export function actionTimeHint(draft: SearchDraft, now=new Date()):string {
    const future=draft.seeking.availability.filter(w=>Date.parse(w.endAt)>now.getTime());
    if(!future.length)return 'Время закончилось';
    const first=future.reduce((a,b)=>Date.parse(a.startAt)<Date.parse(b.startAt)?a:b);
    const start=new Date(Math.max(now.getTime(),Date.parse(first.startAt)));
    const day=new Intl.DateTimeFormat('sv-SE',{timeZone:draft.timezone,year:'numeric',month:'2-digit',day:'2-digit'});
    const startDay=day.format(start), today=day.format(now), tomorrow=day.format(new Date(now.getTime()+86400000));
    if(future.some(w=>day.format(new Date(w.startAt))!==startDay))return 'В ближайшие дни';
    const hour=Number(new Intl.DateTimeFormat('en',{timeZone:draft.timezone,hour:'numeric',hourCycle:'h23'}).format(start));
    const period=hour<6?'ночью':hour<12?'утром':hour<18?'днём':'вечером';
    return `${startDay===today?'Сегодня':startDay===tomorrow?'Завтра':'В ближайшие дни'} ${period}`;
}
export async function projectSearch(tx: DatabaseExecutor, s: SearchRow) {
    const counts = (await tx.query<{
        members: string;
        offered: string;
        accepted: string;
    }>(`SELECT (SELECT count(*) FROM social_lobby_members WHERE lobby_id=$1 AND status='active') members,(SELECT count(*) FROM social_candidate_offers WHERE search_id=$2) offered,(SELECT count(*) FROM social_candidate_offers WHERE search_id=$2 AND status='accepted') accepted`, [s.lobby_id, s.id])).rows[0]!;
    return searchDTOSchema.parse({ publicKey: s.public_key, activityLabel: s.activity_label, status: s.status === 'active' && s.expires_at.getTime() <= Date.now() ? 'expired' : s.status, neededPeople: s.needed_people, existingPeople: s.existing_people, capacity: s.capacity, joinedCount: Number(counts.members) + s.external_count, compatibleCount: s.compatible_count, offeredCount: Number(counts.offered), acceptedCount: Number(counts.accepted), roomKey: s.room_key, createdAt: s.created_at.toISOString(), expiresAt: s.expires_at.toISOString(), timeHint: actionTimeHint(s.draft), ownDraft: s.draft });
}
export async function projectOffer(tx: DatabaseExecutor, o: OfferRow) { const s = (await tx.query<{
    public_key: string;
}>('SELECT public_key FROM social_action_searches WHERE id=$1', [o.search_id])).rows[0] ?? fail('NOT_FOUND'); const search = await searchRow(tx, s.public_key); return offerDTOSchema.parse({ publicKey: o.public_key, activityLabel: search.activity_label, status: o.status === 'accepted' && !search.room_key && (search.status !== 'active' || search.expires_at.getTime() <= Date.now()) ? 'cancelled' : o.status === 'pending' && (o.expires_at.getTime() <= Date.now() || search.status !== 'active' || search.expires_at.getTime() <= Date.now()) ? 'expired' : o.status, neededPeople: search.needed_people, timeHint: actionTimeHint(search.draft), attributes: search.draft.attributes, expiresAt: o.expires_at.toISOString(), roomKey: o.status === 'accepted' ? search.room_key : null }); }
export async function preferencesFor(tx: DatabaseExecutor, id: string): Promise<Preference> { const row = (await tx.query<{
    settings: unknown;
}>('SELECT settings FROM social_conversation_preferences WHERE profile_id=$1', [id])).rows[0]; return row ? preferencesSchema.parse(row.settings) : defaultPreferences(); }
export async function preferencesBatch(tx: DatabaseExecutor, ids: readonly string[]): Promise<Map<string, Preference>> {
    const rows = await tx.query<{profile_id:string;settings:unknown}>('SELECT profile_id,settings FROM social_conversation_preferences WHERE profile_id=ANY($1::uuid[])',[ids]);
    const values = new Map(rows.rows.map(row=>[row.profile_id,preferencesSchema.parse(row.settings)]));
    return new Map(ids.map(id=>[id,values.get(id)??defaultPreferences()]));
}
export async function addMember(tx: DatabaseExecutor, lobbyId: string, p: ProfileRow, postPrivacy: ProfileRow['privacy_mode']) {
    const mode = strongerMode(p.privacy_mode, postPrivacy);
    await tx.query(`INSERT INTO social_lobby_members(lobby_id,profile_id,public_key,alias,avatar_seed,privacy_mode) VALUES($1,$2,$3,$4,$5,$6)`, [lobbyId, p.id, opaqueKey(), `Тихий ${randomBytes(6).toString('hex')}`, randomBytes(16).toString('hex'), mode]);
}
export async function invalidateSearch(tx: DatabaseExecutor, id: string) { const recipients = (await tx.query<{
    recipient_profile_id: string;
}>("SELECT recipient_profile_id FROM social_candidate_offers WHERE search_id=$1 AND status='pending' UNION SELECT profile_id recipient_profile_id FROM social_action_searches WHERE id=$1 UNION SELECT m.profile_id recipient_profile_id FROM social_lobby_members m JOIN social_lobbies l ON l.id=m.lobby_id WHERE l.search_id=$1 AND m.status='active'", [id])).rows.map(o => o.recipient_profile_id); await tx.query("UPDATE social_candidate_offers SET status='cancelled' WHERE search_id=$1 AND status='pending'", [id]); await tx.query("UPDATE social_intent_jobs SET status='cancelled',lease_key=NULL,lease_until=NULL WHERE search_id=$1", [id]); if (recipients.length) {
    await publishIntents(tx, recipients);
    for (let i = 0; i < recipients.length; i += 100)
        await publishSocialEvent(tx, recipients.slice(i, i + 100), { topic: 'notifications' });
} }
export async function publishIntents(tx: DatabaseExecutor, ids: string[]) { const sorted = [...new Set(ids)].sort(); for (let i = 0; i < sorted.length; i += 100)
    await publishSocialEvent(tx, sorted.slice(i, i + 100), { topic: 'intents' }); }
export async function publishRooms(tx: DatabaseExecutor, ids: string[]) { const sorted = [...new Set(ids)].sort(); for (let i = 0; i < sorted.length; i += 100)
    await publishSocialEvent(tx, sorted.slice(i, i + 100), { topic: 'rooms' }); }
export async function activeProfiles(tx: DatabaseExecutor, ids: string[]) { const rows = await tx.query<ProfileRow>(`SELECT p.* FROM social_profiles p WHERE p.id=ANY($1::uuid[]) AND p.moderation_status='active' AND p.deleted_at IS NULL AND p.can_connect AND EXISTS(SELECT 1 FROM social_profile_bindings b WHERE b.profile_id=p.id)`, [ids]); return new Map(rows.rows.map(p => [p.id, p])); }
export async function closeBlockedRooms(tx: DatabaseExecutor, a: string, b: string) {
    const affected = (await tx.query<{
        id: string;
    }>(`SELECT l.id FROM social_lobbies l JOIN social_lobby_members a ON a.lobby_id=l.id JOIN social_lobby_members b ON b.lobby_id=l.id WHERE a.profile_id=$1 AND b.profile_id=$2 AND a.status='active' AND b.status='active' ORDER BY l.id FOR UPDATE OF l`, [a, b])).rows;
    const recipients = (await tx.query<{
        profile_id: string;
    }>('SELECT DISTINCT profile_id FROM social_lobby_members WHERE lobby_id=ANY($1::uuid[])', [affected.map(l => l.id)])).rows.map(p => p.profile_id);
    for (const row of affected)
        await closeLobby(tx, row.id);
    await tx.query(`UPDATE social_candidate_offers o SET status='cancelled' FROM social_action_searches s WHERE o.search_id=s.id AND o.status='pending' AND ((s.profile_id=$1 AND o.recipient_profile_id=$2) OR(s.profile_id=$2 AND o.recipient_profile_id=$1))`, [a, b]);
    await publishIntents(tx, [...recipients, a, b]);
    await publishRooms(tx, [...recipients, a, b]);
}
export async function closeLobby(tx: DatabaseExecutor, id: string) {
    await tx.query("UPDATE social_rooms SET status='closed' WHERE lobby_id=$1 AND status NOT IN('completed','archived')", [id]);
    await tx.query("UPDATE social_lobbies SET status='closed' WHERE id=$1 AND status NOT IN('completed','archived')", [id]);
    const s = (await tx.query<{
        id: string;
        post_id: string;
    }>("UPDATE social_action_searches SET status='closed' WHERE id=(SELECT search_id FROM social_lobbies WHERE id=$1) AND status='active' RETURNING id,post_id", [id])).rows[0];
    if (s) {
        await tx.query("UPDATE seeking_posts SET status='closed' WHERE id=$1", [s.post_id]);
        await invalidateSearch(tx, s.id);
    }
}
export async function closeRestrictedRooms(tx: DatabaseExecutor, profileIds: string[]) {
    const lobbies = (await tx.query<{
        id: string;
    }>(`SELECT l.id FROM social_lobbies l WHERE EXISTS(SELECT 1 FROM social_lobby_members m WHERE m.lobby_id=l.id AND m.profile_id=ANY($1::uuid[]) AND m.status='active') ORDER BY l.id FOR UPDATE`, [profileIds])).rows;
    const recipients = (await tx.query<{
        profile_id: string;
    }>('SELECT DISTINCT profile_id FROM social_lobby_members WHERE lobby_id=ANY($1::uuid[])', [lobbies.map(l => l.id)])).rows;
    for (const l of lobbies)
        await closeLobby(tx, l.id);
    await tx.query(`UPDATE social_candidate_offers o SET status='cancelled' FROM social_action_searches s WHERE o.search_id=s.id AND o.status='pending' AND (s.profile_id=ANY($1::uuid[]) OR o.recipient_profile_id=ANY($1::uuid[]))`, [profileIds]);
    await publishRooms(tx, recipients.map(p => p.profile_id));
    await publishIntents(tx, recipients.map(p => p.profile_id));
}
export async function eraseIntentProfile(tx: DatabaseExecutor, id: string) {
    await closeRestrictedRooms(tx, [id]);
    await tx.query('DELETE FROM social_room_messages WHERE author_profile_id=$1', [id]);
    await tx.query('DELETE FROM social_conversation_preferences WHERE profile_id=$1', [id]);
    await tx.query("UPDATE social_lobby_members SET status='deleted',alias='Deleted participant',avatar_seed=$2,privacy_mode='INCOGNITO' WHERE profile_id=$1", [id, randomBytes(16).toString('hex')]);
    // Keep inaccessible context shells for immutable reports; erase all authored drafts.
    await tx.query("UPDATE social_action_searches SET draft='{}',status='closed' WHERE profile_id=$1", [id]);
    await tx.query("UPDATE social_candidate_offers SET status='cancelled' WHERE recipient_profile_id=$1 AND status='pending'", [id]);
}
export async function requireConnect(tx: DatabaseExecutor, p: ProfileRow) { await requireCapability(tx, p.id, 'connect'); }
