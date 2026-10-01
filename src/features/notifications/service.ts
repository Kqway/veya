import 'server-only';
import { z } from 'zod';
import type { Database, DatabaseExecutor } from '@/lib/db/types';
import { validate } from '@/features/backend/validation';
import { requireSession } from '@/features/backend/sessions';
import { lockProfiles, reauthorize, requireProfile } from '@/features/social/context';
import { fail } from '@/features/social/errors';
import { opaqueKey } from '@/features/social/pairs';
import { publicKeySchema } from '@/features/social/seeking-schema';
import { publishSocialEvent } from '@/features/realtime/events';
import { notificationSchema, subscriptionSchema, type NotificationDTO, type NotificationType, type PushConfig } from './schema';

/** Shared SQL predicate: peer identities are never projected, including after blocks. */
export const visibleNotificationSql = `EXISTS(SELECT 1 FROM social_profiles own WHERE own.id=n.recipient_profile_id AND own.moderation_status='active')
 AND (n.peer_profile_id IS NULL OR (EXISTS(SELECT 1 FROM social_profiles peer WHERE peer.id=n.peer_profile_id AND peer.moderation_status='active')
 AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_profile_id=n.recipient_profile_id AND b.blocked_profile_id=n.peer_profile_id) OR (b.blocker_profile_id=n.peer_profile_id AND b.blocked_profile_id=n.recipient_profile_id))))
 AND (n.match_id IS NULL OR EXISTS(SELECT 1 FROM social_matches m WHERE m.id=n.match_id AND m.status='active'))`;
