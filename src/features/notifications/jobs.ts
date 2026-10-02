import 'server-only';
import type { Database, DatabaseExecutor } from '@/lib/db/types';
import { lockProfiles } from '@/features/social/context';
import { opaqueKey } from '@/features/social/pairs';
import { enqueueNotification, visibleNotificationSql } from './service';
import { subscriptionSchema, type PushConfig } from './schema';
import { genericPushPayload, PushDeliveryError, sendBrowserPush, type PushSender } from './push';
type Job={id:string;notification_id:string;subscription_id:string;attempts:number;lease_key:string};
type Delivery={guest_id:string;profile_id:string;peer_profile_id:string|null;endpoint:string;p256dh:string;auth:string};
export type NotificationJobOptions={limit?:number;push?:PushConfig;sender?:PushSender;reminders?:boolean;signal?:AbortSignal};
async function enqueueReminders(db:Database,limit:number,signal?:AbortSignal):Promise<number>{
  const candidates=await db.query<{id:string;low_profile_id:string;high_profile_id:string}>(`SELECT m.id,p.low_profile_id,p.high_profile_id FROM social_matches m JOIN social_pairs p ON p.id=m.pair_id JOIN intents i ON i.id=m.plan_intent_id JOIN plan_suggestions s ON s.id=i.selected_suggestion_id AND s.intent_id=i.id
    WHERE m.status='active' AND i.status='decided' AND s.start_at>clock_timestamp() AND s.start_at<=clock_timestamp()+interval '24 hours'
    AND EXISTS(SELECT 1 FROM social_profiles WHERE id=p.low_profile_id AND moderation_status='active') AND EXISTS(SELECT 1 FROM social_profiles WHERE id=p.high_profile_id AND moderation_status='active')
    AND NOT EXISTS(SELECT 1 FROM social_blocks WHERE (blocker_profile_id=p.low_profile_id AND blocked_profile_id=p.high_profile_id) OR (blocker_profile_id=p.high_profile_id AND blocked_profile_id=p.low_profile_id))
    AND NOT EXISTS(SELECT 1 FROM social_notifications n WHERE n.match_id=m.id AND n.recipient_profile_id=p.low_profile_id AND n.dedupe_key='meetup:'||m.public_key||':'||s.start_at::text)
    ORDER BY s.start_at,m.id LIMIT $1`,[limit]);
  let reminders=0;
  for(const candidate of candidates.rows){
    if(signal?.aborted)break;
    reminders+=await db.transaction(async tx=>{
      await lockProfiles(tx,[candidate.low_profile_id,candidate.high_profile_id]);
      const match=await tx.query<{public_key:string;start_key:string}>(`SELECT m.public_key,s.start_at::text start_key FROM social_matches m JOIN intents i ON i.id=m.plan_intent_id JOIN plan_suggestions s ON s.id=i.selected_suggestion_id AND s.intent_id=i.id
        WHERE m.id=$1 AND m.status='active' AND i.status='decided' AND s.start_at>clock_timestamp() AND s.start_at<=clock_timestamp()+interval '24 hours'`,[candidate.id]);
      if(!match.rows[0])return 0;
      for(const [recipient,peer] of [[candidate.low_profile_id,candidate.high_profile_id],[candidate.high_profile_id,candidate.low_profile_id]])await enqueueNotification(tx,{recipientProfileId:recipient!,peerProfileId:peer!,type:'MEETUP_REMINDER',matchKey:match.rows[0].public_key,dedupeKey:`meetup:${match.rows[0].public_key}:${match.rows[0].start_key}`});
      return 2;
    });
  }
  return reminders;
}
async function claim(db:Database,limit:number):Promise<Job[]>{return db.transaction(async tx=>{
  // Final crashed attempts expire to a durable terminal state; retries never exceed five.
  await tx.query(`UPDATE social_notification_jobs SET status='failed',lease_key=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE id IN(SELECT id FROM social_notification_jobs WHERE status='processing' AND lease_until<=clock_timestamp() AND attempts>=5 ORDER BY lease_until,id LIMIT $1 FOR UPDATE SKIP LOCKED)`,[limit]);
  return(await tx.query<Job>(`WITH chosen AS(SELECT id FROM social_notification_jobs WHERE attempts<5 AND ((status='pending' AND available_at<=clock_timestamp()) OR (status='processing' AND lease_until<=clock_timestamp())) ORDER BY available_at,id LIMIT $1 FOR UPDATE SKIP LOCKED)
    UPDATE social_notification_jobs j SET status='processing',attempts=j.attempts+1,lease_key=$2,lease_until=clock_timestamp()+interval '1 minute' FROM chosen WHERE j.id=chosen.id RETURNING j.id,j.notification_id,j.subscription_id,j.attempts,j.lease_key`,[limit,opaqueKey()])).rows;
});}
async function finish(tx:DatabaseExecutor,job:Job,status:'delivered'|'cancelled'|'failed'|'pending'){
  await tx.query(`UPDATE social_notification_jobs SET status=$3,lease_key=NULL,lease_until=NULL,available_at=clock_timestamp()+($4::integer*interval '1 second'),finished_at=CASE WHEN $3='pending' THEN NULL ELSE clock_timestamp() END WHERE id=$1 AND lease_key=$2 AND status='processing'`,[job.id,job.lease_key,status,Math.min(3600,15*2**job.attempts)]);
}
export async function processNotificationJobs(db:Database,options:NotificationJobOptions={}):Promise<{reminders:number;claimed:number;delivered:number;cancelled:number;retried:number;failed:number}>{
  const limit=options.limit??20;if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Use a worker limit from 1 to 100.');
  const result={reminders:options.reminders===false||options.signal?.aborted?0:await enqueueReminders(db,limit,options.signal),claimed:0,delivered:0,cancelled:0,retried:0,failed:0};
  if(!options.push||options.signal?.aborted)return result;
  const jobs=await claim(db,limit);result.claimed=jobs.length;
  for(const job of jobs){
    if(options.signal?.aborted){
      await db.query(`UPDATE social_notification_jobs SET status='pending',attempts=attempts-1,lease_key=NULL,lease_until=NULL
        WHERE id=ANY($1::uuid[]) AND lease_key=$2 AND status='processing'`,[jobs.slice(jobs.indexOf(job)).map(remaining=>remaining.id),job.lease_key]);
      break;
    }
    const status=await db.transaction(async tx=>{
      const initial=await tx.query<Delivery>(`SELECT s.guest_id,s.profile_id,n.peer_profile_id,s.endpoint,s.p256dh,s.auth FROM social_push_subscriptions s JOIN social_notifications n ON n.id=$1 AND n.recipient_profile_id=s.profile_id WHERE s.id=$2`,[job.notification_id,job.subscription_id]);
      const first=initial.rows[0];if(!first){await finish(tx,job,'cancelled');return 'cancelled' as const;}
      // Guest -> sorted profiles -> job/subscription rows matches recovery and session revocation ordering.
      await tx.query('SELECT id FROM guest_participant_sessions WHERE id=$1 FOR SHARE',[first.guest_id]);
      await lockProfiles(tx,[first.profile_id,...(first.peer_profile_id?[first.peer_profile_id]:[])]);
      const lease=await tx.query<{valid:boolean}>("SELECT lease_until>clock_timestamp() AS valid FROM social_notification_jobs WHERE id=$1 AND lease_key=$2 AND status='processing' FOR UPDATE",[job.id,job.lease_key]);
      if(!lease.rows[0])return 'retried' as const;
      if(!lease.rows[0].valid){const terminal=job.attempts>=5;await finish(tx,job,terminal?'failed':'pending');return terminal?'failed' as const:'retried' as const;}
      const owned=await tx.query<Delivery>(`SELECT s.guest_id,s.profile_id,n.peer_profile_id,s.endpoint,s.p256dh,s.auth FROM social_push_subscriptions s JOIN social_notifications n ON n.id=$1 AND n.recipient_profile_id=s.profile_id
        JOIN social_profile_bindings b ON b.guest_id=s.guest_id AND b.profile_id=s.profile_id JOIN guest_participant_sessions g ON g.id=s.guest_id
        JOIN social_notification_jobs j ON j.notification_id=n.id AND j.subscription_id=s.id
        WHERE s.id=$2 AND j.id=$3 AND j.lease_key=$4 AND j.status='processing' AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND ${visibleNotificationSql} FOR UPDATE OF j,s`,[job.notification_id,job.subscription_id,job.id,job.lease_key]);
      const delivery=owned.rows[0];if(!delivery){await finish(tx,job,'cancelled');return 'cancelled' as const;}
      const subscription=subscriptionSchema.safeParse({endpoint:delivery.endpoint,keys:{p256dh:delivery.p256dh,auth:delivery.auth}});
      if(!subscription.success){await finish(tx,job,'cancelled');return 'cancelled' as const;}
      try{await(options.sender??sendBrowserPush)(subscription.data,genericPushPayload,options.push!);await finish(tx,job,'delivered');return 'delivered' as const;}
      catch(error){if(error instanceof PushDeliveryError&&(error.statusCode===404||error.statusCode===410)){await tx.query('DELETE FROM social_push_subscriptions WHERE id=$1',[job.subscription_id]);return 'cancelled' as const;}
        const next=job.attempts>=5?'failed':'pending';await finish(tx,job,next);return next==='pending'?'retried' as const:'failed' as const;}
    });
    result[status]++;
  }
  return result;
}
