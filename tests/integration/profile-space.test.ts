import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '@/lib/db/migrations';
import { createSocialHandler } from '@/features/social/http';
import { DiscoveryService } from '@/features/social/discovery';
import { ConnectionsService } from '@/features/social/connections';
import { IdentityService } from '@/features/social/identity';
import { createGuestSession } from '@/features/backend/sessions';
import { ProfileSpaceService } from '@/features/profile-space/service';
import type { Database } from '@/lib/db/types';
import { lockProfiles } from '@/features/social/context';
import { startTestDatabase } from '../support/postgres';
import { socialActor, forbiddenKeys } from '../support/social';
const origin='http://localhost:3000';
describe('context-authorized profile spaces',()=>{
 let c:Awaited<ReturnType<typeof startTestDatabase>>;
 beforeAll(async()=>{c=await startTestDatabase();await applyMigrations(c.db);});
 afterAll(async()=>{await c?.stop();});
 beforeEach(async()=>{await c.db.query('TRUNCATE social_profiles CASCADE');});
 function api(token:string,path:string,method='GET',body?:unknown,requestOrigin=origin){
  return createSocialHandler({origin,db:()=>c.db,tasks:()=>{throw new Error('No AI');}})(new Request(origin+'/api/social/'+path,{method,headers:{origin:requestOrigin,'content-type':'application/json',cookie:'veya_guest='+token},...(body===undefined?{}:{body:JSON.stringify(body)})}),path.split('/'));
 }
 async function get(token:string,path='profile/space') {const response=await api(token,path);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');return (await response.json()).space;}
 async function configured(token:string,patch:Record<string,unknown>={}){
  const self=await get(token);const settings={...self.customization,world:'cyber',status:'Secret status',tagline:'Secret tagline',interests:['secret-interest'],goals:['secret-goal'],selectedActivities:['chess'],visibility:{status:'everyone',tagline:'everyone',intent:'everyone',activities:'everyone',interests:'everyone',goals:'everyone'},...patch};
  expect((await api(token,'profile/space','PATCH',settings)).status).toBe(200);return settings;
 }
 async function context(a:Awaited<ReturnType<typeof socialActor>>,b:Awaited<ReturnType<typeof socialActor>>){
  await new DiscoveryService(c.db).discover(a.token,a.post.publicKey);
  return (await c.db.query<{public_handle:string}>('SELECT public_handle FROM discovery_handles WHERE source_post_id=(SELECT id FROM seeking_posts WHERE public_key=$1) AND target_post_id=(SELECT id FROM seeking_posts WHERE public_key=$2)',[a.post.publicKey,b.post.publicKey])).rows[0]!.public_handle;
 }
 it('adds self DTO without changing identity and roundtrips strict settings through HTTP',async()=>{
  const a=await socialActor(c.db,'Owner','OPEN');const old=await new IdentityService(c.db).get(a.token);
  const self=await get(a.token);expect(self.audience).toBe('self');expect(self.action).toEqual({kind:'seek',key:null});expect(self.activityOptions).toEqual([{activityKey:'chess',activityLabel:'Chess',count:1}]);expect(self.intentOptions).toEqual([{publicKey:a.post.publicKey,activityLabel:'Chess'}]);
  const settings=await configured(a.token,{intentPostKey:a.post.publicKey});expect((await get(a.token)).customization).toEqual(settings);expect(await new IdentityService(c.db).get(a.token)).toEqual(old);
  expect((await api(a.token,'profile/space','PATCH',{...settings,css:'color:red'})).status).toBe(400);
  expect((await api(a.token,'profile/space','PATCH',settings,'https://foreign.example')).status).toBe(403);
  expect((await api('','profile/space')).status).toBe(401);
  expect(forbiddenKeys(await get(a.token))).toEqual([]);
 });
 it('rejects foreign selected intents and fabricated activity history',async()=>{
  const a=await socialActor(c.db,'Owner','OPEN');const b=await socialActor(c.db,'Other','OPEN');const settings=(await get(a.token)).customization;
  expect((await api(a.token,'profile/space','PATCH',{...settings,intentPostKey:b.post.publicKey})).status).toBe(400);
  expect((await api(a.token,'profile/space','PATCH',{...settings,selectedActivities:['fabricated']})).status).toBe(400);
 });
 it.each(['closed','expired','past-availability'])('returns a saveable self draft after the selected intent becomes %s without changing stored settings',async(kind)=>{
  const a=await socialActor(c.db,'Owner','OPEN');const saved=await configured(a.token,{intentPostKey:a.post.publicKey});
  if(kind==='closed')await c.db.query("UPDATE seeking_posts SET status='closed' WHERE public_key=$1",[a.post.publicKey]);
  if(kind==='expired')await c.db.query("UPDATE seeking_posts SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE public_key=$1",[a.post.publicKey]);
  if(kind==='past-availability')await c.db.query("UPDATE seeking_availability SET start_at=clock_timestamp()-interval '2 hours',end_at=clock_timestamp()-interval '1 hour' WHERE post_id=(SELECT id FROM seeking_posts WHERE public_key=$1)",[a.post.publicKey]);
  const space=await get(a.token);expect(space.customization.intentPostKey).toBeNull();expect(space.currentIntent).toBeNull();expect(space.intentOptions).toEqual([]);
  expect((await c.db.query<{customization:unknown}>('SELECT customization FROM social_profile_spaces')).rows[0]!.customization).toEqual(saved);
  expect((await api(a.token,'profile/space','PATCH',{...saved,world:'cozy'})).status).toBe(400);
  expect((await api(a.token,'profile/space','PATCH',{...space.customization,world:'cozy'})).status).toBe(200);
 });
 it('clears selected activities removed by retention in the returned draft without mutating stored customization',async()=>{
  const a=await socialActor(c.db,'Owner','OPEN');const saved=await configured(a.token);
  await c.db.query('DELETE FROM seeking_posts WHERE public_key=$1',[a.post.publicKey]);
  const space=await get(a.token);expect(space.activityOptions).toEqual([]);expect(space.customization.selectedActivities).toEqual([]);
  expect((await c.db.query<{customization:unknown}>('SELECT customization FROM social_profile_spaces')).rows[0]!.customization).toEqual(saved);
  expect((await api(a.token,'profile/space','PATCH',saved)).status).toBe(400);
  expect((await api(a.token,'profile/space','PATCH',{...space.customization,world:'midnight'})).status).toBe(200);
 });
 it('keeps authentic selected activities editable and visible beyond the recent twenty history categories',async()=>{
  const a=await socialActor(c.db,'Owner','OPEN');await configured(a.token);
  await c.db.query(`INSERT INTO seeking_posts(public_key,profile_id,active_slot,raw_text,activity_key,activity_label,interaction_mode,format,city,skill,languages,privacy_mode,status,expires_at)
   SELECT lpad(n::text,24,'0'),p.profile_id,1,'Recent activity','activity-'||n,'Activity '||n,p.interaction_mode,p.format,p.city,p.skill,p.languages,p.privacy_mode,'closed',clock_timestamp()+interval '7 days' FROM seeking_posts p CROSS JOIN generate_series(1,21) n WHERE p.public_key=$1`,[a.post.publicKey]);
  const space=await get(a.token);expect(space.activityOptions).toHaveLength(20);expect(space.activityOptions).toContainEqual({activityKey:'chess',activityLabel:'Chess',count:1});expect(space.customization.selectedActivities).toEqual(['chess']);expect(space.activities).toEqual([{activityKey:'chess',activityLabel:'Chess',count:1}]);
  expect((await api(a.token,'profile/space','PATCH',space.customization)).status).toBe(200);
  const b=await socialActor(c.db,'Viewer','OPEN');const handle=await context(b,a);
  expect((await get(b.token,'profiles/discovery/'+handle)).activities).toEqual([{activityKey:'chess',activityLabel:'Chess',count:1}]);
 });
 it('projects open stranger and connection fields and existing request/chat CTA without duplication',async()=>{
  const a=await socialActor(c.db,'Viewer','OPEN');const b=await socialActor(c.db,'Peer','OPEN');await configured(b.token);const handle=await context(a,b);
  const stranger=await get(a.token,'profiles/discovery/'+handle);expect(stranger).toMatchObject({audience:'stranger',status:'Secret status',presentation:{world:'cyber'},action:{kind:'interest',key:handle}});expect(stranger.customization).toBeUndefined();expect(stranger.intentOptions).toBeUndefined();expect(stranger.activityOptions).toBeUndefined();expect(forbiddenKeys(stranger)).toEqual([]);
  const request=await new ConnectionsService(c.db).request(a.token,{handle});
  expect((await get(a.token,'profiles/discovery/'+handle)).action).toEqual({kind:'connections',key:request.publicKey});
  const connection=await get(a.token,'profiles/connection/'+request.publicKey);expect(connection.audience).toBe('stranger');expect(connection.status).toBe('Secret status');
  const accepted=await new ConnectionsService(c.db).respond(b.token,request.publicKey,{action:'accept'});
  expect((await get(a.token,'profiles/connection/'+request.publicKey)).action).toEqual({kind:'chat',key:accepted.matchKey});expect((await get(a.token,'profiles/match/'+accepted.matchKey)).action).toEqual({kind:'chat',key:accepted.matchKey});
  expect((await c.db.query('SELECT 1 FROM connection_requests')).rows).toHaveLength(1);
 });
 it.each(['profile','post','persisted'])('suppresses all global customization for %s incognito including after match',async(kind)=>{
  const a=await socialActor(c.db,'Viewer','OPEN');const b=await socialActor(c.db,'Secret alias','OPEN',kind==='post'?{privacyMode:'INCOGNITO'}:{});await configured(b.token);
  if(kind==='profile')await new IdentityService(c.db).update(b.token,{privacyMode:'INCOGNITO'});
  const handle=await context(a,b);
  if(kind==='persisted') {await c.db.query("UPDATE social_pairs SET low_privacy='INCOGNITO',high_privacy='INCOGNITO'");}
  const card=(await new DiscoveryService(c.db).discover(a.token,a.post.publicKey))[0]!;
  const space=await get(a.token,'profiles/discovery/'+handle);expect(space.currentIntent?.activityLabel).toBe('Chess');expect(space).toMatchObject({status:null,tagline:null,activities:[],interests:[],goals:[]});expect(JSON.stringify(space)).not.toMatch(/Secret|secret-/);expect(space.presentation).toEqual(card.presentation);
  await configured(b.token,{world:'monochrome',accent:'blue',avatar:'grid'});expect((await get(a.token,'profiles/discovery/'+handle)).presentation).toEqual(space.presentation);
  const network=new ConnectionsService(c.db);const request=await network.request(a.token,{handle});const accepted=await network.respond(b.token,request.publicKey,{action:'accept'});const matched=await get(a.token,'profiles/match/'+accepted.matchKey);expect(matched).toMatchObject({status:null,tagline:null,activities:[],interests:[],goals:[]});expect(JSON.stringify(matched)).not.toMatch(/Secret|secret-/);
 });
 it('reveals connection-only fields only after mutual acceptance',async()=>{
  const a=await socialActor(c.db,'Viewer','OPEN');const b=await socialActor(c.db,'Peer','OPEN');await configured(b.token,{visibility:{status:'connection',tagline:'connection',intent:'connection',activities:'connection',interests:'connection',goals:'connection'}});const handle=await context(a,b);
  const request=await new ConnectionsService(c.db).request(a.token,{handle});
  for(const path of ['profiles/discovery/'+handle,'profiles/connection/'+request.publicKey])expect(await get(a.token,path)).toMatchObject({audience:'stranger',status:null,tagline:null,activities:[],interests:[],goals:[]});
  await new ConnectionsService(c.db).respond(b.token,request.publicKey,{action:'accept'});
  expect(await get(a.token,'profiles/connection/'+request.publicKey)).toMatchObject({audience:'connection',status:'Secret status',interests:['secret-interest']});
 });
 it('private stranger sees context only and explicit connection visibility works',async()=>{
  const a=await socialActor(c.db,'Viewer','OPEN');const b=await socialActor(c.db,'Peer','PRIVATE');await configured(b.token);const handle=await context(a,b);const space=await get(a.token,'profiles/discovery/'+handle);expect(space).toMatchObject({status:null,tagline:null,activities:[],interests:[],goals:[]});
  const request=await new ConnectionsService(c.db).request(a.token,{handle});expect((await get(a.token,'profiles/connection/'+request.publicKey)).status).toBeNull();
  await new ConnectionsService(c.db).respond(b.token,request.publicKey,{action:'accept'});expect((await get(a.token,'profiles/connection/'+request.publicKey)).status).toBe('Secret status');
 });
 it.each(['foreign','pass','block','expired','suspended','incompatible','declined','expired-request'])('returns generic 404 for %s contexts',async(kind)=>{
  const a=await socialActor(c.db,'Viewer','OPEN');const b=await socialActor(c.db,'Peer','OPEN');const outsider=await socialActor(c.db,'Outsider','OPEN');const handle=await context(a,b);let token=a.token;const path='profiles/discovery/'+handle;
  if(kind==='foreign')token=outsider.token;
  if(kind==='pass')await new DiscoveryService(c.db).pass(a.token,handle);
  if(kind==='block')await c.db.query('INSERT INTO social_blocks SELECT s.profile_id,t.profile_id FROM seeking_posts s,seeking_posts t WHERE s.public_key=$1 AND t.public_key=$2',[a.post.publicKey,b.post.publicKey]);
  if(kind==='expired')await c.db.query("UPDATE seeking_posts SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE public_key=$1",[b.post.publicKey]);
  if(kind==='suspended')await c.db.query("UPDATE social_profiles SET moderation_status='suspended' WHERE id=(SELECT profile_id FROM seeking_posts WHERE public_key=$1)",[b.post.publicKey]);
  if(kind==='incompatible')await c.db.query("UPDATE seeking_posts SET activity_key='football' WHERE public_key=$1",[b.post.publicKey]);
  if(kind==='declined'||kind==='expired-request'){const request=await new ConnectionsService(c.db).request(a.token,{handle});await c.db.query('UPDATE connection_requests SET status=$2 WHERE public_key=$1',[request.publicKey,kind==='declined'?'declined':'expired']);expect((await api(a.token,'profiles/connection/'+request.publicKey)).status).toBe(404);}
  const response=await api(token,path);expect(response.status).toBe(404);expect(await response.json()).toEqual({error:{code:'NOT_FOUND',message:'Запрошенные данные недоступны.'}});
 });
 it.each(['outsider','block','suspended','deleted','closed-match'])('rejects %s in request/match contexts',async(kind)=>{
  const a=await socialActor(c.db,'Viewer','OPEN');const b=await socialActor(c.db,'Peer','OPEN');const outsider=await socialActor(c.db,'Other','OPEN');const handle=await context(a,b);const network=new ConnectionsService(c.db);const request=await network.request(a.token,{handle});const accepted=await network.respond(b.token,request.publicKey,{action:'accept'});
  let token=a.token;
  if(kind==='outsider')token=outsider.token;
  if(kind==='block')await c.db.query('INSERT INTO social_blocks SELECT s.profile_id,t.profile_id FROM seeking_posts s,seeking_posts t WHERE s.public_key=$1 AND t.public_key=$2',[a.post.publicKey,b.post.publicKey]);
  if(kind==='suspended')await c.db.query("UPDATE social_profiles SET moderation_status='suspended' WHERE id=(SELECT profile_id FROM seeking_posts WHERE public_key=$1)",[b.post.publicKey]);
  if(kind==='deleted')expect((await api(b.token,'profile','DELETE',{confirmation:'DELETE'})).status).toBe(200);
  if(kind==='closed-match')await c.db.query("UPDATE social_matches SET status='closed' WHERE public_key=$1",[accepted.matchKey]);
  for(const path of ['profiles/connection/'+request.publicKey,'profiles/match/'+accepted.matchKey])expect((await api(token,path)).status).toBe(404);
 });
 it.each(['source-closed','source-owner','pass','suspended','target-closed'])('rechecks %s state after the profile lock boundary',async(kind)=>{
  const a=await socialActor(c.db,'Viewer','OPEN');const b=await socialActor(c.db,'Peer','OPEN');const handle=await context(a,b);let changed=false;
  const observed:Database={query:(sql,values)=>c.db.query(sql,values),close:async()=>{},transaction:work=>c.db.transaction(tx=>work({query:async(sql,values)=>{
   if(!changed&&sql.includes('pg_advisory_xact_lock')){changed=true;
    if(kind==='source-closed'||kind==='target-closed')await tx.query("UPDATE seeking_posts SET status='closed' WHERE public_key=$1",[kind==='source-closed'?a.post.publicKey:b.post.publicKey]);
    if(kind==='source-owner')await tx.query('UPDATE seeking_posts SET profile_id=(SELECT profile_id FROM seeking_posts WHERE public_key=$2),active_slot=2 WHERE public_key=$1',[a.post.publicKey,b.post.publicKey]);
    if(kind==='pass')await tx.query('INSERT INTO discovery_passes SELECT s.profile_id,t.profile_id FROM seeking_posts s,seeking_posts t WHERE s.public_key=$1 AND t.public_key=$2',[a.post.publicKey,b.post.publicKey]);
    if(kind==='suspended')await tx.query("UPDATE social_profiles SET moderation_status='suspended' WHERE id=(SELECT profile_id FROM seeking_posts WHERE public_key=$1)",[b.post.publicKey]);
   }
   return tx.query(sql,values);
  }}))};
  await expect(new ProfileSpaceService(observed).context(a.token,'discovery',handle)).rejects.toMatchObject({code:'NOT_FOUND'});expect(changed).toBe(true);
 });
 it('keeps space RLS enabled without client policies and validates nested SQL bounds',async()=>{
  const a=await socialActor(c.db,'Owner','OPEN');const settings=await configured(a.token);const profile=(await c.db.query<{profile_id:string}>('SELECT profile_id FROM social_profile_spaces')).rows[0]!.profile_id;
  for(const patch of [{status:'x'.repeat(61)},{tagline:'x'.repeat(121)},{interests:['repeat','repeat']},{goals:['a','b','c','d']},{selectedActivities:['../../bad']},{blockOrder:['intent','intent','interests','goals']},{enabledBlocks:['arbitrary']},{intentPostKey:'invalid'},{visibility:{...settings.visibility,status:'public'}},{avatar:'https://example.test/a.svg'}, {world:null}, {visibility:null}, {interests:[null]}])await expect(c.db.query('UPDATE social_profile_spaces SET customization=$2::jsonb WHERE profile_id=$1',[profile,JSON.stringify({...settings,...patch})])).rejects.toMatchObject({code:'23514'});
  expect((await c.db.query<{relrowsecurity:boolean}>("SELECT relrowsecurity FROM pg_class WHERE relname='social_profile_spaces'")).rows[0]!.relrowsecurity).toBe(true);expect((await c.db.query("SELECT 1 FROM pg_policies WHERE tablename='social_profile_spaces'")).rows).toEqual([]);
 });
 it('recovers customization, erases it on deletion, and enforces database tombstone/JSON guards',async()=>{
  const a=await socialActor(c.db,'Owner','OPEN');const settings=await configured(a.token);const fresh=await createGuestSession(c.db);await new IdentityService(c.db).recover(fresh.token,{key:a.key});expect((await get(fresh.token)).customization).toEqual(settings);expect((await api(a.token,'profile/space')).status).toBe(404);
  const profile=(await c.db.query<{profile_id:string}>('SELECT profile_id FROM social_profile_spaces')).rows[0]!.profile_id;
  for(const malformed of [{...settings,world:'arbitrary'},{...settings,visibility:{status:'everyone'}},{...settings,interests:Array(9).fill('x')},{...settings,css:'bad'}])await expect(c.db.query('UPDATE social_profile_spaces SET customization=$2::jsonb WHERE profile_id=$1',[profile,JSON.stringify(malformed)])).rejects.toMatchObject({code:'23514'});
  expect((await api(fresh.token,'profile','DELETE',{confirmation:'DELETE'})).status).toBe(200);expect((await c.db.query('SELECT 1 FROM social_profile_spaces')).rows).toEqual([]);await expect(c.db.query('INSERT INTO social_profile_spaces(profile_id,customization) VALUES($1,$2)',[profile,JSON.stringify(settings)])).rejects.toMatchObject({code:'23514'});
 });
 it('reauthorizes a stale session after waiting for sorted profile locks',async()=>{
  const a=await socialActor(c.db,'Owner','OPEN');const b=await socialActor(c.db,'Peer','OPEN');const handle=await context(a,b);const ids=(await c.db.query<{id:string}>('SELECT id FROM social_profiles')).rows.map(r=>r.id);
  let release!:()=>void,ready!:()=>void;const held=new Promise<void>(r=>{release=r;}),locked=new Promise<void>(r=>{ready=r;});
  const holder=c.db.transaction(async tx=>{await lockProfiles(tx,ids);ready();await held;await tx.query('DELETE FROM social_profile_bindings WHERE profile_id=(SELECT profile_id FROM seeking_posts WHERE public_key=$1)',[a.post.publicKey]);});await locked;
  const pending=api(a.token,'profiles/discovery/'+handle);try{const deadline=Date.now()+4000;while(Number((await c.db.query<{count:string}>("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%veya-social-profile:%'")).rows[0]!.count)<1){if(Date.now()>deadline)throw new Error('Expected lock wait');await new Promise(r=>setTimeout(r,10));}}finally{release();}await holder;expect((await pending).status).toBe(404);
 });
});