export type NotificationInput={recipientProfileId:string;peerProfileId?:string;type:NotificationType;requestKey?:string;matchKey?:string;dedupeKey:string};
export async function enqueueNotification(tx:DatabaseExecutor,input:NotificationInput):Promise<void> {
  const schema=z.object({recipientProfileId:z.uuid(),peerProfileId:z.uuid().optional(),type:z.enum(['INTEREST_RECEIVED','INTEREST_ACCEPTED','NEW_MESSAGE','PLAN_READY','MEETUP_REMINDER','CANDIDATE_FOUND']),requestKey:publicKeySchema.optional(),matchKey:publicKeySchema.optional(),dedupeKey:z.string().min(1).max(256)}).strict();
  const data=validate(schema,input);
  if(data.matchKey && data.requestKey) fail('INVALID_INPUT');
  const recipient=await tx.query<{id:string}>("SELECT id FROM social_profiles WHERE id=$1 AND moderation_status='active'",[data.recipientProfileId]);
  if(!recipient.rows.length) return;
  if(data.peerProfileId) {
    const peer=await tx.query(`SELECT id FROM social_profiles WHERE id=$1 AND moderation_status='active' AND NOT EXISTS(SELECT 1 FROM social_blocks WHERE (blocker_profile_id=$1 AND blocked_profile_id=$2) OR (blocker_profile_id=$2 AND blocked_profile_id=$1))`,[data.peerProfileId,data.recipientProfileId]);
    if(!peer.rows.length) return;
  }
  const context=await tx.query<{request_id:string|null;match_id:string|null}>(`SELECT (SELECT id FROM connection_requests WHERE public_key=$1) request_id,(SELECT id FROM social_matches WHERE public_key=$2 AND status='active') match_id`,[data.requestKey??null,data.matchKey??null]);
  const row=context.rows[0]!;
  if((data.requestKey && !row.request_id)||(data.matchKey && !row.match_id)) fail('NOT_FOUND');
  const inserted=await tx.query<{id:string}>(`INSERT INTO social_notifications(public_key,recipient_profile_id,peer_profile_id,type,request_id,match_id,dedupe_key)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(recipient_profile_id,dedupe_key) DO NOTHING RETURNING id`,[opaqueKey(),data.recipientProfileId,data.peerProfileId??null,data.type,row.request_id,row.match_id,data.dedupeKey]);
  if(!inserted.rows[0]) return;
  await tx.query(`INSERT INTO social_notification_jobs(notification_id,subscription_id)
    SELECT $1,s.id FROM social_push_subscriptions s JOIN guest_participant_sessions g ON g.id=s.guest_id JOIN social_profile_bindings b ON b.guest_id=s.guest_id AND b.profile_id=s.profile_id
    WHERE s.profile_id=$2 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() ON CONFLICT DO NOTHING`,[inserted.rows[0].id,data.recipientProfileId]);
  await publishSocialEvent(tx,[data.recipientProfileId],{topic:'notifications'});
}
const querySchema=z.object({before:publicKeySchema.optional(),limit:z.number().int().min(1).max(50).default(30)}).strict();
type NotificationRow={public_key:string;type:NotificationType;created_at:Date;read_at:Date|null;match_key:string|null};
function project(row:NotificationRow):NotificationDTO {
  const href=row.match_key?`/m/${row.match_key}`:row.type==='INTEREST_RECEIVED'||row.type==='INTEREST_ACCEPTED'?'/connections':row.type==='CANDIDATE_FOUND'?'/discover':'/notifications';
  return notificationSchema.parse({publicKey:row.public_key,type:row.type,createdAt:row.created_at.toISOString(),readAt:row.read_at?.toISOString()??null,href});
}
export class NotificationService {
  constructor(private readonly db:Database,private readonly options:{push?:PushConfig;origin?:string}={}){}
  private async own(tx:DatabaseExecutor,token:string){const profile=await requireProfile(tx,token);await lockProfiles(tx,[profile.id]);await reauthorize(tx,token,profile.id);return profile;}
  async list(token:string,query:{before?:string;limit?:number}={}):Promise<{notifications:NotificationDTO[];nextBefore:string|null}>{
    const data=validate(querySchema,query);
    return this.db.transaction(async tx=>{
      const own=await this.own(tx,token);
      if(data.before){const cursor=await tx.query(`SELECT 1 FROM social_notifications n WHERE n.recipient_profile_id=$1 AND n.public_key=$2 AND ${visibleNotificationSql}`,[own.id,data.before]);if(!cursor.rows.length)fail('NOT_FOUND');}
      const rows=await tx.query<NotificationRow>(`SELECT n.public_key,n.type,n.created_at,n.read_at,m.public_key match_key FROM social_notifications n LEFT JOIN social_matches m ON m.id=n.match_id
        WHERE n.recipient_profile_id=$1 AND ${visibleNotificationSql} ${data.before?'AND (n.created_at,n.id)<(SELECT created_at,id FROM social_notifications WHERE recipient_profile_id=$1 AND public_key=$3)':''}
        ORDER BY n.created_at DESC,n.id DESC LIMIT $2`,data.before?[own.id,data.limit+1,data.before]:[own.id,data.limit+1]);
      const page=rows.rows.slice(0,data.limit);return {notifications:page.map(project),nextBefore:rows.rows.length>data.limit?page[page.length-1]!.public_key:null};
    });
  }
  async unread(token:string):Promise<{unreadCount:number;capped:boolean}>{return this.db.transaction(async tx=>{const own=await this.own(tx,token);const count=await tx.query<{count:string}>(`SELECT count(*) FROM(SELECT 1 FROM social_notifications n WHERE n.recipient_profile_id=$1 AND n.read_at IS NULL AND ${visibleNotificationSql} LIMIT 1001) bounded`,[own.id]);const amount=Number(count.rows[0]!.count);return {unreadCount:Math.min(1000,amount),capped:amount>1000};});}
  async read(token:string,key:string):Promise<{read:true}>{validate(publicKeySchema,key);return this.db.transaction(async tx=>{const own=await this.own(tx,token);const result=await tx.query(`UPDATE social_notifications n SET read_at=COALESCE(read_at,clock_timestamp()) WHERE recipient_profile_id=$1 AND public_key=$2 AND ${visibleNotificationSql} RETURNING id`,[own.id,key]);if(!result.rows.length)fail('NOT_FOUND');await publishSocialEvent(tx,[own.id],{topic:'notifications'});return {read:true};});}
  async capability(token:string):Promise<{enabled:boolean;publicKey:string|null}>{await this.db.transaction(tx=>this.own(tx,token));const enabled=Boolean(this.options.push&&this.options.origin&&new URL(this.options.origin).protocol==='https:');return {enabled,publicKey:enabled?this.options.push!.publicKey:null};}
  async subscribe(token:string,input:unknown):Promise<{subscribed:true}>{
    const data=validate(subscriptionSchema,input);const capability=await this.capability(token);if(!capability.enabled)fail('CONFLICT');
    return this.db.transaction(async tx=>{const own=await this.own(tx,token),guestId=await requireSession(tx,token);
      const previous=await tx.query<{id:string;profile_id:string;guest_id:string}>('SELECT id,profile_id,guest_id FROM social_push_subscriptions WHERE endpoint=$1',[data.endpoint]);
      if(previous.rows[0]&&(previous.rows[0].profile_id!==own.id||previous.rows[0].guest_id!==guestId))fail('CONFLICT');
      if(!previous.rows.length){const count=await tx.query<{count:string}>('SELECT count(*) FROM social_push_subscriptions WHERE profile_id=$1',[own.id]);if(Number(count.rows[0]!.count)>=5)fail('CONFLICT');}
      const inserted=await tx.query(`INSERT INTO social_push_subscriptions(guest_id,profile_id,endpoint,p256dh,auth) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth WHERE social_push_subscriptions.profile_id=EXCLUDED.profile_id AND social_push_subscriptions.guest_id=EXCLUDED.guest_id RETURNING id`,[guestId,own.id,data.endpoint,data.keys.p256dh,data.keys.auth]);
      if(!inserted.rows.length)fail('CONFLICT');return {subscribed:true};
    });
  }
  async unsubscribe(token:string,input:unknown):Promise<{subscribed:false}>{const data=validate(z.object({endpoint:subscriptionSchema.shape.endpoint}).strict(),input);return this.db.transaction(async tx=>{const own=await this.own(tx,token);const guestId=await requireSession(tx,token);await tx.query('DELETE FROM social_push_subscriptions WHERE profile_id=$1 AND guest_id=$2 AND endpoint=$3',[own.id,guestId,data.endpoint]);return {subscribed:false};});}
}
