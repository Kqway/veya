import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyMigrations } from '@/lib/db/migrations';
import { PostgresLimiter } from '@/lib/security/postgres-limiter';
import { installBrowserFixtureControl, resetBrowserRateLimits, validateBrowserDatabase } from '../support/browser-rate-isolation';
import { startTestDatabase } from '../support/postgres';

let fixture: Awaited<ReturnType<typeof startTestDatabase>>;
let directory: string;
let path: string;
beforeAll(async () => {
 fixture = await startTestDatabase();
 await applyMigrations(fixture.db);
 directory = await mkdtemp(join(tmpdir(), 'intavro-browser-'));
 path = join(directory, 'control.json');
 await installBrowserFixtureControl(path, fixture.connectionString, fixture.db);
});
afterAll(async () => { if (fixture) await fixture.stop(); if (directory) await rm(directory, {recursive:true,force:true}); });

it('isolates unrelated journeys while preserving the real shared limiter inside each journey', async () => {
 const limiter = new PostgresLimiter(() => fixture.db, {policies:{socialRead:{global:2,guest:2}}});
 expect((await limiter.check('socialRead')).allowed).toBe(true);
 expect((await limiter.check('socialRead')).allowed).toBe(true);
 expect((await limiter.check('socialRead')).allowed).toBe(false);
 await resetBrowserRateLimits(path);
 expect((await limiter.check('socialRead')).allowed).toBe(true);
 expect((await limiter.check('socialRead')).allowed).toBe(true);
 expect((await limiter.check('socialRead')).allowed).toBe(false);
});
it('refuses a wrong fixture capability without clearing live buckets', async () => {
 const original = await readFile(path, 'utf8');
 const data = JSON.parse(original);
 await writeFile(path, JSON.stringify({...data,nonce:'0'.repeat(64)}), {mode:0o600});
 const before = await fixture.db.query('SELECT count(*) FROM rate_limit_buckets');
 await expect(resetBrowserRateLimits(path)).rejects.toThrow('Browser fixture control unavailable.');
 expect((await fixture.db.query('SELECT count(*) FROM rate_limit_buckets')).rows).toEqual(before.rows);
 await writeFile(path, original, {mode:0o600});
});
it.each([
 'postgresql://veya_test:'+'a'.repeat(48)+'@remote.example:5432/veya_test',
 'postgresql://veya_test:'+'a'.repeat(48)+'@127.0.0.1:5432/production',
 'postgresql://owner:'+'a'.repeat(48)+'@127.0.0.1:5432/veya_test',
 'postgresql://veya_test:'+'a'.repeat(48)+'@127.0.0.1:5432/veya_test?host=remote.example',
])('rejects non-fixture database configuration', url => {
 expect(() => validateBrowserDatabase(url)).toThrow('Browser fixture control unavailable.');
});
