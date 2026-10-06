import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { applyMigrations, loadMigrations } from '@/lib/db/migrations';
import { buildConsoleUpgrade } from '@/lib/db/console-upgrade';
import { startTestDatabase } from '../support/postgres';

let fixture: Awaited<ReturnType<typeof startTestDatabase>>;
let pool: pg.Pool;
let baseline: string;
let migrations: Awaited<ReturnType<typeof loadMigrations>>;
beforeAll(async () => {
 migrations = await loadMigrations();
 baseline = await mkdtemp(join(tmpdir(), 'intavro-upgrade-'));
 for (const migration of migrations.slice(0,18)) await writeFile(join(baseline,migration.version),migration.sql);
 fixture = await startTestDatabase();
 pool = new pg.Pool({connectionString:fixture.connectionString,max:2});
});
beforeEach(async () => {
 await fixture.db.query('DROP SCHEMA public CASCADE');
 await fixture.db.query('CREATE SCHEMA public');
 await applyMigrations(fixture.db,baseline);
});
afterAll(async () => { await pool?.end(); await fixture?.stop(); if(baseline) await rm(baseline,{recursive:true,force:true}); });
// A named query forces PostgreSQL's prepared/extended protocol, like Neon Query
// Editor: a bundle with multiple top-level statements must be rejected here.
async function execute(sql: string) { return pool.query({name:`upgrade-${randomBytes(8).toString('hex')}`,text:sql}); }
async function ledger() { return (await fixture.db.query('SELECT version,checksum,applied_at FROM public.veya_schema_migrations ORDER BY version')).rows; }

it('upgrades an18 ledger using one prepared statement and preserves existing data',async () => {
 await fixture.db.query("INSERT INTO users(display_name) VALUES('Existing participant')");
 const {upgrade,verify} = buildConsoleUpgrade(migrations);
 await execute(upgrade);
 expect(await ledger()).toHaveLength(20);
 expect((await execute(verify)).rows).toEqual([{verified:true,migration_count:20}]);
 expect((await fixture.db.query('SELECT display_name FROM users')).rows).toEqual([{display_name:'Existing participant'}]);
 expect((await fixture.db.query("SELECT to_regclass('public.social_profile_spaces') AS space,to_regclass('public.social_rooms') AS room")).rows[0]).toEqual({space:'social_profile_spaces',room:'social_rooms'});
});
it('repeating a verified20 upgrade leaves original application timestamps unchanged',async () => {
 const {upgrade} = buildConsoleUpgrade(migrations);
 await execute(upgrade); const before=await ledger();
 await execute(upgrade);
 expect(await ledger()).toEqual(before);
});
it('serializes two concurrent console runs with the existing migration lock',async () => {
 const {upgrade} = buildConsoleUpgrade(migrations);
 await Promise.all([execute(upgrade),execute(upgrade)]);
 expect(await ledger()).toHaveLength(20);
});
it('ignores an inherited schema path and creates release tables only in public',async () => {
 await fixture.db.query('CREATE SCHEMA trap');
 const client=await pool.connect();
 try {
  await client.query('SET search_path TO trap');
  await client.query({name:'upgrade-other-path',text:buildConsoleUpgrade(migrations).upgrade});
  expect((await client.query("SELECT to_regclass('public.social_profile_spaces') IS NOT NULL AS correct,to_regclass('trap.social_profile_spaces') IS NULL AS other_absent")).rows[0]).toEqual({correct:true,other_absent:true});
 } finally { await client.query('SET search_path TO public'); client.release(); await fixture.db.query('DROP SCHEMA trap'); }
});
it('refuses a changed baseline checksum before creating any new schema',async () => {
 await fixture.db.query('UPDATE veya_schema_migrations SET checksum=$1 WHERE version=$2',['a'.repeat(64),migrations[0]!.version]);
 const before=await ledger();
 await expect(execute(buildConsoleUpgrade(migrations).upgrade)).rejects.toThrow('Unsupported migration history');
 expect(await ledger()).toEqual(before);
 expect((await fixture.db.query("SELECT to_regclass('public.social_profile_spaces') AS value")).rows[0]!.value).toBeNull();
});
it('refuses a foreign migration even if the number of entries is18',async () => {
 await fixture.db.query('UPDATE veya_schema_migrations SET version=$1 WHERE version=$2',['9999_foreign.sql',migrations[0]!.version]);
 const before=await ledger();
 await expect(execute(buildConsoleUpgrade(migrations).upgrade)).rejects.toThrow('Unsupported migration history');
 expect(await ledger()).toEqual(before);
});
it('rolls back migration19 and its ledger entry if migration20 fails',async () => {
 const altered=migrations.map(m=>({...m}));
 altered[19]!.sql+='\nSELECT 1/0;';
 altered[19]!.checksum=createHash('sha256').update(altered[19]!.sql).digest('hex');
 await expect(execute(buildConsoleUpgrade(altered).upgrade)).rejects.toThrow('division by zero');
 expect(await ledger()).toHaveLength(18);
 expect((await fixture.db.query("SELECT to_regclass('public.social_profile_spaces') AS value")).rows[0]!.value).toBeNull();
});
it('refuses a missing migration ledger instead of bootstrapping the selected database',async () => {
 await fixture.db.query('DROP TABLE public.veya_schema_migrations');
 await expect(execute(buildConsoleUpgrade(migrations).upgrade)).rejects.toThrow('Unsupported migration history');
 expect((await fixture.db.query("SELECT to_regclass('public.social_profile_spaces') AS value")).rows[0]!.value).toBeNull();
});
it('verification rejects a20-row ledger with an incorrect checksum',async () => {
 const bundle=buildConsoleUpgrade(migrations);
 await execute(bundle.upgrade);
 await fixture.db.query('UPDATE veya_schema_migrations SET checksum=$1 WHERE version=$2',['a'.repeat(64),migrations[19]!.version]);
 expect((await execute(bundle.verify)).rows).toEqual([{verified:false,migration_count:20}]);
 await expect(execute(bundle.upgrade)).rejects.toThrow('Unsupported migration history');
});
it.each(['missing','reordered','checksum'] as const)('rejects an invalid source manifest: %s',kind => {
 const invalid=migrations.slice(0,20).map(m=>({...m}));
 if(kind==='missing') invalid.pop();
 if(kind==='reordered') [invalid[0],invalid[1]]=[invalid[1]!,invalid[0]!];
 if(kind==='checksum') invalid[19]!.checksum='a'.repeat(64);
 expect(()=>buildConsoleUpgrade(invalid)).toThrow('Invalid release migrations');
});
