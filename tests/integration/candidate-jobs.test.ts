import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {startTestDatabase} from '../support/postgres';
import {applyMigrations} from '@/lib/db/migrations';
import type {Database,DatabaseExecutor} from '@/lib/db/types';
import {socialActor,forbiddenKeys} from '../support/social';
import {enqueueCandidateJob,processCandidateJobs} from '@/features/discovery/candidate-jobs';
import {NotificationService} from '@/features/notifications/service';
import {DiscoveryService} from '@/features/social/discovery';
import {ConnectionsService} from '@/features/social/connections';
import {lockProfiles} from '@/features/social/context';
let c:Awaited<ReturnType<typeof startTestDatabase>>;
beforeAll(async()=>{c=await startTestDatabase();await applyMigrations(c.db);});
afterAll(async()=>{if(c)await c.stop();});
beforeEach(async()=>{await c.db.query('TRUNCATE social_profiles CASCADE');});
async function pair(patch:Record<string,unknown>={}) {
  const a=await socialActor(c.db,'Private source'),b=await socialActor(c.db,'Private target','INCOGNITO',patch);
  const rows=await c.db.query<{id:string;profile_id:string;public_key:string}>('SELECT id,profile_id,public_key FROM seeking_posts WHERE public_key=ANY($1::text[])',[[a.post.publicKey,b.post.publicKey]]);
  return {a,b,source:rows.rows.find(r=>r.public_key===a.post.publicKey)!,target:rows.rows.find(r=>r.public_key===b.post.publicKey)!};
}
async function queue(id:string) {await c.db.query('DELETE FROM social_candidate_jobs');await c.db.transaction(tx=>enqueueCandidateJob(tx,id));}
async function candidateCount(){return Number((await c.db.query<{count:string}>("SELECT count(*) FROM social_notifications WHERE type='CANDIDATE_FOUND'")).rows[0]!.count);}
function observed(beforeProfileLock:(tx:DatabaseExecutor)=>Promise<void>):Database {
  let called=false;
  return {query:(sql,values)=>c.db.query(sql,values),close:async()=>{},transaction:work=>c.db.transaction(tx=>work({query:async(sql,values)=>{if(!called&&sql.includes('pg_advisory_xact_lock')){called=true;await beforeProfileLock(tx);}return tx.query(sql,values);}}))};
}
it('enqueues one transactional durable job per post and rolls back with the post transaction',async()=>{
  const {source}=await pair();
  await c.db.query('DELETE FROM social_candidate_jobs');
  await expect(c.db.transaction(async tx=>{await enqueueCandidateJob(tx,source.id);throw new Error('rollback');})).rejects.toThrow('rollback');
  expect((await c.db.query('SELECT * FROM social_candidate_jobs')).rows).toHaveLength(0);
  await Promise.all([c.db.transaction(tx=>enqueueCandidateJob(tx,source.id)),c.db.transaction(tx=>enqueueCandidateJob(tx,source.id))]);
  expect((await c.db.query('SELECT * FROM social_candidate_jobs')).rows).toHaveLength(1);
});
it('notifies both eligible owners once for compatible posts, with safe DTOs and no automatic Interested',async()=>{
  const {a,b,source,target}=await pair();await queue(source.id);
  const result=await processCandidateJobs(c.db);
  expect(result).toMatchObject({claimed:1,completed:1,notified:2,failed:0});
  const notifications=new NotificationService(c.db);
  for(const actor of [a,b]){
    const inbox=await notifications.list(actor.token);
    expect(inbox.notifications.map(n=>n.type)).toEqual(['CANDIDATE_FOUND']);
    expect(inbox.notifications[0]!.href).toBe('/discover');expect(forbiddenKeys(inbox)).toEqual([]);
    expect(JSON.stringify(inbox)).not.toMatch(/Private source|Private target|Play chess|Moscow|North/);
  }
  expect((await c.db.query('SELECT * FROM connection_requests')).rows).toHaveLength(0);
  expect(Number((await c.db.query<{count:string}>("SELECT count(*) FROM social_events WHERE topic='discovery'")).rows[0]!.count)).toBe(2);
  await c.db.transaction(tx=>enqueueCandidateJob(tx,target.id));
  expect((await processCandidateJobs(c.db)).notified).toBe(0);expect(await candidateCount()).toBe(2);
});
it.each([
  {activityKey:'football'}, {languages:['en']}, {desiredAgeBands:['40+']}, {city:'London'}, {format:'group',groupSize:4},
  {availability:[{startAt:new Date(Date.now()+3*86400000).toISOString(),endAt:new Date(Date.now()+3*86400000+3600000).toISOString()}]},
])('keeps mutual hard filters authoritative for %j',async patch=>{
  const {source}=await pair(patch);await queue(source.id);expect((await processCandidateJobs(c.db)).notified).toBe(0);expect(await candidateCount()).toBe(0);
});
describe('pair exclusions',()=>{
  it.each(['block-forward','block-reverse','pass-forward','pass-reverse','request-declined','request-expired'])('skips %s in either direction',async kind=>{
    const {a,b,source,target}=await pair();
    if(kind.startsWith('block'))await c.db.query('INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) VALUES($1,$2)',kind==='block-forward'?[source.profile_id,target.profile_id]:[target.profile_id,source.profile_id]);
    if(kind.startsWith('pass'))await c.db.query('INSERT INTO discovery_passes(viewer_profile_id,target_profile_id) VALUES($1,$2)',kind==='pass-forward'?[source.profile_id,target.profile_id]:[target.profile_id,source.profile_id]);
    if(kind.startsWith('request')){
      const cards=await new DiscoveryService(c.db).discover(b.token,b.post.publicKey),connections=new ConnectionsService(c.db);
      const request=await connections.request(b.token,{handle:cards[0]!.handle});await connections.respond(a.token,request.publicKey,{action:'decline'});
      if(kind==='request-expired')await c.db.query("UPDATE connection_requests SET status='expired' WHERE public_key=$1",[request.publicKey]);
    }
    await queue(source.id);expect((await processCandidateJobs(c.db)).notified).toBe(0);expect(await candidateCount()).toBe(0);
  });
});
it.each(['source-closed','target-closed','source-expired','target-expired','source-suspended','target-suspended','source-seek','target-seek','source-connect','target-connect'])('rechecks %s eligibility under profile locks',async kind=>{
  const {source,target}=await pair();await queue(source.id);const row=kind.startsWith('source')?source:target;
  const db=observed(async tx=>{
    if(kind.endsWith('closed'))await tx.query("UPDATE seeking_posts SET status='closed' WHERE id=$1",[row.id]);
    if(kind.endsWith('expired'))await tx.query("UPDATE seeking_posts SET created_at=clock_timestamp()-interval '8 days',expires_at=clock_timestamp()-interval '1 day' WHERE id=$1",[row.id]);
    if(kind.endsWith('suspended'))await tx.query("UPDATE social_profiles SET moderation_status='suspended' WHERE id=$1",[row.profile_id]);
    if(kind.endsWith('seek'))await tx.query('UPDATE social_profiles SET can_seek=false WHERE id=$1',[row.profile_id]);
    if(kind.endsWith('connect'))await tx.query('UPDATE social_profiles SET can_connect=false WHERE id=$1',[row.profile_id]);
  });
  expect((await processCandidateJobs(db)).notified).toBe(0);expect(await candidateCount()).toBe(0);
});
it('rechecks a real concurrent closure after waiting for a held profile lock',async()=>{
  const {source,target}=await pair();await queue(source.id);
  let unlock!:()=>void,ready!:()=>void;
  const held=new Promise<void>(resolve=>{ready=resolve;}),release=new Promise<void>(resolve=>{unlock=resolve;});
  const changing=c.db.transaction(async tx=>{await lockProfiles(tx,[target.profile_id]);ready();await release;await tx.query("UPDATE seeking_posts SET status='closed' WHERE id=$1",[target.id]);});
  await held;
  const worker=processCandidateJobs(c.db);
  await vi.waitFor(async()=>{expect((await c.db.query<{status:string}>('SELECT status FROM social_candidate_jobs')).rows[0]!.status).toBe('processing');});
  unlock();await changing;expect((await worker).notified).toBe(0);
});
it('claims a job once across concurrent workers and respects unexpired leases',async()=>{
  const {source}=await pair();await queue(source.id);
  const results=await Promise.all([processCandidateJobs(c.db),processCandidateJobs(c.db)]);
  expect(results.reduce((n,r)=>n+r.claimed,0)).toBe(1);expect(await candidateCount()).toBe(2);
  await c.db.query("UPDATE social_candidate_jobs SET status='processing',lease_key=$1,lease_until=clock_timestamp()+interval '5 minutes',attempts=2,finished_at=NULL",['L'.repeat(24)]);
  expect((await processCandidateJobs(c.db)).claimed).toBe(0);
  await c.db.query("UPDATE social_candidate_jobs SET lease_until=clock_timestamp()-interval '1 second'");
  expect((await processCandidateJobs(c.db)).completed).toBe(1);
});
it('retries safe failures at most five times and marks expired final leases failed',async()=>{
  const {source}=await pair();await queue(source.id);
  let crash=true;
  const db=observed(async()=>{if(crash)throw new Error('private source content should never persist');});
  expect((await processCandidateJobs(db)).retried).toBe(1);
  let job=(await c.db.query<{status:string;attempts:number;failure_code:string|null}>('SELECT status,attempts,failure_code FROM social_candidate_jobs')).rows[0]!;
  expect(job).toMatchObject({status:'pending',attempts:1,failure_code:'MATCHING_FAILED'});
  crash=false;await c.db.query("UPDATE social_candidate_jobs SET available_at=clock_timestamp()-interval '1 second'");
  expect((await processCandidateJobs(c.db)).completed).toBe(1);
  await c.db.query("UPDATE social_candidate_jobs SET status='processing',lease_key=$1,lease_until=clock_timestamp()-interval '1 second',attempts=5,finished_at=NULL",['F'.repeat(24)]);
  expect((await processCandidateJobs(c.db)).claimed).toBe(0);
  job=(await c.db.query<{status:string;attempts:number;failure_code:string|null}>('SELECT status,attempts,failure_code FROM social_candidate_jobs')).rows[0]!;
  expect(job).toMatchObject({status:'failed',attempts:5});
});
it('bounds each worker invocation to twenty jobs and rejects oversized limits',async()=>{
  await expect(processCandidateJobs(c.db,{limit:21})).rejects.toThrow(/1.*20/);
  await expect(processCandidateJobs(c.db,{limit:0})).rejects.toThrow(/1.*20/);
  for(let i=0;i<21;i++)await socialActor(c.db,`Bounded ${i}`,'INCOGNITO',{activityKey:`bounded-${i}`});
  await c.db.query('DELETE FROM social_candidate_jobs');
  await c.db.transaction(async tx=>{for(const row of (await tx.query<{id:string}>('SELECT id FROM seeking_posts')).rows)await enqueueCandidateJob(tx,row.id);});
  const result=await processCandidateJobs(c.db);expect(result.claimed).toBe(20);
  expect((await processCandidateJobs(c.db)).claimed).toBe(1);
},30_000);
it('does not emit, finish or report completion after another worker replaces the lease during a profile-lock wait',async()=>{
  const {source}=await pair();await queue(source.id);
  const db=observed(async tx=>{await tx.query("UPDATE social_candidate_jobs SET lease_key=$1,lease_until=clock_timestamp()+interval '5 minutes' WHERE status='processing'",['R'.repeat(24)]);});
  const result=await processCandidateJobs(db);
  expect(result.completed).toBe(0);expect(result.notified).toBe(0);
  expect((await c.db.query<{status:string;lease_key:string}>('SELECT status,lease_key FROM social_candidate_jobs')).rows[0]).toEqual({status:'processing',lease_key:'R'.repeat(24)});
});
it.each(['block','pass','request'])('reloads %s history added after selecting the candidate pool',async kind=>{
  const {a,b,source,target}=await pair();
  const cards=kind==='request'?await new DiscoveryService(c.db).discover(b.token,b.post.publicKey):[];
  await queue(source.id);
  const db=observed(async tx=>{
    if(kind==='block')await tx.query('INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) VALUES($1,$2)',[target.profile_id,source.profile_id]);
    if(kind==='pass')await tx.query('INSERT INTO discovery_passes(viewer_profile_id,target_profile_id) VALUES($1,$2)',[target.profile_id,source.profile_id]);
    if(kind==='request')await new ConnectionsService(c.db).request(b.token,{handle:cards[0]!.handle});
  });
  expect((await processCandidateJobs(db)).notified).toBe(0);
  expect((await new NotificationService(c.db).list(a.token)).notifications.filter(n=>n.type==='CANDIDATE_FOUND')).toEqual([]);
});
it('rolls back all candidate notifications and invalidations when a later enqueue fails',async()=>{
  const {source}=await pair();await queue(source.id);
  let inserts=0;
  const db:Database={query:(sql,values)=>c.db.query(sql,values),close:async()=>{},transaction:work=>c.db.transaction(tx=>work({query:async(sql,values)=>{
    if(sql.includes('INSERT INTO social_notifications(')&&++inserts===2)throw new Error('private unsafe diagnostic');
    return tx.query(sql,values);
  }}))};
  const result=await processCandidateJobs(db);
  expect(result).toMatchObject({claimed:1,retried:1,notified:0,completed:0});
  expect(await candidateCount()).toBe(0);
  expect(Number((await c.db.query<{count:string}>("SELECT count(*) FROM social_events WHERE topic IN('notifications','discovery')")).rows[0]!.count)).toBe(0);
});
it('stops before claiming when interrupted and releases unstarted owned leases without consuming attempts',async()=>{
  const {source,target}=await pair();
  const controller=new AbortController();controller.abort();
  expect((await processCandidateJobs(c.db,{signal:controller.signal})).claimed).toBe(0);
  const running=new AbortController();
  const db=observed(async()=>{running.abort();});
  expect((await processCandidateJobs(db,{signal:running.signal})).completed).toBe(1);
  expect((await c.db.query("SELECT status,attempts FROM social_candidate_jobs WHERE status='pending'")).rows).toEqual([{status:'pending',attempts:0}]);
  expect((await c.db.query("SELECT id FROM social_candidate_jobs WHERE status='processing'")).rows).toEqual([]);
  expect((await processCandidateJobs(c.db)).completed).toBe(1);
  expect(await candidateCount()).toBe(2);
  expect(source.id).not.toBe(target.id);
});
