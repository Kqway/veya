import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startTestDatabase } from '../support/postgres';
import { applyMigrations } from '@/lib/db/migrations';
import { socialActor, seekingInput } from '../support/social';
import { IntentProductService } from '@/features/intent-product/service';
import { RoomService } from '@/features/intent-product/rooms';
import { searchDraftSchema } from '@/features/intent-product/schema';
import { readActionAggregateFunnel } from '@/lib/analytics/funnel-report';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
beforeAll(async () => { database = await startTestDatabase(); await applyMigrations(database.db); });
afterAll(async () => { await database?.stop(); });
beforeEach(async () => { await database.db.query('TRUNCATE social_profiles CASCADE'); });
const empty = { searches: 0, candidates: 0, offered: 0, accepted: 0, rooms: 0, conversations: 0, plans: 0, confirmed: 0, completed: 0 };

it('counts each search once through real offer, consent, conversation, shared plan and self-declared completion', async () => {
  const a = await socialActor(database.db, 'Private owner'), b = await socialActor(database.db, 'Private recipient');
  const service = new IntentProductService(database.db), rooms = new RoomService(database.db);
  const search = await service.create(a.token, { consent: true, draft: searchDraftSchema.parse({ seeking: seekingInput(), neededPeople: 1, existingPeople: 1, attributes: {}, timezone: 'UTC' }) });
  const early = { ...empty, searches: 1, candidates: 1, offered: 1 };
  expect(await readActionAggregateFunnel(database.db)).toEqual({ days: 7, ...early });
  const offer = (await service.offers(b.token))[0]!;
  const accepted = await service.respond(b.token, offer.publicKey, { action: 'accept' });
  await service.respond(b.token, offer.publicKey, { action: 'accept' });
  const joined = { ...early, accepted: 1, rooms: 1 };
  expect(await readActionAggregateFunnel(database.db)).toEqual({ days: 7, ...joined });
  await rooms.send(a.token, accepted.roomKey!, { text: 'Private content must never reach aggregate reporting' });
  await rooms.send(b.token, accepted.roomKey!, { text: 'Second message is not a second conversation' });
  await rooms.plan(a.token, accepted.roomKey!); await rooms.plan(b.token, accepted.roomKey!);
  const planned = { ...joined, conversations: 1, plans: 1 };
  expect(await readActionAggregateFunnel(database.db)).toEqual({ days: 7, ...planned });
  await database.db.query("UPDATE intents SET status='decided' WHERE id IN(SELECT plan_intent_id FROM social_rooms)");
  await rooms.transition(a.token, accepted.roomKey!, { status: 'completed' });
  await rooms.transition(a.token, accepted.roomKey!, { status: 'archived' });
  const complete = await readActionAggregateFunnel(database.db);
  expect(complete).toEqual({ days: 7, ...planned, confirmed: 1, completed: 1 });
  expect(Object.values(complete).every(value => Number.isInteger(value))).toBe(true);
  expect(JSON.stringify(complete)).not.toMatch(/Private|publicKey|profile|message|token/);
  await database.db.query("UPDATE social_action_searches SET created_at=clock_timestamp()-interval '8 days',expires_at=clock_timestamp()+interval '1 day' WHERE public_key=$1", [search.publicKey]);
  expect(await readActionAggregateFunnel(database.db, 7)).toEqual({ days: 7, ...empty });
  expect(await readActionAggregateFunnel(database.db, 14)).toEqual({ days: 14, ...planned, confirmed: 1, completed: 1 });
});

it('distinguishes a saved empty search from an actually found candidate', async () => {
  const a = await socialActor(database.db, 'Only person');
  await new IntentProductService(database.db).create(a.token, { consent: true, draft: searchDraftSchema.parse({ seeking: seekingInput(), neededPeople: 1, existingPeople: 1, attributes: {}, timezone: 'UTC' }) });
  expect(await readActionAggregateFunnel(database.db)).toEqual({ days: 7, ...empty, searches: 1 });
});

it.each([0, 31, 1.5, NaN])('rejects an unbounded or invalid reporting cohort %s', async days => {
  await expect(readActionAggregateFunnel(database.db, days)).rejects.toThrow('1 to 30');
});
