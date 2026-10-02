import { createHash } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { applyMigrations } from '@/lib/db/migrations';
import { createSocialHandler } from '@/features/social/http';
import { IdentityService } from '@/features/social/identity';
import { DiscoveryService } from '@/features/social/discovery';
import { ConnectionsService } from '@/features/social/connections';
import { ConversationService } from '@/features/social/conversations';
import { SafetyService } from '@/features/social/safety';
import { PlanningService } from '@/features/social/planning';
import { NotificationService } from '@/features/notifications/service';
import { processNotificationJobs } from '@/features/notifications/jobs';
import { ModerationService } from '@/features/moderation/service';
import { VeyaBackend } from '@/features/backend/service';
import { createGuestSession, revokeGuestSession } from '@/features/backend/sessions';
import { lockProfiles } from '@/features/social/context';
import { startTestDatabase } from '../support/postgres';
import { socialActor, forbiddenKeys } from '../support/social';

const origin='http://localhost:3000';
const digest=(key:string)=>createHash('sha256').update(key).digest('hex');
describe('explicit social profile deletion',()=>{
 let c:Awaited<ReturnType<typeof startTestDatabase>>;
 beforeAll(async()=>{c=await startTestDatabase();await applyMigrations(c.db);});
 afterAll(async()=>{await c?.stop();});
 function remove(token:string,input:unknown={confirmation:'DELETE'},requestOrigin=origin){
  const handler=createSocialHandler({origin,db:()=>c.db,tasks:()=>{throw new Error('No AI');}});
  return handler(new Request(origin+'/api/social/profile',{method:'DELETE',headers:{origin:requestOrigin,'content-type':'application/json',cookie:'veya_guest='+token},body:JSON.stringify(input)}),['profile']);
 }
 async function id(key:string){return(await c.db.query<{id:string}>('SELECT id FROM social_profiles WHERE recovery_key_hash=$1',[digest(key)])).rows[0]!.id;}
 async function pair(){
  const city='Deletion '+Math.random().toString(36).slice(2,10);
  const a=await socialActor(c.db,'Secret alias A','INCOGNITO',{city});
  const b=await socialActor(c.db,'Secret alias B','INCOGNITO',{city});
  const card=(await new DiscoveryService(c.db).discover(a.token,a.post.publicKey))[0]!;
  const network=new ConnectionsService(c.db);
  const request=await network.request(a.token,{handle:card.handle});
  const match=(await network.respond(b.token,request.publicKey,{action:'accept'})).matchKey!;
  return {a,b,match,request,profileId:await id(a.key)};
 }
 it('requires exact confirmation, active server-owned session and same origin',async()=>{
  const a=await socialActor(c.db,'Confirm first');
  expect((await remove(a.token,{},'https://foreign.example')).status).toBe(403);
  for(const input of [{},{confirmation:'delete'},{confirmation:'DELETE',profileId:await id(a.key)}])expect((await remove(a.token,input)).status).toBe(400);
  expect((await remove('')).status).toBe(401);
  expect((await new IdentityService(c.db).get(a.token))?.alias).toBe('Confirm first');
  await revokeGuestSession(c.db,a.token);
  expect((await remove(a.token)).status).toBe(401);
 });
 it('erases private social data, invalidates keys and bindings, preserves immutable report evidence and peer history',async()=>{
  const {a,b,match,request,profileId}=await pair();
  const chat=new ConversationService(c.db);
  await chat.send(a.token,match,{text:'Reported private message'});
  await chat.send(b.token,match,{text:'Peer-authored history'});
  await chat.disclose(a.token,match,{kind:'contact_handle',value:'@private-contact',consent:true});
  await new SafetyService(c.db).report(b.token,{matchKey:match,reason:'harassment',text:'Evidence must survive deletion'});
  const evidence=(await c.db.query<{evidence:unknown}>('SELECT evidence FROM social_reports WHERE target_profile_id=$1',[profileId])).rows[0]!.evidence;
  const response=await remove(a.token);
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({deleted:true});
  const identity=new IdentityService(c.db);
  expect(await identity.get(a.token)).toBeNull();
  await expect(identity.recover((await createGuestSession(c.db)).token,{key:a.key})).rejects.toMatchObject({code:'NOT_FOUND'});
  const tombstone=(await c.db.query<Record<string,unknown>>('SELECT alias,age_band,languages,recovery_key_hash,deleted_at,moderation_status FROM social_profiles WHERE id=$1',[profileId])).rows[0]!;
  expect(tombstone).toMatchObject({alias:'Deleted participant',age_band:null,languages:[],recovery_key_hash:null,moderation_status:'suspended'});
  expect(tombstone.deleted_at).not.toBeNull();
  for(const table of ['social_profile_bindings','seeking_posts','social_push_subscriptions'])expect((await c.db.query(`SELECT 1 FROM ${table} WHERE profile_id=$1`,[profileId])).rows).toEqual([]);
  for(const table of ['messages','match_disclosures'])expect((await c.db.query(`SELECT 1 FROM ${table} WHERE sender_profile_id=$1`,[profileId])).rows).toEqual([]);
  expect((await c.db.query('SELECT 1 FROM social_notifications WHERE recipient_profile_id=$1 OR peer_profile_id=$1',[profileId])).rows).toEqual([]);
  expect((await c.db.query('SELECT 1 FROM social_events WHERE recipient_profile_id=$1',[profileId])).rows).toEqual([]);
  expect((await c.db.query<{evidence:unknown}>('SELECT evidence FROM social_reports WHERE target_profile_id=$1',[profileId])).rows[0]!.evidence).toEqual(evidence);
  const view=await chat.get(b.token,match);
  expect(view).toMatchObject({status:'closed',identity:{alias:'Deleted participant'},disclosures:[],planSlug:null});
  expect(forbiddenKeys(view)).toEqual([]);
  expect((await chat.messages(b.token,match)).messages.map(m=>m.text)).toEqual(['Peer-authored history']);
  await expect(chat.send(b.token,match,{text:'Cannot write'})).rejects.toMatchObject({code:'CONFLICT'});
  await expect(chat.send(a.token,match,{text:'No stale social access'})).rejects.toMatchObject({code:'NOT_FOUND'});
  expect((await new DiscoveryService(c.db).discover(b.token,b.post.publicKey))).toEqual([]);
  expect((await new ConnectionsService(c.db).list(b.token)).find(r=>r.publicKey===request.publicKey)?.identity.alias).toBe('Deleted participant');
  expect((await new NotificationService(c.db).list(b.token)).notifications).toEqual([]);
  expect((await remove(a.token)).status).toBe(200);
  expect((await identity.get(b.token))?.alias).toBe('Secret alias B');
 });
 it('allows suspended owners to delete but database prevents tombstone reactivation or rebinding',async()=>{
  const a=await socialActor(c.db,'Suspended owner');const profileId=await id(a.key);
  await c.db.query("UPDATE social_profiles SET moderation_status='suspended' WHERE id=$1",[profileId]);
  expect((await remove(a.token)).status).toBe(200);
  await expect(c.db.query("UPDATE social_profiles SET moderation_status='active',can_seek=true WHERE id=$1",[profileId])).rejects.toMatchObject({code:'23514'});
  await expect(c.db.query('UPDATE social_profiles SET deleted_at=NULL WHERE id=$1',[profileId])).rejects.toMatchObject({code:'23514'});
  const fresh=await createGuestSession(c.db);
  await expect(c.db.query('INSERT INTO social_profile_bindings(guest_id,profile_id) SELECT id,$2 FROM guest_participant_sessions WHERE token_hash=$1',[digest(fresh.token),profileId])).rejects.toMatchObject({code:'23514'});
 });
 it('keeps moderation case actions available but rejects reactivation of a deleted target safely',async()=>{
  const {a,b,match,profileId}=await pair();
  await new SafetyService(c.db).report(b.token,{matchKey:match,reason:'spam'});
  const report=(await c.db.query<{public_key:string}>('SELECT public_key FROM social_reports WHERE target_profile_id=$1',[profileId])).rows[0]!;
  const admin=new ModerationService(c.db,{adminSecret:()=> 'm'.repeat(48)});
  const session=await admin.login('m'.repeat(48));
  expect((await remove(a.token)).status).toBe(200);
  await expect(admin.action(session.token,report.public_key,{moderationStatus:'active',canSeek:true})).rejects.toMatchObject({status:409,code:'PROFILE_UNAVAILABLE'});
  expect((await admin.action(session.token,report.public_key,{status:'reviewing'})).report.status).toBe('reviewing');
  expect((await admin.evidence(session.token,report.public_key)).evidence.profiles).toHaveLength(2);
 });
 it('keeps shared plans and confirmed time while erasing linked own participant details and identity caches',async()=>{
  const {a,b,match}=await pair();const backend=new VeyaBackend(c.db);
  const legacy=await backend.createIntent(a.token,{rawText:'Independent legacy plan'});
  const linked=await new PlanningService(c.db).plan(a.token,match);
  await backend.joinIntent(a.token,linked.publicSlug,{displayName:'Private real name',notes:'Private notes',availability:a.post.availability});
  await backend.joinIntent(b.token,linked.publicSlug,{displayName:'Peer name',availability:b.post.availability});
  const results=await backend.getResults(linked.publicSlug,a.token);
  await backend.decide(a.token,linked.publicSlug,{suggestionKey:results.suggestions[0]!.suggestionKey,revision:results.revision});
  expect((await remove(a.token)).status).toBe(200);
  const remaining=await backend.getIntent(linked.publicSlug,b.token);
  expect(remaining.intent).toMatchObject({creatorName:'Deleted participant',participantCount:1,status:'decided'});
  expect((await backend.getIntent(linked.publicSlug,a.token)).ownParticipant).toBeNull();
  const after=await backend.getResults(linked.publicSlug,b.token);
  expect(after.selectedSuggestionKey).toBe(results.suggestions[0]!.suggestionKey);
  expect(JSON.stringify(after)).not.toMatch(/Private real name|Private notes/);
  expect((await backend.getIntent(legacy.intent.publicSlug,a.token)).isCreator).toBe(true);
 });
 it('cancels push/workers after deletion and is safe under concurrent repeated requests',async()=>{
  const {a,b,match,profileId}=await pair();
  await c.db.query("INSERT INTO social_push_subscriptions(guest_id,profile_id,endpoint,p256dh,auth) SELECT guest_id,profile_id,$2,$3,$4 FROM social_profile_bindings WHERE profile_id=$1",[profileId,'https://fcm.googleapis.com/beta-delete-'+Math.random().toString(36).slice(2),'x'.repeat(87),'y'.repeat(22)]);
  await new ConversationService(c.db).send(b.token,match,{text:'Pending push'});
  expect((await c.db.query('SELECT 1 FROM social_notification_jobs j JOIN social_push_subscriptions s ON s.id=j.subscription_id WHERE s.profile_id=$1',[profileId])).rows).toHaveLength(1);
  const repeated=await Promise.all([remove(a.token),remove(a.token)]);
  expect(repeated.map(r=>r.status)).toEqual([200,200]);
  let sent=0;
  const batch=await processNotificationJobs(c.db,{push:{publicKey:'x'.repeat(87),privateKey:'y'.repeat(43),subject:'mailto:ops@example.test'},sender:async()=>{sent++;}});
  expect(batch.claimed).toBe(0);expect(sent).toBe(0);
 });
 it('erases the second participant linked-plan details after the first profile has been deleted',async()=>{
  const {a,b,match}=await pair();const backend=new VeyaBackend(c.db);
  const linked=await new PlanningService(c.db).plan(a.token,match);
  await backend.joinIntent(a.token,linked.publicSlug,{displayName:'First private name',notes:'First private notes',availability:a.post.availability});
  await backend.joinIntent(b.token,linked.publicSlug,{displayName:'Second private name',notes:'Second private notes',availability:b.post.availability});
  expect((await remove(a.token)).status).toBe(200);
  expect((await remove(b.token)).status).toBe(200);
  expect((await c.db.query('SELECT 1 FROM participants WHERE intent_id=(SELECT id FROM intents WHERE public_slug=$1)',[linked.publicSlug])).rows).toEqual([]);
  expect((await c.db.query('SELECT 1 FROM availability_windows w JOIN participants p ON p.id=w.participant_id WHERE p.intent_id=(SELECT id FROM intents WHERE public_slug=$1)',[linked.publicSlug])).rows).toEqual([]);
 });
 it('serializes deletion against recovery and queued writes without restoring access',async()=>{
  const {a,b,match,profileId}=await pair();const fresh=await createGuestSession(c.db);
  let release!:()=>void,ready!:()=>void;const held=new Promise<void>(r=>{release=r;}),locked=new Promise<void>(r=>{ready=r;});
  const holder=c.db.transaction(async tx=>{await lockProfiles(tx,[profileId]);ready();await held;});
  await locked;
  const deleting=remove(a.token);
  const until=async(n:number)=>{const deadline=Date.now()+4000;while(Number((await c.db.query<{count:string}>("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%veya-social-profile:%'")).rows[0]!.count)<n){if(Date.now()>deadline)throw new Error('Expected lock wait');await new Promise(r=>setTimeout(r,10));}};
  let recovery:Promise<unknown>|undefined,send:Promise<unknown>|undefined;
  try{
   await until(1);
   recovery=new IdentityService(c.db).recover(fresh.token,{key:a.key}).catch(e=>e);
   send=new ConversationService(c.db).send(b.token,match,{text:'Queued after delete'}).catch(e=>e);
   await until(3);
  }finally{release();}
  await holder;
  expect((await deleting).status).toBe(200);
  expect(await recovery).toMatchObject({code:'NOT_FOUND'});
  expect(await send).toMatchObject({code:'CONFLICT'});
 });
});
