import 'server-only';
import { z } from 'zod';
import type { Database, DatabaseExecutor } from '@/lib/db/types';
import { validate } from '@/features/backend/validation';
import { createIntentInTransaction } from '@/features/backend/intent-creation';
import { requireProfile, reauthorize, lockProfiles, requireCapability, type ProfileRow } from '@/features/social/context';
import { publicKeySchema, strongerMode } from '@/features/social/seeking-schema';
import { opaqueKey } from '@/features/social/pairs';
import { fail } from '@/features/social/errors';
import { enqueueNotification } from '@/features/notifications/service';
import { publishSocialEvent } from '@/features/realtime/events';
import { trackFunnel } from '@/lib/analytics/funnel';
import { activeProfiles, closeLobby, closeBlockedRooms, publishRooms, publishIntents } from './repository';
import { roomDTOSchema, roomMessageDTOSchema } from './schema';
type RoomRow = {
    id: string;
    public_key: string;
    lobby_id: string;
    status: 'ready' | 'active' | 'completed' | 'archived' | 'closed';
    owner_profile_id: string;
    capacity: number;
    external_count: number;
    activity_label: string;
    plan_slug: string | null;
};
type Member = {
    profile_id: string;
    public_key: string;
    alias: string;
    avatar_seed: string;
    privacy_mode: ProfileRow['privacy_mode'];
    status: string;
};
type Context = {
    room: RoomRow;
    own: ProfileRow;
    members: Member[];
    profiles: Map<string, ProfileRow>;
};
const memberInput = z.object({ memberKey: publicKeySchema }).strict();
const text = z.string().trim().min(1).max(2000).refine(v => !v.includes('\0'));
async function readRoom(tx: DatabaseExecutor, key: string, lock = false) { const r = await tx.query<RoomRow>(`SELECT r.*,l.owner_profile_id,l.capacity,l.external_count,s.activity_label,i.public_slug plan_slug FROM social_rooms r JOIN social_lobbies l ON l.id=r.lobby_id JOIN social_action_searches s ON s.id=l.search_id LEFT JOIN intents i ON i.id=r.plan_intent_id WHERE r.public_key=$1 ${lock ? 'FOR UPDATE OF l,r' : ''}`, [key]); return r.rows[0] ?? fail('NOT_FOUND'); }
async function members(tx: DatabaseExecutor, lobby: string) { return (await tx.query<Member>('SELECT * FROM social_lobby_members WHERE lobby_id=$1 ORDER BY created_at,public_key', [lobby])).rows; }
async function authorize(tx: DatabaseExecutor, token: string, key: string): Promise<Context> {
    const initialOwn = await requireProfile(tx, token);
    const initial = await readRoom(tx, key);
    const before = await members(tx, initial.lobby_id);
    if (!before.some(m => m.profile_id === initialOwn.id && m.status === 'active'))
        fail('NOT_FOUND');
    const ids = before.map(m => m.profile_id);
    await lockProfiles(tx, ids);
    const own = await reauthorize(tx, token, initialOwn.id);
    await requireCapability(tx, own.id, 'connect');
    const room = await readRoom(tx, key, true);
    const current = await members(tx, room.lobby_id);
    if (!current.some(m => m.profile_id === own.id && m.status === 'active'))
        fail('NOT_FOUND');
    if (current.some(m => !ids.includes(m.profile_id)))
        fail('CONFLICT');
    const profiles = await activeProfiles(tx, ids);
    if (current.some(m => m.status === 'active' && !profiles.has(m.profile_id)))
        fail('NOT_FOUND');
    const active = current.filter(m => m.status === 'active').map(m => m.profile_id);
    if ((await tx.query('SELECT 1 FROM social_blocks WHERE blocker_profile_id=ANY($1::uuid[]) AND blocked_profile_id=ANY($1::uuid[])', [active])).rows.length)
        fail('NOT_FOUND');
    return { room, own, members: current, profiles };
}
function identity(ctx: Context, m: Member) { const p = ctx.profiles.get(m.profile_id); const mode = p ? strongerMode(p.privacy_mode, m.privacy_mode) : 'INCOGNITO'; return { alias: mode === 'INCOGNITO' ? m.alias : (p?.alias ?? m.alias), avatarSeed: m.avatar_seed }; }
function project(ctx: Context) { const current = ctx.members.filter(m => m.status === 'active'); return roomDTOSchema.parse({ publicKey: ctx.room.public_key, activityLabel: ctx.room.activity_label, status: ctx.room.status, capacity: ctx.room.capacity, joinedCount: current.length + ctx.room.external_count, externalCount: ctx.room.external_count, isOwner: ctx.room.owner_profile_id === ctx.own.id, members: current.map(m => ({ publicKey: m.public_key, ...identity(ctx, m), isMine: m.profile_id === ctx.own.id })), planSlug: ctx.room.status === 'closed' ? null : ctx.room.plan_slug }); }
function writable(ctx: Context) { if (!['ready', 'active'].includes(ctx.room.status))
    fail('CONFLICT'); }
