import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {startTestDatabase} from '../support/postgres';
import {isolatedBrowserEnvironment} from '../support/e2e-environment';
import {applyMigrations} from '@/lib/db/migrations';
const execute=promisify(execFile);
let fixture:Awaited<ReturnType<typeof startTestDatabase>>;
beforeAll(async()=>{fixture=await startTestDatabase();await applyMigrations(fixture.db);});
afterAll(async()=>{await fixture?.stop();});
async function cli(script:string,args:string[]=[],patch:Record<string,string>={}){
 try{const output=await execute(process.execPath,['--conditions=react-server','--import','tsx',`scripts/${script}.ts`,...args],{env:{...isolatedBrowserEnvironment(process.env,fixture.connectionString),...patch},timeout:15_000});return{code:0,...output};}
 catch(error){return error as {code:number;stdout:string;stderr:string};}
}
it('read-only workers and destructive retention skip before connecting while dry-run and schema verification stay available',async()=>{
 for(const [script,args] of [['social-worker',[]],['notifications',[]],['retention',['--apply']]] as const){
  const result=await cli(script,[...args],{BETA_READ_ONLY:'true',DATABASE_URL:'postgresql://missing:private-password@127.0.0.1:1/missing',REALTIME_DATABASE_URL:''});
  expect(result.code).toBe(0);expect(result.stdout).toContain('_skipped');expect(result.stderr).not.toContain('private-password');
 }
 expect((await cli('retention',['--dry-run'],{BETA_READ_ONLY:'true'})).code).toBe(0);
 expect((await cli('database',['verify'],{BETA_READ_ONLY:'true'})).code).toBe(0);
});
it('schema verification refuses changed checksums without applying or repairing migrations',async()=>{
 await fixture.db.query("UPDATE veya_schema_migrations SET checksum='bad' WHERE version='0001_initial.sql'");
 const result=await cli('database',['verify']);expect(result.code).toBe(1);expect(result.stderr).toContain('migration_failed');
 expect((await fixture.db.query("SELECT checksum FROM veya_schema_migrations WHERE version='0001_initial.sql'")).rows).toEqual([{checksum:'bad'}]);
});
it('rejects invalid notification batch limits before opening the database and never prints raw secrets',async()=>{
 for(const limit of ['--limit=0','--limit=101','--limit=999','--limit=abc']){
  const result=await cli('notifications',[limit],{DATABASE_URL:'postgresql://missing:private-password@127.0.0.1:1/missing',REALTIME_DATABASE_URL:''});
  expect(result.code).toBe(1);expect(result.stderr).toContain('worker_failed');expect(result.stderr).not.toContain('private-password');
 }
});
