import "server-only";
import { createHash,randomBytes,timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database,DatabaseExecutor } from "@/lib/db/types";
import { HttpError } from "@/features/backend/http";
import { lockProfiles } from "@/features/social/context";
import { publicKeySchema } from "@/features/social/seeking-schema";
import { validate } from "@/features/backend/validation";
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const moderationActionSchema=z.object({status:z.enum(['open','reviewing','resolved','dismissed']).optional(),canSeek:z.boolean().optional(),canConnect:z.boolean().optional(),moderationStatus:z.enum(['active','suspended']).optional()}).strict().refine(value=>Object.keys(value).length>0);
export type ModerationAction=z.infer<typeof moderationActionSchema>;
export interface ModerationEvidence {profiles:{role:string;label:string}[];posts:{role:string;activityLabel:string;interactionMode:string;format:string}[];messages:{role:string;text:string;createdAt:string}[]}
export interface ModerationReport {publicKey:string;status:'open'|'reviewing'|'resolved'|'dismissed';reason:string;text:string|null;createdAt:string}
interface ReportRow {id:string;public_key:string;target_profile_id:string;status:ModerationReport['status'];reason:string;text:string|null;created_at:Date;evidence:ModerationEvidence}
const dto=(r:ReportRow):ModerationReport=>({publicKey:r.public_key,status:r.status,reason:r.reason,text:r.text,createdAt:r.created_at.toISOString()});
const unauthorized=()=>{throw new HttpError(401,'ADMIN_UNAUTHORIZED','An authorized moderator session is required.');};
class RetryLocks extends Error {}
export interface ModerationOptions {
 adminSecret:()=>string|undefined;
 onRestriction?:(tx:DatabaseExecutor,affectedProfileIds:string[])=>Promise<void>;
}
export class ModerationService {
 constructor(private readonly db:Database,private readonly options:ModerationOptions){}
 private configured():string {
  const value=this.options.adminSecret();
  if(!value || !/^[A-Za-z0-9_-]{32,256}$/.test(value)) throw new HttpError(503,'MODERATION_UNAVAILABLE','Moderation is unavailable.');
  return value;
 }
 private async authorize(tx:DatabaseExecutor,token:string):Promise<void> {
  const fingerprint=hash(this.configured());
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))unauthorized();
  const r=await tx.query('SELECT 1 FROM moderation_admin_sessions WHERE token_hash=$1 AND secret_fingerprint=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[hash(token),fingerprint]);
  if(!r.rows.length)unauthorized();
 }
 async login(secret:string):Promise<{token:string;expiresAt:string}> {
  const configured=this.configured();
  if(typeof secret!=='string' || !timingSafeEqual(Buffer.from(hash(secret)),Buffer.from(hash(configured))))unauthorized();
  const token=randomBytes(32).toString('base64url');
  const result=await this.db.query<{expires_at:Date}>('INSERT INTO moderation_admin_sessions(token_hash,secret_fingerprint) VALUES($1,$2) RETURNING expires_at',[hash(token),hash(configured)]);
  return {token,expiresAt:result.rows[0]!.expires_at.toISOString()};
 }
 async session(token:string):Promise<{authenticated:true}> {
  return this.db.transaction(async tx=>{await this.authorize(tx,token);return {authenticated:true};});
 }
 async logout(token:string):Promise<{authenticated:false}> {
  const fingerprint=hash(this.configured());
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))unauthorized();
  return this.db.transaction(async tx=>{
   // One atomic revocation avoids a shared-to-exclusive lock upgrade when two
   // tabs sign out concurrently. Expiry/rotation are rechecked by the UPDATE.
   const result=await tx.query('UPDATE moderation_admin_sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1 AND secret_fingerprint=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() RETURNING token_hash',[hash(token),fingerprint]);
   if(!result.rows.length)unauthorized();
   return {authenticated:false};
  });
 }
 private async audit(tx:DatabaseExecutor,action:string,key:string|null,details:Record<string,unknown>={}) {
  await tx.query("INSERT INTO moderation_audit(report_public_key,moderator,action,details) VALUES($1,'configured-admin',$2,$3)",[key,action,JSON.stringify(details)]);
 }
 async queue(token:string,status?:string):Promise<{reports:ModerationReport[]}> {
  const selected=validate(z.enum(['open','reviewing','resolved','dismissed']).optional(),status);
  return this.db.transaction(async tx=>{await this.authorize(tx,token);const result=await tx.query<ReportRow>("SELECT public_key,status,reason,text,created_at FROM social_reports WHERE ($1::text IS NULL AND status IN('open','reviewing')) OR status=$1 ORDER BY created_at,id LIMIT 30",[selected??null]);await this.audit(tx,'queue_read',null,{count:result.rows.length,...(selected?{status:selected}:{})});return {reports:result.rows.map(dto)};});
 }
 async evidence(token:string,key:string):Promise<{report:ModerationReport;evidence:ModerationEvidence}> {
  validate(publicKeySchema,key);
  return this.db.transaction(async tx=>{await this.authorize(tx,token);const r=await this.report(tx,key);await this.audit(tx,'case_read',key);return {report:dto(r),evidence:r.evidence};});
 }
 private async report(tx:DatabaseExecutor,key:string):Promise<ReportRow> {
  const r=await tx.query<ReportRow>('SELECT id,public_key,target_profile_id,status,reason,text,created_at,evidence FROM social_reports WHERE public_key=$1',[key]);
  if(!r.rows[0])throw new HttpError(404,'NOT_FOUND','The report is unavailable.');
  return r.rows[0];
 }
 async action(token:string,key:string,input:unknown):Promise<{report:ModerationReport}> {
  validate(publicKeySchema,key);const data=validate(moderationActionSchema,input);
  for(let attempt=0;attempt<5;attempt++){
   try{return await this.db.transaction(async tx=>{
    await this.authorize(tx,token);const initial=await this.report(tx,key);
    // Snapshot then acquire all participant locks in global order. If a pair was
    // created while waiting, restart the entire transaction to preserve lock order.
    const peers=await this.peers(tx,initial.target_profile_id);
    await lockProfiles(tx,peers);
    const currentPeers=await this.peers(tx,initial.target_profile_id);
    if(currentPeers.some(id=>!peers.includes(id)))throw new RetryLocks();
    await this.authorize(tx,token);const report=await this.report(tx,key);
    if(report.target_profile_id!==initial.target_profile_id)throw new RetryLocks();
    if(data.canSeek!==undefined||data.canConnect!==undefined||data.moderationStatus!==undefined){
     const target=await tx.query<{deleted_at:Date|null}>('SELECT deleted_at FROM social_profiles WHERE id=$1',[report.target_profile_id]);
     if(target.rows[0]?.deleted_at)throw new HttpError(409,'PROFILE_UNAVAILABLE','This profile is unavailable. Case review remains available.');
     await tx.query('UPDATE social_profiles SET can_seek=COALESCE($2,can_seek),can_connect=COALESCE($3,can_connect),moderation_status=COALESCE($4,moderation_status),updated_at=clock_timestamp() WHERE id=$1',[report.target_profile_id,data.canSeek??null,data.canConnect??null,data.moderationStatus??null]);
     if(data.moderationStatus==='suspended'){
      await tx.query("UPDATE seeking_posts SET status='closed' WHERE profile_id=$1 AND status='active'",[report.target_profile_id]);
      await tx.query("UPDATE connection_requests SET status='declined',updated_at=clock_timestamp() WHERE status='pending' AND (sender_profile_id=$1 OR recipient_profile_id=$1)",[report.target_profile_id]);
      await tx.query("UPDATE social_matches SET status='closed',closed_at=COALESCE(closed_at,clock_timestamp()) WHERE status='active' AND pair_id IN(SELECT id FROM social_pairs WHERE low_profile_id=$1 OR high_profile_id=$1)",[report.target_profile_id]);
      await tx.query("UPDATE conversations SET status='closed' WHERE status='active' AND match_id IN(SELECT m.id FROM social_matches m JOIN social_pairs p ON p.id=m.pair_id WHERE p.low_profile_id=$1 OR p.high_profile_id=$1)",[report.target_profile_id]);
     }
     await this.options.onRestriction?.(tx,currentPeers);
    }
    if(data.status)await tx.query('UPDATE social_reports SET status=$2,updated_at=clock_timestamp() WHERE public_key=$1',[key,data.status]);
    await this.audit(tx,'case_action',key,data);return {report:dto(await this.report(tx,key))};
   });}catch(error){if(!(error instanceof RetryLocks))throw error;}
  }
  throw new HttpError(409,'CONFLICT','Try the moderation action again.');
 }
 private async peers(tx:DatabaseExecutor,target:string):Promise<string[]> {
  const r=await tx.query<{peer:string}>('SELECT CASE WHEN low_profile_id=$1 THEN high_profile_id ELSE low_profile_id END AS peer FROM social_pairs WHERE low_profile_id=$1 OR high_profile_id=$1',[target]);
  return [...new Set([target,...r.rows.map(v=>v.peer)])].sort();
 }
}
