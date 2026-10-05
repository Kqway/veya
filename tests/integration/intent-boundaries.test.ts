import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations } from '@/lib/db/migrations';
import { createGuestSession } from '@/features/backend/sessions';
import { IntentProductService } from '@/features/intent-product/service';
import { RoomService } from '@/features/intent-product/rooms';
import { processIntentJobs } from '@/features/intent-product/worker';
import { defaultPreferences, searchDraftSchema } from '@/features/intent-product/schema';
import { IdentityService } from '@/features/social/identity';
import { ProfileDeletionService } from '@/features/social/deletion';
import { SafetyService } from '@/features/social/safety';
import { DiscoveryService } from '@/features/social/discovery';
import { ConnectionsService } from '@/features/social/connections';
import { ConversationService } from '@/features/social/conversations';
import { requireProfile } from '@/features/social/context';
import { ModerationService } from '@/features/moderation/service';
import { enqueueNotification, NotificationService } from '@/features/notifications/service';
import { processNotificationJobs } from '@/features/notifications/jobs';
import { startTestDatabase } from '../support/postgres';
import { forbiddenKeys, seekingInput, socialActor } from '../support/social';

const push = { publicKey: 'a'.repeat(87), privateKey: 'b'.repeat(43), subject: 'mailto:push@example.test' };
const subscription = { endpoint: 'https://fcm.googleapis.com/intent-boundaries', keys: { p256dh: 'c'.repeat(87), auth: 'd'.repeat(22) } };
const draft = () => searchDraftSchema.parse({ seeking: seekingInput(), neededPeople: 1, existingPeople: 1, attributes: {}, timezone: 'UTC' });

