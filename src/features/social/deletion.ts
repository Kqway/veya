import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Database, DatabaseExecutor } from '@/lib/db/types';
import { requireSession } from '@/features/backend/sessions';
import { publishSocialEvent } from '@/features/realtime/events';
import { parseSocialInput } from './profile-schema';
import { lockProfiles } from './context';
import { fail } from './errors';

export const deleteProfileSchema=z.object({confirmation:z.literal('DELETE')}).strict();
class RetryMembership extends Error {}
async function boundProfile(tx:DatabaseExecutor,guest:string):Promise<string|undefined>{
 return(await tx.query<{profile_id:string}>('SELECT profile_id FROM social_profile_bindings WHERE guest_id=$1',[guest])).rows[0]?.profile_id;
}
async function peers(tx:DatabaseExecutor,profile:string):Promise<string[]>{
 const rows=await tx.query<{peer:string}>('SELECT CASE WHEN low_profile_id=$1 THEN high_profile_id ELSE low_profile_id END AS peer FROM social_pairs WHERE low_profile_id=$1 OR high_profile_id=$1',[profile]);
 return [...new Set([profile,...rows.rows.map(r=>r.peer)])].sort();
}

/** Social deletion is distinct from deleting a separately shared bearer plan. */
export class ProfileDeletionService {
 constructor(private readonly db:Database){}
 async delete(token:string,input:unknown):Promise<{deleted:true}>{
  parseSocialInput(deleteProfileSchema,input);
  for(let attempt=0;attempt<5;attempt++){
   try{return await this.db.transaction(async tx=>{
    const guest=await requireSession(tx,token);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('veya-social-guest:' || $1,0))",[guest]);
    await requireSession(tx,token);
    const profile=await boundProfile(tx,guest);
    if(!profile)return {deleted:true};
    const initialPeers=await peers(tx,profile);
    await lockProfiles(tx,initialPeers);
    await requireSession(tx,token);
    // Recovery may detach this binding while deletion waits. Do not authorize
    // using a stale lookup, and never follow a client-selected profile identifier.
    if(await boundProfile(tx,guest)!==profile)fail('NOT_FOUND');
    const currentPeers=await peers(tx,profile);
    if(currentPeers.some(id=>!initialPeers.includes(id)))throw new RetryMembership();
    await this.erase(tx,profile,currentPeers);
    return {deleted:true};
   });}catch(error){if(!(error instanceof RetryMembership))throw error;}
  }
  return fail('CONFLICT');
 }
 private async erase(tx:DatabaseExecutor,profile:string,affected:string[]){
  // Safe invalidations close existing own SSE subscriptions and refresh peers.
  // The committed NOTIFY survives removal of the deleted owner's outbox rows.
  for(let i=0;i<affected.length;i+=100){
   const chunk=affected.slice(i,i+100);
   for(const topic of ['connections','match','notifications','discovery'] as const)await publishSocialEvent(tx,chunk,{topic});
  }
  const plans=await tx.query<{id:string;status:string}>(`SELECT i.id,i.status FROM intents i WHERE i.id IN(
   SELECT m.plan_intent_id FROM social_matches m JOIN social_pairs p ON p.id=m.pair_id
   WHERE $1 IN(p.low_profile_id,p.high_profile_id)) ORDER BY i.id FOR UPDATE`,[profile]);
  for(const plan of plans.rows){
   const removed=await tx.query<{id:string}>(`DELETE FROM participants WHERE intent_id=$1 AND guest_id IN(
    SELECT guest_id FROM social_profile_bindings WHERE profile_id=$2) RETURNING id`,[plan.id,profile]);
   await tx.query(`UPDATE intents SET creator_display_name='Deleted participant' WHERE id=$1
    AND creator_guest_id IN(SELECT guest_id FROM social_profile_bindings WHERE profile_id=$2)`,[plan.id,profile]);
   if(removed.rows.length){
    await tx.query('UPDATE intents SET scheduling_revision=scheduling_revision+1,suggestions_fingerprint=NULL WHERE id=$1',[plan.id]);
    if(plan.status==='decided'){
     // A confirmed meeting time is shared explicit plan data. Keep that choice,
     // but remove erased participant identities from all cached attendance.
     await tx.query(`UPDATE plan_suggestions SET details=jsonb_set(jsonb_set(details,'{availableParticipantIds}',
      COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(COALESCE(details->'availableParticipantIds','[]'::jsonb)) value WHERE NOT value #>> '{}' = ANY($2::text[])),'[]'::jsonb)),
      '{partialParticipantIds}',COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(COALESCE(details->'partialParticipantIds','[]'::jsonb)) value WHERE NOT value #>> '{}' = ANY($2::text[])),'[]'::jsonb)) WHERE intent_id=$1`,[plan.id,removed.rows.map(r=>r.id)]);
     await tx.query("UPDATE plan_suggestions SET available_count=jsonb_array_length(details->'availableParticipantIds') WHERE intent_id=$1",[plan.id]);
    }else{
     await tx.query('DELETE FROM plan_suggestions WHERE intent_id=$1',[plan.id]);
     await tx.query("UPDATE intents SET status='collecting' WHERE id=$1 AND status='ready'",[plan.id]);
    }
   }
  }
  await tx.query(`UPDATE conversations SET status='closed' WHERE match_id IN(
   SELECT m.id FROM social_matches m JOIN social_pairs p ON p.id=m.pair_id WHERE $1 IN(p.low_profile_id,p.high_profile_id))`,[profile]);
  // Retain the internal reference so a later deletion by the other participant
  // can erase their linked-plan data too. Closed projections never expose it.
  await tx.query(`UPDATE social_matches SET status='closed',closed_at=COALESCE(closed_at,clock_timestamp())
   WHERE pair_id IN(SELECT id FROM social_pairs WHERE $1 IN(low_profile_id,high_profile_id))`,[profile]);
  await tx.query("UPDATE connection_requests SET status='declined',updated_at=clock_timestamp() WHERE status='pending' AND (sender_profile_id=$1 OR recipient_profile_id=$1)",[profile]);
  await tx.query('DELETE FROM messages WHERE sender_profile_id=$1',[profile]);
  await tx.query('DELETE FROM match_disclosures WHERE sender_profile_id=$1',[profile]);
  await tx.query('DELETE FROM social_notifications WHERE recipient_profile_id=$1 OR peer_profile_id=$1',[profile]);
  await tx.query('DELETE FROM social_events WHERE recipient_profile_id=$1',[profile]);
  await tx.query('DELETE FROM discovery_passes WHERE viewer_profile_id=$1 OR target_profile_id=$1',[profile]);
  await tx.query('DELETE FROM social_blocks WHERE blocker_profile_id=$1 OR blocked_profile_id=$1',[profile]);
  // Detach request references before deleting posts, respecting ownership triggers.
  await tx.query(`UPDATE connection_requests SET
   source_post_id=CASE WHEN sender_profile_id=$1 THEN NULL ELSE source_post_id END,
   target_post_id=CASE WHEN recipient_profile_id=$1 THEN NULL ELSE target_post_id END
   WHERE sender_profile_id=$1 OR recipient_profile_id=$1`,[profile]);
  await tx.query('DELETE FROM seeking_posts WHERE profile_id=$1',[profile]);
  await tx.query('DELETE FROM discovery_handles WHERE viewer_profile_id=$1',[profile]);
  // Cascade subscriptions and delivery jobs before any later worker can recheck.
  await tx.query('DELETE FROM social_profile_bindings WHERE profile_id=$1',[profile]);
  await tx.query(`UPDATE pairwise_identities identity SET alias='Deleted participant',avatar_seed=replace(gen_random_uuid()::text,'-','')
   FROM social_pairs pair WHERE identity.pair_id=pair.id AND
   ((pair.low_profile_id=$1 AND identity.side='low') OR (pair.high_profile_id=$1 AND identity.side='high'))`,[profile]);
  await tx.query(`UPDATE social_profiles SET alias='Deleted participant',privacy_mode='INCOGNITO',avatar_seed=$2,
   age_band=NULL,languages='{}',recovery_key_hash=NULL,can_seek=false,can_connect=false,moderation_status='suspended',
   deleted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,[profile,randomBytes(16).toString('hex')]);
 }
}
