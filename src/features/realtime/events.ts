import 'server-only';
import { randomBytes } from 'node:crypto';
import type { DatabaseExecutor } from '@/lib/db/types';
import type { SocialInvalidation, SocialTopic } from './types';
import { socialTopics } from './types';
export type { SocialTopic, SocialInvalidation } from './types';
export type SocialEvent = SocialInvalidation & { publicKey: string };
export async function publishSocialEvent(tx: DatabaseExecutor, profileIds: readonly string[], event: SocialInvalidation): Promise<void> {
 if (!socialTopics.includes(event.topic) || (event.matchKey !== undefined && !/^[A-Za-z0-9_-]{24}$/.test(event.matchKey))) throw new Error('Invalid social event');
 const ids = [...new Set(profileIds)].sort();
 if (ids.length > 100) throw new Error('Too many event recipients');
 // Serialize each recipient until commit: identity allocation must follow commit order
 // so a transaction committing late cannot hide behind a delivered cursor.
 for (const id of ids) await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('veya-social-event:' || $1,0))", [id]);
 for (const id of ids) {
  await tx.query(`INSERT INTO social_events(public_key,recipient_profile_id,topic,match_key)
   VALUES ($1,$2,$3,(SELECT m.public_key FROM social_matches m JOIN social_pairs p ON p.id=m.pair_id
    WHERE m.public_key=$4 AND $2::uuid IN(p.low_profile_id,p.high_profile_id) AND m.status='active'
    AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_profile_id,b.blocked_profile_id) IN((p.low_profile_id,p.high_profile_id),(p.high_profile_id,p.low_profile_id)))))`,
  [randomBytes(18).toString('base64url'),id,event.topic,event.matchKey ?? null]);
 }
}
export async function latestSocialCursor(db: DatabaseExecutor, id: string): Promise<string | undefined> {
 return (await db.query<{public_key:string}>('SELECT public_key FROM social_events WHERE recipient_profile_id=$1 ORDER BY id DESC LIMIT 1',[id])).rows[0]?.public_key;
}
export async function readSocialEvents(db: DatabaseExecutor, id: string, cursor?: string): Promise<{events:SocialEvent[];cursorValid:boolean;overflow:boolean}> {
 let after = '0';
 if (cursor) {
  const row = (await db.query<{id:string}>('SELECT id FROM social_events WHERE recipient_profile_id=$1 AND public_key=$2',[id,cursor])).rows[0];
  if (!row) return {events:[],cursorValid:false,overflow:false};
  after = row.id;
 }
 const result=await db.query<{public_key:string;topic:SocialTopic;match_key:string|null}>(`SELECT e.public_key,e.topic,
  (SELECT m.public_key FROM social_matches m JOIN social_pairs p ON p.id=m.pair_id WHERE m.public_key=e.match_key
   AND $1::uuid IN(p.low_profile_id,p.high_profile_id) AND m.status='active'
   AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_profile_id,b.blocked_profile_id) IN((p.low_profile_id,p.high_profile_id),(p.high_profile_id,p.low_profile_id)))) AS match_key
  FROM social_events e WHERE e.recipient_profile_id=$1 AND e.id>$2 ORDER BY e.id LIMIT 101`,[id,after]);
 return {events:result.rows.slice(0,100).map(row=>({publicKey:row.public_key,topic:row.topic,...(row.match_key ? {matchKey:row.match_key}: {})})),cursorValid:!!cursor,overflow:result.rows.length>100};
}
