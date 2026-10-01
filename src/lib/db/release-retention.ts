import 'server-only';
import type { Database } from './types';
/** Separate bounded maintenance, never implicit on startup/request. SQL is server-owned. */
export async function cleanupReleaseData(db:Database,options:{apply?:boolean;batchSize?:number}={}){
 const apply=options.apply??false,batch=options.batchSize??100;
 if(!Number.isInteger(batch)||batch<1||batch>500)throw new Error('Invalid retention batch size.');
 const rules={
  limiterBuckets:["rate_limit_buckets","(action||':'||bucket_key)","reset_at<clock_timestamp()-interval '1 hour'"],
  events:['social_events','id',"created_at<clock_timestamp()-interval '24 hours'"],
  notifications:['social_notifications','id',"created_at<clock_timestamp()-interval '30 days'"],
  pushJobs:['social_notification_jobs','id',"finished_at<clock_timestamp()-interval '7 days' AND status IN('delivered','cancelled','failed')"],
  candidateJobs:['social_candidate_jobs','id',"finished_at<clock_timestamp()-interval '7 days' AND status IN('completed','failed')"],
  moderatorSessions:['moderation_admin_sessions','token_hash',"expires_at<clock_timestamp()-interval '7 days'"],
  subscriptions:['social_push_subscriptions','id',"EXISTS(SELECT 1 FROM guest_participant_sessions g WHERE g.id=social_push_subscriptions.guest_id AND COALESCE(g.revoked_at,g.expires_at)<clock_timestamp()-interval '7 days')"],
 } as const;
 const result:Record<string,number>={};
 for(const [name,[table,key,where]] of Object.entries(rules)){
  // Candidate-worker schema may be added after this foundational module.
  if(table==='social_candidate_jobs'&&!(await db.query("SELECT to_regclass('public.social_candidate_jobs') AS relation")).rows[0]?.relation){result[name]=0;continue;}
  result[name]=await db.transaction(async tx=>{
   const rows=await tx.query<{id:string}>(`SELECT ${key}::text AS id FROM ${table} WHERE ${where} ORDER BY ${key} LIMIT $1${apply?' FOR UPDATE SKIP LOCKED':''}`,[batch]);
   if(!apply||!rows.rows.length)return rows.rows.length;
   return(await tx.query(`DELETE FROM ${table} WHERE ${key}::text=ANY($1::text[])`,[rows.rows.map(v=>String(v.id))])).rowCount;
  });
 }
 return{dryRun:!apply,...result};
}