describe('intent rooms across existing identity, safety, moderation and notification boundaries', () => {
  let c: Awaited<ReturnType<typeof startTestDatabase>>;
  beforeAll(async () => { c = await startTestDatabase(); await applyMigrations(c.db); });
  afterAll(async () => { if (c) await c.stop(); });
  beforeEach(async () => { await c.db.query('TRUNCATE social_profiles,moderation_admin_sessions,moderation_audit CASCADE'); });

  async function setup(accept = true, subscribe = false) {
    const a = await socialActor(c.db, 'Private owner'), b = await socialActor(c.db, 'Private recipient'), outsider = await socialActor(c.db, 'Private outsider');
    const intents = new IntentProductService(c.db), rooms = new RoomService(c.db);
    const notifications = new NotificationService(c.db, { push, origin: 'https://intent.test' });
    if (subscribe) await notifications.subscribe(b.token, subscription);
    const search = await intents.create(a.token, { draft: draft(), consent: true });
    await processIntentJobs(c.db);
    const offer = (await intents.offers(b.token)).find(item => item.activityLabel === search.activityLabel)!;
    expect(offer).toBeTruthy();
    const roomKey = accept ? (await intents.respond(b.token, offer.publicKey, { action: 'accept' })).roomKey! : null;
    const own = await c.db.transaction(tx => requireProfile(tx, a.token)), peer = await c.db.transaction(tx => requireProfile(tx, b.token));
    return { a, b, outsider, own, peer, search, offer, roomKey, intents, rooms, notifications };
  }
  async function legacy(m: Awaited<ReturnType<typeof setup>>) {
    await new DiscoveryService(c.db).discover(m.a.token, m.a.post.publicKey);
    const handle = (await c.db.query<{ public_handle: string }>('SELECT public_handle FROM discovery_handles WHERE source_post_id=(SELECT id FROM seeking_posts WHERE public_key=$1) AND target_post_id=(SELECT id FROM seeking_posts WHERE public_key=$2)', [m.a.post.publicKey, m.b.post.publicKey])).rows[0]!.public_handle;
    const service = new ConnectionsService(c.db), request = await service.request(m.a.token, { handle });
    return (await service.respond(m.b.token, request.publicKey, { action: 'accept' })).matchKey!;
  }
  async function report(m: Awaited<ReturnType<typeof setup>>) {
    const room = await m.rooms.get(m.a.token, m.roomKey!);
    await m.rooms.report(m.a.token, m.roomKey!, { memberKey: room.members.find(member => !member.isMine)!.publicKey, reason: 'harassment', text: 'Room safety case' });
    const secret = randomBytes(32).toString('base64url'), moderation = new ModerationService(c.db, { adminSecret: () => secret });
    const admin = await moderation.login(secret), key = (await moderation.queue(admin.token)).reports[0]!.publicKey;
    return { moderation, admin, key };
  }

  it('recovery transfers room authority without allowing the old or invalid session to keep access', async () => {
    const m = await setup(), replacement = await createGuestSession(c.db);
    await new IdentityService(c.db).recover(replacement.token, { key: m.a.key });
    expect(await m.rooms.get(replacement.token, m.roomKey!)).toMatchObject({ publicKey: m.roomKey, isOwner: true });
    await expect(m.rooms.get(m.a.token, m.roomKey!)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(m.rooms.send(m.a.token, m.roomKey!, { text: 'Old session must not write' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(m.rooms.get('invalid-session-token', m.roomKey!)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(m.rooms.messages(m.outsider.token, m.roomKey!)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await c.db.query('SELECT * FROM social_room_messages')).rows).toEqual([]);
  });

  it.each([false, true])('deletion erases authored room data and linked-plan identity with prior recovery=%s while preserving immutable minimized report evidence', async recoveredFirst => {
    const m = await setup();
    const removedMessage = await m.rooms.send(m.b.token, m.roomKey!, { text: 'Private deleted author message' });
    const retainedMessage = await m.rooms.send(m.a.token, m.roomKey!, { text: 'Other participant message' });
    await m.intents.savePreferences(m.b.token, { ...defaultPreferences(), offersEnabled: false });
    const plan = await m.rooms.plan(m.b.token, m.roomKey!);
    const caseInfo = await report(m), original = (await caseInfo.moderation.evidence(caseInfo.admin.token, caseInfo.key)).evidence;
    expect(JSON.stringify(original)).toContain('Private deleted author message');
    const authoredSearch = await m.intents.create(m.b.token, { draft: { ...draft(), seeking: { ...draft().seeking, rawText: 'Private search text to erase' } }, consent: true });
    const replacement = await createGuestSession(c.db);
    const recovered = recoveredFirst ? await new IdentityService(c.db).recover(replacement.token, { key: m.b.key }) : { recoveryKey: m.b.key };
    const deletingToken = recoveredFirst ? replacement.token : m.b.token;
    await new ProfileDeletionService(c.db).delete(deletingToken, { confirmation: 'DELETE' });
    for (const token of [m.b.token, deletingToken]) await expect(m.rooms.get(token, m.roomKey!)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const remaining = await m.rooms.get(m.a.token, m.roomKey!);
    expect(remaining).toMatchObject({ status: 'closed', planSlug: null, joinedCount: 1 });
    expect(remaining.members).toHaveLength(1); expect(remaining.members[0]!.isMine).toBe(true);
    await expect(m.rooms.send(m.a.token, m.roomKey!, { text: 'Closed room cannot continue' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(m.rooms.send(deletingToken, m.roomKey!, { text: 'Deleted authority' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await c.db.query('SELECT public_key FROM social_room_messages WHERE public_key=$1', [removedMessage.publicKey])).rows).toEqual([]);
    expect((await c.db.query('SELECT public_key FROM social_room_messages WHERE public_key=$1', [retainedMessage.publicKey])).rows).toHaveLength(1);
    expect((await c.db.query('SELECT 1 FROM social_conversation_preferences WHERE profile_id=$1', [m.peer.id])).rows).toEqual([]);
    expect((await c.db.query<{ draft: unknown; status: string; post_id: string | null }>('SELECT draft,status,post_id FROM social_action_searches WHERE public_key=$1', [authoredSearch.publicKey])).rows[0]).toEqual({ draft: {}, status: 'closed', post_id: null });
    expect((await c.db.query<{ status: string }>('SELECT status FROM social_intent_jobs WHERE search_id=(SELECT id FROM social_action_searches WHERE public_key=$1)', [authoredSearch.publicKey])).rows).toEqual([{ status: 'cancelled' }]);
    expect((await c.db.query('SELECT 1 FROM participants p JOIN intents i ON i.id=p.intent_id WHERE i.public_slug=$1', [plan.slug])).rows).toEqual([]);
    expect((await c.db.query<{ creator_display_name: string }>('SELECT creator_display_name FROM intents WHERE public_slug=$1', [plan.slug])).rows[0]!.creator_display_name).toBe('Удалённый участник');
    expect((await c.db.query<{ status: string }>('SELECT status FROM social_rooms WHERE public_key=$1', [m.roomKey])).rows[0]!.status).toBe('closed');
    expect((await caseInfo.moderation.evidence(caseInfo.admin.token, caseInfo.key)).evidence).toEqual(original);
    await expect(c.db.query("UPDATE social_reports SET evidence='{}' WHERE public_key=$1", [caseInfo.key])).rejects.toMatchObject({ code: '23514' });
    const fresh = await createGuestSession(c.db);
    await expect(new IdentityService(c.db).recover(fresh.token, { key: recovered.recoveryKey })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(['legacy', 'room'])('%s blocking closes both action rooms and legacy matches', async kind => {
    const m = await setup(), matchKey = await legacy(m);
    if (kind === 'legacy') await new SafetyService(c.db).block(m.a.token, { matchKey });
    else {
      const room = await m.rooms.get(m.a.token, m.roomKey!);
      await m.rooms.block(m.a.token, m.roomKey!, { memberKey: room.members.find(member => !member.isMine)!.publicKey });
    }
    expect((await c.db.query<{ status: string }>('SELECT status FROM social_rooms WHERE public_key=$1', [m.roomKey])).rows[0]!.status).toBe('closed');
    expect((await c.db.query<{ status: string }>('SELECT status FROM social_matches WHERE public_key=$1', [matchKey])).rows[0]!.status).toBe('closed');
    for (const token of [m.a.token, m.b.token]) {
      await expect(m.rooms.send(token, m.roomKey!, { text: 'Blocked room contact' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(new ConversationService(c.db).send(token, matchKey, { text: 'Blocked legacy contact' })).rejects.toMatchObject({ code: 'CONFLICT' });
    }
  });

  it.each(['suspension', 'connect restriction', 'seeking restriction'])('%s closes rooms and cancels pending offers under the moderator boundary', async kind => {
    const m = await setup(), pending = await m.intents.create(m.b.token, { draft: draft(), consent: true });
    await processIntentJobs(c.db);
    const pendingOffer = (await m.intents.offers(m.a.token)).find(item => item.status === 'pending')!;
    expect(pendingOffer).toBeTruthy();
    const caseInfo = await report(m);
    await caseInfo.moderation.action(caseInfo.admin.token, caseInfo.key, kind === 'suspension' ? { moderationStatus: 'suspended' } : kind === 'connect restriction' ? { canConnect: false } : { canSeek: false });
    expect((await c.db.query<{ status: string }>('SELECT status FROM social_rooms WHERE public_key=$1', [m.roomKey])).rows[0]!.status).toBe('closed');
    expect((await c.db.query<{ status: string }>('SELECT status FROM social_action_searches WHERE public_key=$1', [pending.publicKey])).rows[0]!.status).toBe('closed');
    expect((await c.db.query<{ status: string }>('SELECT status FROM social_candidate_offers WHERE public_key=$1', [pendingOffer.publicKey])).rows[0]!.status).toBe('cancelled');
    await expect(m.rooms.send(m.b.token, m.roomKey!, { text: 'Restricted actor' })).rejects.toMatchObject({ code: kind === 'seeking restriction' ? 'CONFLICT' : 'FORBIDDEN' });
    await expect(m.intents.respond(m.a.token, pendingOffer.publicKey, { action: 'accept' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await processIntentJobs(c.db)).offered).toBe(0);
  });

  it('rejects foreign offer/room notification contexts at service and PostgreSQL boundaries and projects only safe links', async () => {
    const m = await setup(), stranger = await c.db.transaction(tx => requireProfile(tx, m.outsider.token));
    for (const [type, context] of [['OFFER_RECEIVED', { offerKey: m.offer.publicKey }], ['ROOM_MESSAGE', { roomKey: m.roomKey! }]] as const) {
      await expect(c.db.transaction(tx => enqueueNotification(tx, { recipientProfileId: stranger.id, peerProfileId: m.own.id, type, ...context, dedupeKey: `foreign-${type}` }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    const ids = (await c.db.query<{ offer_id: string; room_id: string }>('SELECT (SELECT id FROM social_candidate_offers WHERE public_key=$1) offer_id,(SELECT id FROM social_rooms WHERE public_key=$2) room_id', [m.offer.publicKey, m.roomKey])).rows[0]!;
    for (const context of [{ offer: ids.offer_id, room: null }, { offer: null, room: ids.room_id }]) await expect(c.db.query('INSERT INTO social_notifications(public_key,recipient_profile_id,peer_profile_id,type,offer_id,room_id,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomBytes(18).toString('base64url'), stranger.id, m.own.id, context.offer ? 'OFFER_RECEIVED' : 'ROOM_MESSAGE', context.offer, context.room, randomBytes(8).toString('hex')])).rejects.toMatchObject({ code: '23514' });
    await m.rooms.send(m.a.token, m.roomKey!, { text: 'Do not put this message in a notification' });
    const notifications = (await m.notifications.list(m.b.token)).notifications;
    expect(notifications).toContainEqual(expect.objectContaining({ type: 'OFFER_RECEIVED', href: `/offer/${m.offer.publicKey}` }));
    expect(notifications).toContainEqual(expect.objectContaining({ type: 'ROOM_MESSAGE', href: `/room/${m.roomKey}` }));
    for (const notification of notifications) expect(Object.keys(notification).sort()).toEqual(['createdAt', 'href', 'publicKey', 'readAt', 'type']);
    expect(forbiddenKeys(notifications)).toEqual([]); expect(JSON.stringify(notifications)).not.toMatch(/Private owner|Private recipient|Do not put|[0-9a-f]{8}-[0-9a-f]{4}/);
    await expect(m.notifications.read(m.outsider.token, notifications[0]!.publicKey)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(['closed', 'blocked', 'suspended'])('hides %s room notifications and cancels queued push without dispatching content', async kind => {
    const m = await setup(true, true);
    await m.rooms.send(m.a.token, m.roomKey!, { text: 'Sensitive room body' });
    const message = (await m.notifications.list(m.b.token)).notifications.find(item => item.type === 'ROOM_MESSAGE')!;
    expect(message).toBeTruthy();
    if (kind === 'closed') await c.db.query("UPDATE social_rooms SET status='closed' WHERE public_key=$1", [m.roomKey]);
    if (kind === 'blocked') { const room = await m.rooms.get(m.a.token, m.roomKey!); await m.rooms.block(m.a.token, m.roomKey!, { memberKey: room.members.find(member => !member.isMine)!.publicKey }); }
    if (kind === 'suspended') { const caseInfo = await report(m); await caseInfo.moderation.action(caseInfo.admin.token, caseInfo.key, { moderationStatus: 'suspended' }); }
    if (kind !== 'suspended') {
      expect((await m.notifications.list(m.b.token)).notifications.some(item => item.publicKey === message.publicKey)).toBe(false);
      await expect(m.notifications.read(m.b.token, message.publicKey)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } else await expect(m.notifications.list(m.b.token)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const delivered: string[] = [], sender = vi.fn(async (_subscription: unknown, payload: string) => { delivered.push(payload); });
    const result = await processNotificationJobs(c.db, { push, sender, reminders: false });
    const messageJob = (await c.db.query<{ status: string }>('SELECT j.status FROM social_notification_jobs j JOIN social_notifications n ON n.id=j.notification_id WHERE n.public_key=$1', [message.publicKey])).rows;
    expect(messageJob).toEqual([{ status: 'cancelled' }]); expect(result.cancelled).toBeGreaterThanOrEqual(1);
    if (kind !== 'closed') expect(sender).not.toHaveBeenCalled();
    expect(delivered.join('')).not.toMatch(/Sensitive room body|Private owner|Private recipient/);
  });
});
