import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/db/types';
const state = vi.hoisted(() => ({db: undefined as Database | undefined, cleanup: [] as (() => Promise<void>)[]}));
// Provide the framework lifecycle and the real isolated database, not a fake persistence layer.
vi.mock('next/server', async importOriginal => ({...await importOriginal<typeof import('next/server')>(), after: (callback: () => Promise<void>) => state.cleanup.push(callback)}));
vi.mock('@/lib/db', () => ({getDatabase: () => state.db!}));
import { realtimeHandler, closeRealtimeRuntime } from '@/features/realtime/runtime';
import { startTestDatabase } from '../support/postgres';
import { socialActor } from '../support/social';
import { applyMigrations } from '@/lib/db/migrations';
let c: Awaited<ReturnType<typeof startTestDatabase>>;
beforeAll(async () => {c = await startTestDatabase(); await applyMigrations(c.db); state.db = c.db;});
beforeEach(async () => {
  await c.db.query('TRUNCATE social_profiles CASCADE'); state.cleanup = []; state.db = c.db;
  vi.stubEnv('VERCEL', '1'); vi.stubEnv('REALTIME_DATABASE_URL', c.connectionString);
});
afterEach(async () => {for (const cleanup of state.cleanup) await cleanup(); await closeRealtimeRuntime(); vi.unstubAllEnvs();});
afterAll(async () => {await c?.stop();});
async function listeners() {return Number((await c.db.query<{count:string}>("SELECT count(*) FROM pg_stat_activity WHERE application_name='veya-social-listener'")).rows[0]!.count);}

it('releases the shared LISTEN session after the last serverless response without disconnecting another user', async () => {
  const a = await socialActor(c.db, 'A'), b = await socialActor(c.db, 'B');
  const req = (token:string) => new Request('http://localhost/api/social/events', {headers:{cookie:`veya_guest=${token}`}});
  const ra = await realtimeHandler(req(a.token)), rb = await realtimeHandler(req(b.token));
  expect(ra.status).toBe(200); expect(rb.status).toBe(200);
  const ar = ra.body!.getReader(), br = rb.body!.getReader(); await ar.read(); await br.read();
  expect(state.cleanup).toHaveLength(2); expect(await listeners()).toBe(1);
  await ar.cancel(); await state.cleanup[0]!();
  await expect.poll(listeners).toBe(1);
  await br.cancel(); await state.cleanup[1]!(); await expect.poll(listeners).toBe(0);
  const again = await realtimeHandler(req(a.token)); expect(again.status).toBe(200);
  await again.body!.cancel(); await state.cleanup[2]!(); await expect.poll(listeners).toBe(0);
});

it('preserves the concurrent per-profile stream cap on Vercel', async () => {
  const a = await socialActor(c.db, 'A');
  const req = () => new Request('http://localhost/api/social/events', {headers:{cookie:`veya_guest=${a.token}`}});
  const responses = await Promise.all([realtimeHandler(req()), realtimeHandler(req()), realtimeHandler(req())]);
  expect(responses.map(r => r.status)).toEqual([200, 200, 200]);
  try {expect((await realtimeHandler(req())).status).toBe(503);}
  finally {await Promise.all(responses.map(r => r.body!.cancel()));}
});

it('keeps the hub alive while another request is still authorizing', async () => {
  const a = await socialActor(c.db, 'A');
  const req = () => new Request('http://localhost/api/social/events', {headers:{cookie:`veya_guest=${a.token}`}});
  const first = await realtimeHandler(req()); const reader = first.body!.getReader(); await reader.read();
  let unblock!: () => void, started!: () => void, blocked = false;
  const gate = new Promise<void>(resolve => {unblock = resolve;});
  const ready = new Promise<void>(resolve => {started = resolve;});
  state.db = {close: c.db.close.bind(c.db), transaction: c.db.transaction.bind(c.db), query: async (sql, values) => {
    if (!blocked) {blocked = true; started(); await gate;}
    return c.db.query(sql, values);
  }};
  const pending = realtimeHandler(req()); await ready;
  try {
    await reader.cancel(); await state.cleanup[0]!();
    expect(await listeners()).toBe(1);
  } finally {unblock();}
  const second = await pending; expect(second.status).toBe(200);
  await second.body!.cancel(); await state.cleanup[1]!(); await expect.poll(listeners).toBe(0);
});

it('registers cleanup for unauthorized serverless requests and never opens a listener', async () => {
  expect((await realtimeHandler(new Request('http://localhost/api/social/events'))).status).toBe(401);
  expect(state.cleanup).toHaveLength(1); await state.cleanup[0]!(); expect(await listeners()).toBe(0);
});
