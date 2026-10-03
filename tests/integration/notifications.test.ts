import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { createHash } from 'node:crypto';
import { startTestDatabase } from '../support/postgres';
import { socialActor } from '../support/social';
import { applyMigrations } from '@/lib/db/migrations';
import { requireProfile,lockProfiles } from '@/features/social/context';
import { ensurePair,opaqueKey } from '@/features/social/pairs';
import { enqueueNotification,NotificationService } from '@/features/notifications/service';
import { processNotificationJobs } from '@/features/notifications/jobs';
import { PushDeliveryError,genericPushPayload } from '@/features/notifications/push';
import { IdentityService } from '@/features/social/identity';
import { createGuestSession } from '@/features/backend/sessions';
const config={publicKey:'a'.repeat(87),privateKey:'b'.repeat(43),subject:'mailto:push@example.test'};
const subscription=(n=0)=>({endpoint:`https://fcm.googleapis.com/veya/${n}`,keys:{p256dh:'c'.repeat(87),auth:'d'.repeat(22)}});
describe('recipient notifications and durable generic browser push',()=>{
 let c:Awaited<ReturnType<typeof startTestDatabase>>,service:NotificationService;
 beforeAll(async()=>{c=await startTestDatabase();await applyMigrations(c.db);service=new NotificationService(c.db,{push:config,origin:'https://veya.test'});});
 afterAll(async()=>{if(c)await c.stop();});beforeEach(async()=>{await c.db.query('TRUNCATE social_profiles CASCADE');});
 async function actors(){const a=await socialActor(c.db,'Private-A'),b=await socialActor(c.db,'Private-B'),x=await socialActor(c.db,'Private-X');const own=await c.db.transaction(tx=>requireProfile(tx,a.token)),peer=await c.db.transaction(tx=>requireProfile(tx,b.token));return {a,b,x,own,peer};}
 async function notify(own:string,peer:string,dedupe=opaqueKey()){await c.db.transaction(tx=>enqueueNotification(tx,{recipientProfileId:own,peerProfileId:peer,type:'NEW_MESSAGE',dedupeKey:dedupe}));}
 it('deduplicates transactionally, projects exact safe fields and owns cursors/read/unread',async()=>{
  const {a,b,x,own,peer}=await actors();await Promise.all([notify(own.id,peer.id,'same'),notify(own.id,peer.id,'same')]);
  const mine=await service.list(a.token);expect(mine.notifications).toHaveLength(1);expect(Object.keys(mine.notifications[0]!).sort()).toEqual(['createdAt','href','publicKey','readAt','type']);expect(JSON.stringify(mine)).not.toMatch(/Private-|[0-9a-f]{8}-[0-9a-f]{4}/);expect(await service.unread(a.token)).toEqual({unreadCount:1,capped:false});
  const key=mine.notifications[0]!.publicKey;expect(await service.list(b.token)).toEqual({notifications:[],nextBefore:null});
  await expect(service.read(x.token,key)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(service.list(b.token,{before:key})).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(await service.read(a.token,key)).toEqual({read:true});expect(await service.read(a.token,key)).toEqual({read:true});expect(await service.unread(a.token)).toEqual({unreadCount:0,capped:false});
  for(const limit of [0,51,1.5])await expect(service.list(a.token,{limit})).rejects.toMatchObject({code:'INVALID_INPUT'});
 });
 it('rolls back notification, push job and realtime event together',async()=>{
  const {a,own,peer}=await actors();await service.subscribe(a.token,subscription());await expect(c.db.transaction(async tx=>{await enqueueNotification(tx,{recipientProfileId:own.id,peerProfileId:peer.id,type:'NEW_MESSAGE',dedupeKey:'rollback'});throw new Error('rollback');})).rejects.toThrow('rollback');
  expect((await c.db.query('SELECT * FROM social_notifications')).rows).toEqual([]);expect((await c.db.query('SELECT * FROM social_notification_jobs')).rows).toEqual([]);expect((await c.db.query("SELECT * FROM social_events WHERE topic='notifications'")).rows).toEqual([]);
 });
 it('bounds pages, scopes microsecond cursors and caps unread personal count',async()=>{
  const {a,own,peer}=await actors();
  await c.db.query(`INSERT INTO social_notifications(public_key,recipient_profile_id,peer_profile_id,type,dedupe_key,created_at) SELECT translate(left(encode(decode(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),'hex'),'base64'),24),'+/','-_'),$1,$2,'NEW_MESSAGE','batch:'||n,'2026-01-01T00:00:00Z'::timestamptz+n*interval '1 microsecond' FROM generate_series(1,1002)n`,[own.id,peer.id]);
  const recent=await service.list(a.token);expect(recent.notifications).toHaveLength(30);const next=await service.list(a.token,{before:recent.nextBefore!,limit:1});expect(next.notifications[0]!.publicKey).not.toBe(recent.notifications[29]!.publicKey);expect(await service.unread(a.token)).toEqual({unreadCount:1000,capped:true});
 });
 it('filters blocked/suspended peers and cancels queued delivery',async()=>{
  const {a,own,peer}=await actors();await service.subscribe(a.token,subscription());await notify(own.id,peer.id);const key=(await service.list(a.token)).notifications[0]!.publicKey;
  await c.db.query('INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) VALUES($1,$2)',[peer.id,own.id]);
  expect((await service.list(a.token)).notifications).toEqual([]);expect((await service.unread(a.token)).unreadCount).toBe(0);await expect(service.read(a.token,key)).rejects.toMatchObject({code:'NOT_FOUND'});
  const sender=vi.fn(async()=>{});const outcome=await processNotificationJobs(c.db,{push:config,sender,reminders:false});expect(outcome.cancelled).toBe(1);expect(sender).not.toHaveBeenCalled();
  await c.db.query('DELETE FROM social_blocks');await c.db.query("UPDATE social_profiles SET moderation_status='suspended' WHERE id=$1",[peer.id]);expect((await service.list(a.token)).notifications).toEqual([]);
 });
 it('rejects endpoint substitution and ownership spoofing, caps subscriptions at five',async()=>{
  const {a,b}=await actors();for(const endpoint of ['https://localhost/secret','https://127.0.0.1/secret','https://fcm.googleapis.com:8443/token','https://fcm.googleapis.com.attacker.test/x'])await expect(service.subscribe(a.token,{...subscription(),endpoint})).rejects.toMatchObject({code:'INVALID_INPUT'});
  await expect(service.subscribe(a.token,{...subscription(),profileId:'forged'})).rejects.toMatchObject({code:'INVALID_INPUT'});
  await service.subscribe(a.token,subscription());await expect(service.subscribe(b.token,subscription())).rejects.toMatchObject({code:'CONFLICT'});
  await service.unsubscribe(b.token,{endpoint:subscription().endpoint});expect((await c.db.query('SELECT * FROM social_push_subscriptions')).rows).toHaveLength(1);
  await Promise.all([1,2,3,4].map(n=>service.subscribe(a.token,subscription(n))));await expect(service.subscribe(a.token,subscription(5))).rejects.toMatchObject({code:'CONFLICT'});
  await service.unsubscribe(a.token,{endpoint:subscription().endpoint});expect((await c.db.query('SELECT * FROM social_push_subscriptions')).rows).toHaveLength(4);
 });
 it('claims concurrent workers once and sends only fixed generic content',async()=>{
  const {a,own,peer}=await actors();await service.subscribe(a.token,subscription());await notify(own.id,peer.id);
  const sender=vi.fn(async(subscription:unknown,payload:string)=>{expect(subscription).toBeTruthy();expect(payload).toBe(genericPushPayload);});const outcomes=await Promise.all([processNotificationJobs(c.db,{push:config,sender,reminders:false}),processNotificationJobs(c.db,{push:config,sender,reminders:false})]);expect(outcomes.reduce((n,r)=>n+r.delivered,0)).toBe(1);expect(sender).toHaveBeenCalledTimes(1);expect(sender.mock.calls[0]![1]).toBe(genericPushPayload);expect(genericPushPayload).toBe(JSON.stringify({title:'Intavro',body:'У вас новое уведомление в Intavro',url:'/notifications'}));
  expect((await c.db.query('SELECT status,attempts FROM social_notification_jobs')).rows).toEqual([{status:'delivered',attempts:1}]);
 });
 it('stops on interruption and releases unsent leases including final claims without losing retry budget',async()=>{
  const {a,own,peer}=await actors();await service.subscribe(a.token,subscription());await service.subscribe(a.token,subscription(1));await notify(own.id,peer.id);
  const stopped=new AbortController();stopped.abort();
  expect((await processNotificationJobs(c.db,{signal:stopped.signal,push:config,reminders:false})).claimed).toBe(0);
  await c.db.query('UPDATE social_notification_jobs SET attempts=4');
  const controller=new AbortController();const sender=vi.fn(async()=>{controller.abort();});
  const result=await processNotificationJobs(c.db,{signal:controller.signal,push:config,sender,reminders:false});
  expect(result).toMatchObject({claimed:2,delivered:1,failed:0});expect(sender).toHaveBeenCalledTimes(1);
  expect((await c.db.query("SELECT status,attempts FROM social_notification_jobs WHERE status<>'delivered'")).rows).toEqual([{status:'pending',attempts:4}]);
  expect((await processNotificationJobs(c.db,{push:config,sender:async()=>{},reminders:false})).delivered).toBe(1);
 });
 it('keeps a valid queued notification retryable when its batch lease expires before delivery',async()=>{
  const {a,own,peer}=await actors();await service.subscribe(a.token,subscription());await service.subscribe(a.token,subscription(1));await notify(own.id,peer.id);
  let calls=0;const sender=async(current:{endpoint:string})=>{calls++;if(calls===1)await c.db.query("UPDATE social_notification_jobs j SET lease_until=clock_timestamp()-interval '1 second' FROM social_push_subscriptions s WHERE j.subscription_id=s.id AND s.endpoint<>$1 AND j.status='processing'",[current.endpoint]);};
  const result=await processNotificationJobs(c.db,{push:config,sender,reminders:false});
  expect(result.cancelled).toBe(0);expect(result.retried).toBe(1);expect(result.delivered).toBe(1);
  await c.db.query("UPDATE social_notification_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE status='pending'");
  expect((await processNotificationJobs(c.db,{push:config,sender,reminders:false})).delivered).toBe(1);expect(calls).toBe(2);
 });
 it('terminalizes an unsent expired final lease instead of leaving an unclaimable pending job',async()=>{
  const {a,own,peer}=await actors();await service.subscribe(a.token,subscription());await service.subscribe(a.token,subscription(1));await notify(own.id,peer.id);
  await c.db.query('UPDATE social_notification_jobs SET attempts=4');let calls=0;
  const sender=async(current:{endpoint:string})=>{calls++;if(calls===1)await c.db.query("UPDATE social_notification_jobs j SET lease_until=clock_timestamp()-interval '1 second' FROM social_push_subscriptions s WHERE j.subscription_id=s.id AND s.endpoint<>$1 AND j.status='processing'",[current.endpoint]);};
  const result=await processNotificationJobs(c.db,{push:config,sender,reminders:false});expect(result.failed).toBe(1);
  expect((await c.db.query("SELECT * FROM social_notification_jobs WHERE status='pending' AND attempts>=5")).rows).toEqual([]);
 });
 it('persists failures and reconnect lease recovery, stops retries after five attempts',async()=>{
  const {a,own,peer}=await actors();await service.subscribe(a.token,subscription());await notify(own.id,peer.id);const sender=vi.fn(async()=>{throw new PushDeliveryError(503);});
  for(let attempt=1;attempt<=5;attempt++){await c.db.query("UPDATE social_notification_jobs SET available_at=clock_timestamp()-interval '1 minute'");const result=await processNotificationJobs(c.db,{push:config,sender,reminders:false});expect(result[attempt<5?'retried':'failed']).toBe(1);}
  expect((await c.db.query('SELECT status,attempts FROM social_notification_jobs')).rows).toEqual([{status:'failed',attempts:5}]);await processNotificationJobs(c.db,{push:config,sender,reminders:false});expect(sender).toHaveBeenCalledTimes(5);
  await notify(own.id,peer.id);await c.db.query("UPDATE social_notification_jobs SET status='processing',attempts=1,lease_key=$1,lease_until=clock_timestamp()-interval '1 minute' WHERE status='pending'",[opaqueKey()]);const recovery=await processNotificationJobs(c.db,{push:config,sender:async()=>{},reminders:false});expect(recovery.delivered).toBe(1);
 });
 it('revocation and expiry cancel deliveries, recovery bindings remove subscriptions/jobs',async()=>{
  for(const expire of [false,true]){const {a,own,peer}=await actors();await service.subscribe(a.token,subscription(expire?1:0));await notify(own.id,peer.id);await c.db.query(`UPDATE guest_participant_sessions SET ${expire?"created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second'":'revoked_at=clock_timestamp()'} WHERE token_hash=$1`,[createHash('sha256').update(a.token).digest('hex')]);const sender=vi.fn(async()=>{});expect((await processNotificationJobs(c.db,{push:config,sender,reminders:false})).cancelled).toBe(1);expect(sender).not.toHaveBeenCalled();}
  const {a,own,peer}=await actors();await service.subscribe(a.token,subscription(2));await notify(own.id,peer.id);const fresh=await createGuestSession(c.db);await new IdentityService(c.db).recover(fresh.token,{key:a.key});expect((await c.db.query('SELECT * FROM social_push_subscriptions WHERE profile_id=$1',[own.id])).rows).toEqual([]);expect((await c.db.query('SELECT j.* FROM social_notification_jobs j JOIN social_notifications n ON n.id=j.notification_id WHERE n.recipient_profile_id=$1',[own.id])).rows).toEqual([]);await expect(service.list(a.token)).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it('reauthorizes removed profile binding after inbox waits on profile locks',async()=>{
  const {a,own,peer}=await actors();await notify(own.id,peer.id);let release!:()=>void,locked!:()=>void;const ready=new Promise<void>(r=>locked=r),hold=new Promise<void>(r=>release=r);const blocker=c.db.transaction(async tx=>{await lockProfiles(tx,[own.id]);locked();await hold;await tx.query('DELETE FROM social_profile_bindings WHERE profile_id=$1',[own.id]);});await ready;const result=expect(service.list(a.token)).rejects.toMatchObject({code:'NOT_FOUND'});await new Promise(r=>setTimeout(r,30));release();await blocker;await result;
 });
 it('removes expired provider subscriptions without retrying and leaves optional push jobs durable',async()=>{
  const {a,own,peer}=await actors();await service.subscribe(a.token,subscription());await notify(own.id,peer.id);
  expect((await processNotificationJobs(c.db,{reminders:false})).claimed).toBe(0);expect((await c.db.query('SELECT status,attempts FROM social_notification_jobs')).rows).toEqual([{status:'pending',attempts:0}]);
  const sender=vi.fn(async()=>{throw new PushDeliveryError(410);});expect((await processNotificationJobs(c.db,{push:config,sender,reminders:false})).cancelled).toBe(1);expect((await c.db.query('SELECT * FROM social_push_subscriptions')).rows).toEqual([]);expect((await c.db.query('SELECT * FROM social_notification_jobs')).rows).toEqual([]);expect((await service.list(a.token)).notifications).toHaveLength(1);
 });
 it('rechecks a committed block while claimed delivery waits for pair locks',async()=>{
  const {a,own,peer}=await actors();await service.subscribe(a.token,subscription());await notify(own.id,peer.id);
  let release!:()=>void,locked!:()=>void;const ready=new Promise<void>(r=>locked=r),hold=new Promise<void>(r=>release=r);
  const blocker=c.db.transaction(async tx=>{await lockProfiles(tx,[own.id,peer.id]);locked();await hold;await tx.query('INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) VALUES($1,$2)',[peer.id,own.id]);});await ready;
  const sender=vi.fn(async()=>{}),pending=processNotificationJobs(c.db,{push:config,sender,reminders:false});await new Promise(r=>setTimeout(r,30));release();await blocker;expect((await pending).cancelled).toBe(1);expect(sender).not.toHaveBeenCalled();
 });
 it('enqueues one generic reminder per confirmed match/start/recipient, excludes draft/blocked/closed/far plans',async()=>{
  const {a,b,own,peer}=await actors();const pair=await c.db.transaction(tx=>ensurePair(tx,own,peer,own.privacy_mode,peer.privacy_mode));
  const request=await c.db.query<{id:string}>("INSERT INTO connection_requests(public_key,pair_id,sender_profile_id,recipient_profile_id,pending_slot,status,activity_label) VALUES($1,$2,$3,$4,1,'accepted','Chess') RETURNING id",[opaqueKey(),pair.id,own.id,peer.id]);const matchKey=opaqueKey();
  const intent=await c.db.query<{id:string}>("INSERT INTO intents(public_slug,creator_guest_id,creator_display_name,raw_text,title,expires_at) VALUES($1,(SELECT guest_id FROM social_profile_bindings WHERE profile_id=$2 LIMIT 1),'Private','Chess','Chess',clock_timestamp()+interval '7 days') RETURNING id",[opaqueKey(),own.id]);
  const match=await c.db.query<{id:string}>('INSERT INTO social_matches(public_key,pair_id,request_id,activity_label,plan_intent_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[matchKey,pair.id,request.rows[0]!.id,'Chess',intent.rows[0]!.id]);
  const suggestion=await c.db.query<{id:string}>("INSERT INTO plan_suggestions(intent_id,title,start_at,end_at,score,available_count) VALUES($1,'Private meetup',clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour',500,2) RETURNING id",[intent.rows[0]!.id]);await c.db.query('UPDATE intents SET selected_suggestion_id=$2 WHERE id=$1',[intent.rows[0]!.id,suggestion.rows[0]!.id]);
  expect((await processNotificationJobs(c.db)).reminders).toBe(0);await c.db.query("UPDATE intents SET status='decided' WHERE id=$1",[intent.rows[0]!.id]);expect((await processNotificationJobs(c.db)).reminders).toBe(0);
  await c.db.query("UPDATE plan_suggestions SET start_at=clock_timestamp()+interval '1 hour',end_at=clock_timestamp()+interval '2 hours' WHERE id=$1",[suggestion.rows[0]!.id]);
  const outcomes=await Promise.all([processNotificationJobs(c.db),processNotificationJobs(c.db)]);expect(outcomes.some(r=>r.reminders===2)).toBe(true);expect((await c.db.query("SELECT * FROM social_notifications WHERE type='MEETUP_REMINDER'")).rows).toHaveLength(2);
  for(const token of [a.token,b.token]){const inbox=(await service.list(token)).notifications;expect(inbox).toHaveLength(1);expect(inbox[0]).toMatchObject({type:'MEETUP_REMINDER',href:`/m/${matchKey}`});expect(JSON.stringify(inbox)).not.toMatch(/Private|meetup:|start_at|end_at/);}
  await c.db.query("UPDATE plan_suggestions SET start_at=clock_timestamp()+interval '3 hours',end_at=clock_timestamp()+interval '4 hours' WHERE id=$1",[suggestion.rows[0]!.id]);await c.db.query('INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) VALUES($1,$2)',[peer.id,own.id]);expect((await processNotificationJobs(c.db)).reminders).toBe(0);
  await c.db.query('DELETE FROM social_blocks');await c.db.query("UPDATE social_matches SET status='closed' WHERE id=$1",[match.rows[0]!.id]);expect((await processNotificationJobs(c.db)).reminders).toBe(0);
 });
 it('uses PostgreSQL pair membership, endpoint constraints and server-only RLS',async()=>{
  const {a,b,x,own,peer}=await actors();const outsider=await c.db.transaction(tx=>requireProfile(tx,x.token));
  const pair=await c.db.transaction(async tx=>ensurePair(tx,own,peer,own.privacy_mode,peer.privacy_mode));const request=await c.db.query<{id:string}>("INSERT INTO connection_requests(public_key,pair_id,sender_profile_id,recipient_profile_id,pending_slot,activity_label) VALUES($1,$2,$3,$4,1,'Chess') RETURNING id",[opaqueKey(),pair.id,own.id,peer.id]);
  await expect(c.db.query("INSERT INTO social_notifications(public_key,recipient_profile_id,peer_profile_id,type,request_id,dedupe_key) VALUES($1,$2,$3,'INTEREST_RECEIVED',$4,'foreign')",[opaqueKey(),outsider.id,peer.id,request.rows[0]!.id])).rejects.toMatchObject({code:'23514'});
  await service.subscribe(a.token,subscription());await service.subscribe(b.token,subscription(1));const rls=await c.db.query<{relrowsecurity:boolean}>("SELECT relrowsecurity FROM pg_class WHERE relname IN('social_notifications','social_push_subscriptions','social_notification_jobs')");expect(rls.rows).toHaveLength(3);expect(rls.rows.every(r=>r.relrowsecurity)).toBe(true);expect((await c.db.query("SELECT * FROM pg_policies WHERE tablename IN('social_notifications','social_push_subscriptions','social_notification_jobs')")).rows).toEqual([]);
 });
});
