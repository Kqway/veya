import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll,beforeAll,beforeEach,describe,it,expect } from 'vitest';
import { applyMigrations } from '@/lib/db/migrations';
import { ModerationService } from '@/features/moderation/service';
import { createModerationHandler } from '@/features/moderation/http';
import { requireCapability,requireProfile,lockProfiles } from '@/features/social/context';
import { ensurePair,opaqueKey } from '@/features/social/pairs';
import { SafetyService } from '@/features/social/safety';
import { ConversationService } from '@/features/social/conversations';
import { IdentityService } from '@/features/social/identity';
import { createGuestSession } from '@/features/backend/sessions';
import { startTestDatabase } from '../support/postgres';
import { SeekingService } from '@/features/social/seeking';
import { seekingInput,socialActor,forbiddenKeys } from '../support/social';
describe('separate server-owned human moderation',()=>{
 let c:Awaited<ReturnType<typeof startTestDatabase>>,service:ModerationService;
 let secret=randomBytes(32).toString('base64url');
 beforeAll(async()=>{c=await startTestDatabase();await applyMigrations(c.db);service=new ModerationService(c.db,{adminSecret:()=>secret});});
 afterAll(async()=>c?.stop());
 beforeEach(async()=>{await c.db.query('TRUNCATE social_profiles,moderation_admin_sessions,moderation_audit CASCADE');});
 async function report(){
  const a=await socialActor(c.db,'Reporter'),b=await socialActor(c.db,'Target');
  const context=await c.db.transaction(async tx=>{const own=await requireProfile(tx,a.token),peer=await requireProfile(tx,b.token);await lockProfiles(tx,[own.id,peer.id]);const pair=await ensurePair(tx,own,peer,'INCOGNITO','INCOGNITO');const key=opaqueKey();const r=await tx.query<{id:string}>("INSERT INTO connection_requests(public_key,pair_id,sender_profile_id,recipient_profile_id,source_post_id,target_post_id,pending_slot,status,activity_label) VALUES($1,$2,$3,$4,(SELECT id FROM seeking_posts WHERE public_key=$5),(SELECT id FROM seeking_posts WHERE public_key=$6),1,'accepted','Chess') RETURNING id",[opaqueKey(),pair.id,own.id,peer.id,a.post.publicKey,b.post.publicKey]);const m=await tx.query<{id:string}>("INSERT INTO social_matches(public_key,pair_id,request_id,activity_label) VALUES($1,$2,$3,'Chess') RETURNING id",[key,pair.id,r.rows[0]!.id]);await tx.query('INSERT INTO conversations(match_id) VALUES($1)',[m.rows[0]!.id]);return {key,own,peer};});
  for(let i=0;i<23;i++)await new ConversationService(c.db).send(a.token,context.key,{text:`evidence ${i}`});
  await new ConversationService(c.db).disclose(b.token,context.key,{kind:'contact_handle',value:'secret contact',consent:true});
  await new SafetyService(c.db).report(a.token,{matchKey:context.key,reason:'harassment',text:'case text'});
  return {a,b,...context};
 }
 it('rejects guest tokens and role forgery, wrong secrets and unavailable configuration',async()=>{
  const guest=await createGuestSession(c.db);
  await expect(service.queue(guest.token)).rejects.toMatchObject({code:'ADMIN_UNAUTHORIZED'});
  await expect(service.login('wrong')).rejects.toMatchObject({code:'ADMIN_UNAUTHORIZED'});
  await expect(new ModerationService(c.db,{adminSecret:()=>undefined}).login(secret)).rejects.toMatchObject({code:'MODERATION_UNAVAILABLE'});
  const handler=createModerationHandler({db:()=>c.db,origin:'http://localhost',adminSecret:()=>secret,secureCookie:false});
  const forged=await handler(new Request('http://localhost/api/moderation/reports',{headers:{cookie:`veya_guest=${guest.token}; role=admin`}}),['reports']);expect(forged.status).toBe(401);
  const cross=await handler(new Request('http://localhost/api/moderation/session',{method:'POST',headers:{origin:'http://evil','content-type':'application/json'},body:JSON.stringify({secret})}),['session']);expect(cross.status).toBe(403);
 });
 it('expires and revokes sessions and invalidates them after secret rotation',async()=>{
  const admin=await service.login(secret);expect(admin.token).toHaveLength(43);
  await service.queue(admin.token);await service.logout(admin.token);await expect(service.queue(admin.token)).rejects.toMatchObject({code:'ADMIN_UNAUTHORIZED'});
  const expired=await service.login(secret);await c.db.query("UPDATE moderation_admin_sessions SET expires_at=clock_timestamp()-interval '1 second'");await expect(service.queue(expired.token)).rejects.toMatchObject({code:'ADMIN_UNAUTHORIZED'});
  const rotated=await service.login(secret);secret=randomBytes(32).toString('base64url');await expect(service.queue(rotated.token)).rejects.toMatchObject({code:'ADMIN_UNAUTHORIZED'});
 });
 it('bounds immutable evidence and audits reads and actions without private identifiers',async()=>{
  await report();const admin=await service.login(secret);const queue=await service.queue(admin.token);expect(queue.reports).toHaveLength(1);expect(forbiddenKeys(queue)).toEqual([]);
  const key=queue.reports[0]!.publicKey;const evidence=await service.evidence(admin.token,key);expect(evidence.evidence.messages).toHaveLength(20);expect(forbiddenKeys(evidence)).toEqual([]);expect(JSON.stringify(evidence)).not.toContain('secret contact');
  await expect(c.db.query("UPDATE social_reports SET text='rewritten'")).rejects.toMatchObject({code:'23514'});await expect(c.db.query("UPDATE social_reports SET evidence='{}'")).rejects.toMatchObject({code:'23514'});
  await service.action(admin.token,key,{status:'reviewing'});await service.action(admin.token,key,{canSeek:false,canConnect:false,status:'resolved'});
  expect((await c.db.query('SELECT moderator,action FROM moderation_audit')).rows.every(r=>r.moderator==='configured-admin')).toBe(true);
  await expect(c.db.query("UPDATE moderation_audit SET action='queue_read'")).rejects.toMatchObject({code:'23514'});
 });
 it('suspends direct social access, closes affected state and survives recovery',async()=>{
  const m=await report(),admin=await service.login(secret),key=(await service.queue(admin.token)).reports[0]!.publicKey;
  await expect(service.action(m.a.token,key,{moderationStatus:'suspended'})).rejects.toMatchObject({code:'ADMIN_UNAUTHORIZED'});
  await service.action(admin.token,key,{moderationStatus:'suspended'});
  await expect(new ConversationService(c.db).get(m.b.token,m.key)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(c.db.transaction(tx=>requireCapability(tx,m.peer.id,'connect'))).rejects.toMatchObject({code:'FORBIDDEN'});
  expect((await c.db.query('SELECT status FROM conversations')).rows).toEqual([{status:'closed'}]);expect((await c.db.query('SELECT status FROM seeking_posts WHERE profile_id=$1',[m.peer.id])).rows).toEqual([{status:'closed'}]);
  const replacement=await createGuestSession(c.db);await new IdentityService(c.db).recover(replacement.token,{key:m.b.key});await expect(c.db.transaction(tx=>requireProfile(tx,replacement.token))).rejects.toMatchObject({code:'FORBIDDEN'});
 });
 it('uses a separate secure hash-only cookie and guards every evidence/action request',async()=>{
  await report();const handler=createModerationHandler({db:()=>c.db,origin:'https://veya.example',adminSecret:()=>secret,secureCookie:true});
  const login=await handler(new Request('https://veya.example/api/moderation/session',{method:'POST',headers:{origin:'https://veya.example','content-type':'application/json'},body:JSON.stringify({secret})}),['session']);
  expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!;
  expect(cookie).toContain('veya_moderator=');expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');expect(cookie).toContain('SameSite=strict');expect(cookie).toContain('Path=/api/moderation');expect(JSON.stringify(await login.json())).not.toContain(secret);
  const token=cookie.split(';')[0]!.split('=')[1]!;expect(JSON.stringify((await c.db.query('SELECT * FROM moderation_admin_sessions')).rows)).not.toContain(token);
  const key=(await service.queue(token)).reports[0]!.publicKey;
  for(const method of ['GET','PATCH']){
   const response=await handler(new Request(`https://veya.example/api/moderation/reports/${key}`,{method,headers:{origin:'https://veya.example','content-type':'application/json'},...(method==='PATCH'?{body:JSON.stringify({moderationStatus:'suspended'})}:{})}),['reports',key]);expect(response.status).toBe(401);
  }
 });
 it('restricts direct seeking creation without banning existing reads and preserves original evidence',async()=>{
  const m=await report(),admin=await service.login(secret),key=(await service.queue(admin.token)).reports[0]!.publicKey;
  const original=await service.evidence(admin.token,key);
  await new ConversationService(c.db).send(m.a.token,m.key,{text:'later message'});
  await service.action(admin.token,key,{canSeek:false});
  await expect(new SeekingService(c.db).create(m.b.token,seekingInput())).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(new ConversationService(c.db).get(m.b.token,m.key)).resolves.toBeDefined();
  expect((await service.evidence(admin.token,key)).evidence).toEqual(original.evidence);
 });
 it('rechecks expired admin authorization after waiting for profile locks',async()=>{
  const m=await report(),admin=await service.login(secret),key=(await service.queue(admin.token)).reports[0]!.publicKey;
  let release!:()=>void;let locked!:()=>void;const acquired=new Promise<void>(r=>locked=r),gate=new Promise<void>(r=>release=r);
  const held=c.db.transaction(async tx=>{await lockProfiles(tx,[m.own.id,m.peer.id]);locked();await gate;});await acquired;
  await c.db.query("UPDATE moderation_admin_sessions SET expires_at=clock_timestamp()+interval '80 milliseconds'");
  const pending=service.action(admin.token,key,{moderationStatus:'suspended'});const assertion=expect(pending).rejects.toMatchObject({code:'ADMIN_UNAUTHORIZED'});
  await delay(140);release();await held;await assertion;
  expect((await c.db.query('SELECT moderation_status FROM social_profiles WHERE id=$1',[m.peer.id])).rows[0]).toEqual({moderation_status:'active'});
 });
 it('hides admin sessions, audits and cases from an ordinary database role',async()=>{
  await report();const admin=await service.login(secret);await service.queue(admin.token);
  await c.db.query('CREATE ROLE moderation_test_reader NOLOGIN');await c.db.query('GRANT SELECT ON moderation_admin_sessions,moderation_audit,social_reports TO moderation_test_reader');
  await c.db.transaction(async tx=>{await tx.query('SET LOCAL ROLE moderation_test_reader');for(const table of ['moderation_admin_sessions','moderation_audit','social_reports'])expect((await tx.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]).toEqual({count:0});});
 });

 it('caps queue pages at30 and keeps review states report-scoped',async()=>{
  for(let i=0;i<7;i++){
   const m=await report();
   if(i<6)for(const reason of ['spam','unsafe_meeting','impersonation','other'])await new SafetyService(c.db).report(m.a.token,{matchKey:m.key,reason});
  }
  const admin=await service.login(secret),queue=await service.queue(admin.token);expect(queue.reports).toHaveLength(30);expect(forbiddenKeys(queue)).toEqual([]);
  const key=queue.reports[0]!.publicKey;await service.action(admin.token,key,{status:'dismissed'});expect((await service.queue(admin.token,'dismissed')).reports).toEqual([expect.objectContaining({publicKey:key,status:'dismissed'})]);expect((await service.queue(admin.token)).reports.some(r=>r.publicKey===key)).toBe(false);
 });
 it('rejects a queued profile mutation after suspension wins the participant locks',async()=>{
  const m=await report(),admin=await service.login(secret),key=(await service.queue(admin.token)).reports[0]!.publicKey;
  let release!:()=>void;let locked!:()=>void;const acquired=new Promise<void>(r=>locked=r),gate=new Promise<void>(r=>release=r);
  const held=c.db.transaction(async tx=>{await lockProfiles(tx,[m.peer.id]);locked();await gate;});await acquired;
  const waiters=async(count:number)=>{for(let i=0;i<100;i++){const r=await c.db.query<{count:number}>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'");if(r.rows[0]!.count>=count)return;await delay(5);}throw new Error('Expected blocked profile lock waiter');};
  const suspension=service.action(admin.token,key,{moderationStatus:'suspended'});await waiters(1);
  const mutation=new IdentityService(c.db).update(m.b.token,{alias:'Queued change'});const denied=expect(mutation).rejects.toMatchObject({code:'FORBIDDEN'});await waiters(2);
  release();await held;await suspension;await denied;
  expect((await c.db.query('SELECT alias FROM social_profiles WHERE id=$1',[m.peer.id])).rows[0]).toEqual({alias:'Target'});
 });

 it('revokes a session atomically when two tabs sign out concurrently',async()=>{
  const admin=await service.login(secret);const results=await Promise.allSettled([service.logout(admin.token),service.logout(admin.token)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.find(r=>r.status==='rejected')).toMatchObject({status:'rejected',reason:{code:'ADMIN_UNAUTHORIZED'}});
  await expect(service.queue(admin.token)).rejects.toMatchObject({code:'ADMIN_UNAUTHORIZED'});
 });

});

describe('moderation high-degree profiles',()=>{
 let c:Awaited<ReturnType<typeof startTestDatabase>>;
 beforeAll(async()=>{c=await startTestDatabase();await applyMigrations(c.db);});afterAll(async()=>{if(c)await c.stop();});
 it('suspends a profile with more than100 recipients without rolling back enforcement',async()=>{
  const a=await socialActor(c.db,'Reporter'),b=await socialActor(c.db,'Target');
  const own=await c.db.transaction(tx=>requireProfile(tx,a.token)),target=await c.db.transaction(tx=>requireProfile(tx,b.token));
  const peers=(await c.db.query<{id:string}>("INSERT INTO social_profiles(alias,privacy_mode,avatar_seed,languages,adult_confirmed) SELECT 'Peer','INCOGNITO','0123456789abcdef0123456789abcdef',ARRAY['en'],true FROM generate_series(1,100) RETURNING id")).rows;
  await c.db.transaction(async tx=>{await ensurePair(tx,own,target,'INCOGNITO','INCOGNITO');for(const peer of peers){await tx.query("INSERT INTO social_pairs(low_profile_id,high_profile_id,low_privacy,high_privacy) VALUES(LEAST($1::uuid,$2::uuid),GREATEST($1::uuid,$2::uuid),'INCOGNITO','INCOGNITO')",[target.id,peer.id]);}});
  const pair=(await c.db.query<{id:string}>('SELECT id FROM social_pairs WHERE low_profile_id=LEAST($1::uuid,$2::uuid) AND high_profile_id=GREATEST($1::uuid,$2::uuid)',[own.id,target.id])).rows[0]!;
  const key=opaqueKey();await c.db.query("INSERT INTO connection_requests(public_key,pair_id,sender_profile_id,recipient_profile_id,pending_slot,activity_label) VALUES($1,$2,$3,$4,1,'Chess')",[key,pair.id,own.id,target.id]);
  await new SafetyService(c.db).report(a.token,{requestKey:key,reason:'spam'});
  const secret=randomBytes(32).toString('base64url');
  const {publishModerationInvalidations}=await import('@/features/moderation/events');
  const service=new ModerationService(c.db,{adminSecret:()=>secret,onRestriction:publishModerationInvalidations});
  const admin=await service.login(secret),report=(await service.queue(admin.token)).reports[0]!;
  await service.action(admin.token,report.publicKey,{moderationStatus:'suspended'});
  await expect(c.db.transaction(tx=>requireProfile(tx,b.token))).rejects.toMatchObject({code:'FORBIDDEN'});
  expect((await c.db.query("SELECT count(*)::int AS n FROM social_events WHERE topic='match'")).rows[0]!.n).toBe(102);
 });
});
