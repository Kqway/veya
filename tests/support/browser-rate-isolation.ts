import { randomBytes } from 'node:crypto';
import { lstat, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute } from 'node:path';
import pg from 'pg';
import type { DatabaseExecutor } from '../../src/lib/db/types';

const failure = () => new Error('Browser fixture control unavailable.');
export function validateBrowserDatabase(value: string) {
 try {
 const url = new URL(value);
 if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
     url.username !== 'veya_test' || !/^[a-f0-9]{48}$/.test(url.password) ||
     url.pathname !== '/veya_test' || !url.port || Number(url.port)<1024 ||
     url.search || url.hash) throw failure();
 } catch { throw failure(); }
}
async function privateDirectory(path: string) {
 if (!isAbsolute(path) || basename(path)!=='control.json' || dirname(dirname(path))!==tmpdir() ||
     !/^intavro-browser-[A-Za-z0-9]+$/.test(basename(dirname(path)))) throw failure();
 const directory = await lstat(dirname(path));
 if (!directory.isDirectory() || (directory.mode&0o777)!==0o700 ||
     (process.getuid && directory.uid!==process.getuid())) throw failure();
}
/** Installed only by the native browser server after creating its own isolated DB.
 * No production endpoint, inherited DATABASE_URL or production limiter override. */
export async function installBrowserFixtureControl(path: string, connectionString: string, db: DatabaseExecutor) {
 await privateDirectory(path);
 validateBrowserDatabase(connectionString);
 const nonce = randomBytes(32).toString('hex');
 await db.query('CREATE TABLE IF NOT EXISTS intavro_browser_fixture_control(nonce text PRIMARY KEY)');
 await db.query('ALTER TABLE intavro_browser_fixture_control ENABLE ROW LEVEL SECURITY');
 await db.query('INSERT INTO intavro_browser_fixture_control(nonce) VALUES($1)',[nonce]);
 await writeFile(path,JSON.stringify({connectionString,nonce}),{mode:0o600,flag:'wx'});
 // This closure owns only the file it created; never recursively remove an
 // environment-supplied directory, especially when initialization was rejected.
 return async () => { await unlink(path); await rmdir(dirname(path)); };
}
/** Test-level fixture isolation, just like resetting other test fixtures.
 * Actual PostgreSQL quotas remain enforced throughout each browser journey. */
export async function resetBrowserRateLimits(path: string) {
 let pool: pg.Pool | undefined;
 try {
  await privateDirectory(path);
  const file = await lstat(path);
  if (!file.isFile() || file.size>2048 || (file.mode&0o077)!==0 ||
      (process.getuid && file.uid!==process.getuid())) throw failure();
  const data = JSON.parse(await readFile(path,'utf8')) as {connectionString?:unknown;nonce?:unknown};
  if (typeof data.connectionString!=='string' || typeof data.nonce!=='string' ||
      !/^[a-f0-9]{64}$/.test(data.nonce) || Object.keys(data).sort().join(',')!=='connectionString,nonce') throw failure();
  validateBrowserDatabase(data.connectionString);
  pool = new pg.Pool({connectionString:data.connectionString,max:1,connectionTimeoutMillis:5000,statement_timeout:5000});
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   const proof = await client.query('SELECT nonce FROM intavro_browser_fixture_control WHERE nonce=$1',[data.nonce]);
   if (proof.rowCount!==1) throw failure();
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended('veya-shared-limiter',0))");
   await client.query('DELETE FROM rate_limit_buckets');
   await client.query('COMMIT');
  } catch (error) {
   await client.query('ROLLBACK');
   throw error;
  } finally { client.release(); }
 } catch { throw failure(); }
 finally { await pool?.end(); }
}
