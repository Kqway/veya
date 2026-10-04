import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { startTestDatabase } from '../support/postgres';
import { socialActor, forbiddenKeys } from '../support/social';
import { applyMigrations } from '@/lib/db/migrations';
import { parseServerEnv } from '@/lib/config/env';
import { createSocialCronHandler } from '@/features/operations/cron';

let c: Awaited<ReturnType<typeof startTestDatabase>>;
const secret = 's'.repeat(40);
const request = (token = secret, query = '', method = 'GET') => new Request('https://intavro.example/api/cron/social' + query, {method, headers: {authorization: 'Bearer ' + token}});
beforeAll(async () => {c = await startTestDatabase(); await applyMigrations(c.db);});
beforeEach(async () => {await c.db.query('TRUNCATE social_profiles CASCADE');});
afterAll(async () => {await c?.stop();});

it('rejects missing or wrong credentials, guest cookies and unbounded query overrides before database access', async () => {
  let accesses = 0;
  const handle = createSocialCronHandler({config: () => parseServerEnv({CRON_SECRET: secret}), database: () => {accesses++; return c.db;}});
  for (const req of [request(''), request('wrong'), new Request('https://intavro.example/api/cron/social', {headers: {cookie: 'veya_guest=' + secret}})]) {
    const response = await handle(req); expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.text()).not.toContain(secret);
  }
  expect((await handle(request(secret, '?limit=100000'))).status).toBe(400);
  expect((await handle(request(secret, '', 'POST'))).status).toBe(405);
  expect(accesses).toBe(0);
});

it('fails closed when unconfigured and skips all database work in read-only mode', async () => {
  let accesses = 0;
  const database = () => {accesses++; return c.db;};
  expect((await createSocialCronHandler({config: () => parseServerEnv({}), database})(request())).status).toBe(503);
  const handle = createSocialCronHandler({config: () => parseServerEnv({CRON_SECRET: secret, BETA_READ_ONLY: 'true'}), database});
  expect((await handle(request('wrong'))).status).toBe(401);
  const response = await handle(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ok: true, skipped: true});
  expect(accesses).toBe(0);
});

it('processes real durable jobs concurrently without duplicate candidate notifications or automatic connections', async () => {
  await socialActor(c.db, 'Private A'); await socialActor(c.db, 'Private B');
  const handle = createSocialCronHandler({config: () => parseServerEnv({CRON_SECRET: secret}), database: () => c.db});
  const responses = await Promise.all([handle(request()), handle(request())]);
  for (const response of responses) {
    expect(response.status).toBe(200); const payload = await response.json();
    expect(payload.ok).toBe(true); expect(payload.candidates.claimed).toBeLessThanOrEqual(5);
    expect(forbiddenKeys(payload)).toEqual([]); expect(JSON.stringify(payload)).not.toMatch(/Private|[0-9a-f]{8}-[0-9a-f]{4}/);
  }
  expect((await c.db.query("SELECT id FROM social_notifications WHERE type='CANDIDATE_FOUND'")).rows).toHaveLength(2);
  expect((await c.db.query('SELECT id FROM connection_requests')).rows).toHaveLength(0);
  expect((await handle(request())).status).toBe(200);
  expect((await c.db.query("SELECT id FROM social_notifications WHERE type='CANDIDATE_FOUND'")).rows).toHaveLength(2);
});

it('returns a safe failure and logs no credential or driver error content', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const handle = createSocialCronHandler({config: () => parseServerEnv({CRON_SECRET: secret}), database: () => {throw new Error('private postgres password ' + secret);}});
    const response = await handle(request()); expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/postgres|password/);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(logged.mock.calls)).toContain('worker_failed');
  } finally {logged.mockRestore();}
});