function member(ctx: Context, key: string) { return ctx.members.find(m => m.public_key === key && m.status === 'active') ?? fail('NOT_FOUND'); }
function projectMessage(ctx: Context, row: {
    public_key: string;
    text: string;
    created_at: Date;
    author_profile_id: string;
}) { const m = ctx.members.find(m => m.profile_id === row.author_profile_id) ?? fail('NOT_FOUND'); return roomMessageDTOSchema.parse({ publicKey: row.public_key, text: row.text, createdAt: row.created_at.toISOString(), isMine: m.profile_id === ctx.own.id, identity: identity(ctx, m) }); }
export class RoomService {
    constructor(private readonly db: Database, private readonly options: {
        analyticsEnabled?: boolean;
    } = {}) { }
    async get(token: string, key: string) { validate(publicKeySchema, key); return this.db.transaction(async (tx) => project(await authorize(tx, token, key))); }
    async list(token: string) {
        const keys = await this.db.transaction(async (tx) => { const own = await requireProfile(tx, token); await lockProfiles(tx, [own.id]); await reauthorize(tx, token, own.id); return (await tx.query<{
            public_key: string;
        }>(`SELECT r.public_key FROM social_rooms r JOIN social_lobby_members m ON m.lobby_id=r.lobby_id WHERE m.profile_id=$1 AND m.status='active' ORDER BY r.created_at DESC,r.id DESC LIMIT 20`, [own.id])).rows; });
        const result = [];
        for (const row of keys) {
            try {
                result.push(await this.get(token, row.public_key));
            }
            catch (error) {
                if (!(error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND'))
                    throw error;
            }
        }
        return result;
    }
    async messages(token: string, key: string, query: {
        before?: string | undefined;
        limit?: number | undefined;
    } = {}) { validate(publicKeySchema, key); const data = validate(z.object({ before: publicKeySchema.optional(), limit: z.number().int().min(1).max(50).default(30) }).strict(), query); return this.db.transaction(async (tx) => { const ctx = await authorize(tx, token, key); if (data.before && !(await tx.query('SELECT 1 FROM social_room_messages WHERE room_id=$1 AND public_key=$2', [ctx.room.id, data.before])).rows.length)
        fail('NOT_FOUND'); const rows = (await tx.query<{
        public_key: string;
        text: string;
        created_at: Date;
        author_profile_id: string;
    }>(`SELECT * FROM social_room_messages WHERE room_id=$1 ${data.before ? 'AND (created_at,id)<(SELECT created_at,id FROM social_room_messages WHERE room_id=$1 AND public_key=$3)' : ''} ORDER BY created_at DESC,id DESC LIMIT $2`, [ctx.room.id, data.limit + 1, ...(data.before ? [data.before] : [])])).rows; const page = rows.slice(0, data.limit); return { messages: page.reverse().map(r => projectMessage(ctx, r)), nextBefore: rows.length > data.limit ? rows[data.limit - 1]!.public_key : null }; }); }
    async send(token: string, key: string, input: unknown) { validate(publicKeySchema, key); const data = validate(z.object({ text }).strict(), input); return this.db.transaction(async (tx) => { const ctx = await authorize(tx, token, key); writable(ctx); const row = (await tx.query<{
        public_key: string;
        text: string;
        created_at: Date;
        author_profile_id: string;
    }>('INSERT INTO social_room_messages(public_key,room_id,author_profile_id,text) VALUES($1,$2,$3,$4) RETURNING *', [opaqueKey(), ctx.room.id, ctx.own.id, data.text])).rows[0]!; for (const m of ctx.members.filter(m => m.status === 'active' && m.profile_id !== ctx.own.id))
        await enqueueNotification(tx, { recipientProfileId: m.profile_id, peerProfileId: ctx.own.id, type: 'ROOM_MESSAGE', roomKey: key, dedupeKey: 'room-message:' + row.public_key }); await publishRooms(tx, ctx.members.filter(m => m.status === 'active').map(m => m.profile_id)); return projectMessage(ctx, row); }); }
    async transition(token: string, key: string, input: unknown) { validate(publicKeySchema, key); const { status } = validate(z.object({ status: z.enum(['active', 'completed', 'archived']) }).strict(), input); return this.db.transaction(async (tx) => { const ctx = await authorize(tx, token, key); if (ctx.own.id !== ctx.room.owner_profile_id)
        fail('FORBIDDEN'); if (status === ctx.room.status)
        return project(ctx); if (!((ctx.room.status === 'ready' && status === 'active') || (['ready', 'active'].includes(ctx.room.status) && status === 'completed') || (ctx.room.status === 'completed' && status === 'archived')))
        fail('CONFLICT'); await tx.query('UPDATE social_rooms SET status=$2 WHERE id=$1', [ctx.room.id, status]); await tx.query('UPDATE social_lobbies SET status=$2 WHERE id=$1', [ctx.room.lobby_id, status]); ctx.room.status = status; if (status === 'completed')
        await trackFunnel(tx, 'activity_completed', this.options.analyticsEnabled ?? false); await publishRooms(tx, ctx.members.filter(m => m.status === 'active').map(m => m.profile_id)); return project(ctx); }); }
    async remove(token: string, key: string, input: unknown) { validate(publicKeySchema, key); const { memberKey } = validate(memberInput, input); return this.db.transaction(async (tx) => { const ctx = await authorize(tx, token, key); writable(ctx); const target = member(ctx, memberKey); if (target.profile_id !== ctx.own.id && ctx.room.owner_profile_id !== ctx.own.id)
        fail('FORBIDDEN'); await tx.query("UPDATE social_lobby_members SET status=$3 WHERE lobby_id=$1 AND profile_id=$2", [ctx.room.lobby_id, target.profile_id, target.profile_id === ctx.own.id ? 'left' : 'removed']); await closeLobby(tx, ctx.room.lobby_id); target.status = 'removed'; ctx.room.status = 'closed'; await publishRooms(tx, ctx.members.map(m => m.profile_id)); await publishIntents(tx, ctx.members.map(m => m.profile_id)); return project(ctx); }); }
    async block(token: string, key: string, input: unknown) { validate(publicKeySchema, key); const { memberKey } = validate(memberInput, input); return this.db.transaction(async (tx) => { const ctx = await authorize(tx, token, key); const target = member(ctx, memberKey); if (target.profile_id === ctx.own.id)
        fail('INVALID_INPUT'); await tx.query('INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [ctx.own.id, target.profile_id]); await closeBlockedRooms(tx, ctx.own.id, target.profile_id); await tx.query("UPDATE connection_requests SET status='declined',updated_at=clock_timestamp() WHERE status='pending' AND ((sender_profile_id=$1 AND recipient_profile_id=$2) OR(sender_profile_id=$2 AND recipient_profile_id=$1))", [ctx.own.id, target.profile_id]); await tx.query("UPDATE social_matches m SET status='closed',closed_at=COALESCE(closed_at,clock_timestamp()) FROM social_pairs p WHERE m.pair_id=p.id AND ((p.low_profile_id=$1 AND p.high_profile_id=$2) OR(p.low_profile_id=$2 AND p.high_profile_id=$1))", [ctx.own.id, target.profile_id]); await tx.query("UPDATE conversations c SET status='closed' FROM social_matches m JOIN social_pairs p ON p.id=m.pair_id WHERE c.match_id=m.id AND ((p.low_profile_id=$1 AND p.high_profile_id=$2) OR(p.low_profile_id=$2 AND p.high_profile_id=$1))", [ctx.own.id, target.profile_id]); for (const topic of ['connections', 'match', 'notifications', 'discovery'] as const)
        await publishSocialEvent(tx, [ctx.own.id, target.profile_id], { topic }); return { blocked: true as const }; }); }
    async report(token: string, key: string, input: unknown) { validate(publicKeySchema, key); const data = validate(memberInput.extend({ reason: z.enum(['spam', 'harassment', 'unsafe_meeting', 'impersonation', 'other']), text: z.string().trim().max(1000).refine(v => !v.includes('\0')).optional() }).strict(), input); return this.db.transaction(async (tx) => { const ctx = await authorize(tx, token, key); const target = member(ctx, data.memberKey); if (target.profile_id === ctx.own.id)
        fail('INVALID_INPUT'); await tx.query(`INSERT INTO social_reports(reporter_profile_id,target_profile_id,room_id,reason,text) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [ctx.own.id, target.profile_id, ctx.room.id, data.reason, data.text ?? null]); return { reported: true as const }; }); }
    async plan(token: string, key: string) { validate(publicKeySchema, key); return this.db.transaction(async (tx) => { const ctx = await authorize(tx, token, key); writable(ctx); if (ctx.room.plan_slug)
        return { slug: ctx.room.plan_slug }; const own = ctx.members.find(m => m.profile_id === ctx.own.id)!; const title = `${ctx.room.activity_label} — вместе`; const view = await createIntentInTransaction(tx, token, { rawText: title, title, creatorName: identity(ctx, own).alias, structuredIntent: { type: 'meet', activities: [ctx.room.activity_label], location: null } }, this.options); await tx.query('UPDATE social_rooms SET plan_intent_id=(SELECT id FROM intents WHERE public_slug=$2) WHERE id=$1', [ctx.room.id, view.intent.publicSlug]); await tx.query('INSERT INTO social_linked_plan_identities(plan_intent_id,profile_id,guest_id) SELECT id,$2,creator_guest_id FROM intents WHERE public_slug=$1 ON CONFLICT DO NOTHING',[view.intent.publicSlug,ctx.own.id]); await publishRooms(tx, ctx.members.filter(m => m.status === 'active').map(m => m.profile_id)); return { slug: view.intent.publicSlug }; }); }
}
