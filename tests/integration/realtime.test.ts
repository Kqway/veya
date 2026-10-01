import type { QueryResultRow } from 'pg';
import type { Database } from '@/lib/db/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '@/lib/db/migrations';
import { requireProfile } from '@/features/social/context';
import { publishSocialEvent, readSocialEvents } from '@/features/realtime/events';
import { EventHub } from '@/features/realtime/hub';
import { createRealtimeHandler } from '@/features/realtime/http';
import { revokeGuestSession } from '@/features/backend/sessions';
import { startTestDatabase } from '../support/postgres';
import { socialActor } from '../support/social';

describe('private transaction-backed realtime', () => {
 let c: Awaited<ReturnType<typeof startTestDatabase>>;
 let hub: EventHub;
 beforeAll(async()=> { c=await startTestDatabase(); await applyMigrations(c.db); });
 beforeEach(async()=> { await c.db.query('TRUNCATE social_profiles CASCADE'); hub=new EventHub(c.connectionString); });
 afterEach(async()=> {await hub?.close();});
 afterAll(async()=> { await hub?.close(); await c?.stop(); });
 async function actor(alias:string) { const a=await socialActor(c.db,alias); const p=await requireProfile(c.db,a.token); await c.db.query('DELETE FROM social_events WHERE recipient_profile_id=$1',[p.id]); return {...a,id:p.id}; }
 it('rolls back events and fans out only committed recipient hints',async()=> {
  const a=await actor('A'), b=await actor('B'); const changes:string[]=[];
  const offA=await hub.subscribe(a.id,reason=> { if(reason==='change') changes.push('a'); });
  const offB=await hub.subscribe(b.id,reason=> { if(reason==='change') changes.push('b'); });
  await expect(c.db.transaction(async tx=> { await publishSocialEvent(tx,[a.id,b.id],{topic:'connections'}); throw new Error('rollback'); })).rejects.toThrow('rollback');
  expect((await c.db.query('SELECT * FROM social_events')).rows).toHaveLength(0); expect(changes).toEqual([]);
  await c.db.transaction(tx=>publishSocialEvent(tx,[a.id,a.id],{topic:'connections'}));
  await expect.poll(()=>changes).toEqual(['a']);
  const rows=(await c.db.query('SELECT * FROM social_events')).rows; expect(rows).toHaveLength(1);
  offA(); offB(); expect(hub.subscriberCount).toBe(0); await hub.close();
 });
 it('assigns unrelated public cursors and bounds recipient backfill',async()=> {
  const a=await actor('A'),b=await actor('B');
  await c.db.transaction(tx=>publishSocialEvent(tx,[a.id,b.id],{topic:'discovery'}));
  const ea=await readSocialEvents(c.db,a.id),eb=await readSocialEvents(c.db,b.id);
  expect(ea.events[0]?.publicKey).toMatch(/^[A-Za-z0-9_-]{24}$/); expect(ea.events[0]?.publicKey).not.toBe(eb.events[0]?.publicKey);
  expect((await readSocialEvents(c.db,a.id,eb.events[0]!.publicKey)).cursorValid).toBe(false);
  for(let i=0;i<105;i++) await c.db.transaction(tx=>publishSocialEvent(tx,[a.id],{topic:'connections'}));
  const page=await readSocialEvents(c.db,a.id,ea.events[0]!.publicKey); expect(page.events).toHaveLength(100); expect(page.overflow).toBe(true);
  expect(JSON.stringify(page.events)).not.toContain(a.id);
  await hub.close();
 });
 it('does not publish an unauthorized match key',async()=> {
  const a=await actor('A');
  await c.db.transaction(tx=>publishSocialEvent(tx,[a.id],{topic:'match',matchKey:'x'.repeat(24)}));
  expect((await readSocialEvents(c.db,a.id)).events).toEqual([expect.objectContaining({topic:'match'})]);
  expect(JSON.stringify((await readSocialEvents(c.db,a.id)).events)).not.toContain('x'.repeat(24)); await hub.close();
 });
 it('authenticates streams, ignores foreign cursors, revokes on flush and cleans up cancellation',async()=> {
  const a=await actor('A'),b=await actor('B'); const handle=createRealtimeHandler({db:c.db,hub});
  const req=(token:string,path='')=>new Request('http://localhost/api/social/events'+path,{headers:{cookie:`veya_guest=${token}`}});
  expect((await handle(req(''))).status).toBe(401);
  expect((await handle(req(a.token,'?profile='+b.id))).status).toBe(400);
  await c.db.transaction(tx=>publishSocialEvent(tx,[b.id],{topic:'connections'}));
  const foreign=(await readSocialEvents(c.db,b.id)).events[0]!.publicKey;
  const response=await handle(req(a.token,'?cursor='+foreign)); expect(response.status).toBe(200); expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  const reader=response.body!.getReader(),decode=(v:Uint8Array|undefined)=>new TextDecoder().decode(v);
  expect(decode((await reader.read()).value)).toContain('event: sync');
  await c.db.transaction(tx=>publishSocialEvent(tx,[a.id],{topic:'notifications'}));
  const frame=decode((await reader.read()).value); expect(frame).toContain('notifications'); expect(frame).not.toContain(a.id);
  await revokeGuestSession(c.db,a.token); await c.db.transaction(tx=>publishSocialEvent(tx,[a.id],{topic:'connections'}));
  expect((await reader.read()).done).toBe(true); expect(hub.subscriberCount).toBe(0);
  const stream=await handle(req(b.token)); await stream.body!.cancel(); expect(hub.subscriberCount).toBe(0); await hub.close();
 });
 it('replays recipient history on reconnect with a mandatory sync',async()=> {
  const a=await actor('A');
  await c.db.transaction(tx=>publishSocialEvent(tx,[a.id],{topic:'connections'}));
  const cursor=(await readSocialEvents(c.db,a.id)).events[0]!.publicKey;
  await c.db.transaction(tx=>publishSocialEvent(tx,[a.id],{topic:'notifications'}));
  const handle=createRealtimeHandler({db:c.db,hub});
  const response=await handle(new Request('http://localhost/api/social/events',{headers:{cookie:`veya_guest=${a.token}`,'last-event-id':cursor}}));
  const reader=response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: sync');
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('notifications');
  await reader.cancel(); expect(hub.subscriberCount).toBe(0);
 });
 it('recovers a terminated native LISTEN connection and synchronizes all active streams',async()=> {
  await hub.close(); hub=new EventHub(c.connectionString,{retryBaseMs:10});
  const a=await actor('A'),b=await actor('B'),changes:string[]=[];
  const offA=await hub.subscribe(a.id,reason=>changes.push('a:'+reason));
  const offB=await hub.subscribe(b.id,reason=>changes.push('b:'+reason));
  await c.db.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='veya-social-listener'");
  await expect.poll(()=>changes).toEqual(['a:sync','b:sync']);
  await c.db.transaction(tx=>publishSocialEvent(tx,[b.id],{topic:'connections'}));
  await expect.poll(()=>changes.at(-1)).toBe('b:change');
  offA();offB();expect(hub.subscriberCount).toBe(0);
 });
 it('reauthorizes binding, expiry and suspension on heartbeats without polling events',async()=> {
  for(const revoke of ['binding','expiry','suspension']) {
   const a=await actor('A');
   let eventReads=0;
   const db:Database={...c.db,query:async<Row extends QueryResultRow>(sql:string,values?:readonly unknown[])=> {if(sql.includes('social_events')) eventReads++;return c.db.query<Row>(sql,values);},transaction:c.db.transaction.bind(c.db),close:c.db.close.bind(c.db)};
   const handle=createRealtimeHandler({db,hub,heartbeatMs:20});
   const response=await handle(new Request('http://localhost/api/social/events',{headers:{cookie:`veya_guest=${a.token}`}}));
   const reader=response.body!.getReader();await reader.read();const reads=eventReads;
   expect(new TextDecoder().decode((await reader.read()).value)).toContain('heartbeat');expect(eventReads).toBe(reads);
   if(revoke==='binding') await c.db.query('DELETE FROM social_profile_bindings WHERE profile_id=$1',[a.id]);
   if(revoke==='expiry') await c.db.query("UPDATE guest_participant_sessions SET created_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()-interval '1 second' WHERE id IN(SELECT guest_id FROM social_profile_bindings WHERE profile_id=$1)",[a.id]);
   if(revoke==='suspension') await c.db.query("UPDATE social_profiles SET moderation_status='suspended' WHERE id=$1",[a.id]);
   let result=await reader.read();while(!result.done) result=await reader.read();
   expect(hub.subscriberCount).toBe(0);
  }
 });
 it('limits concurrent streams and closes bounded lifetime and aborted requests',async()=> {
  const a=await actor('A');const handle=createRealtimeHandler({db:c.db,hub,lifetimeMs:5000});
  const request=(signal?:AbortSignal)=>new Request('http://localhost/api/social/events',{headers:{cookie:`veya_guest=${a.token}`},...(signal ? {signal}:{})});
  const responses=await Promise.all([handle(request()),handle(request()),handle(request())]);
  expect(responses.map(r=>r.status)).toEqual([200,200,200]);
  expect((await handle(request())).status).toBe(503);
  const readers=responses.map(r=>r.body!.getReader());await Promise.all(readers.map(r=>r.read()));
  await Promise.all(readers.map(r=>r.cancel()));expect(hub.subscriberCount).toBe(0);
  const short=createRealtimeHandler({db:c.db,hub,lifetimeMs:40});const expires=await short(request());const expiryReader=expires.body!.getReader();await expiryReader.read();expect((await expiryReader.read()).done).toBe(true);expect(hub.subscriberCount).toBe(0);
  const abort=new AbortController(),response=await handle(request(abort.signal));
  const reader=response.body!.getReader();await reader.read();abort.abort();expect((await reader.read()).done).toBe(true);expect(hub.subscriberCount).toBe(0);
 });

 it('disconnects a slow reader when the bounded stream buffer fills',async()=> {
  const a=await actor('A');const handle=createRealtimeHandler({db:c.db,hub,heartbeatMs:1,lifetimeMs:2000,bufferBytes:100});
  const response=await handle(new Request('http://localhost/api/social/events',{headers:{cookie:`veya_guest=${a.token}`}}));
  expect(response.status).toBe(200);await expect.poll(()=>hub.subscriberCount).toBe(0);await response.body!.cancel();
 });

});
