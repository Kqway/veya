import 'server-only';
import type {Database} from './types';

type JobStatus={pending:number;processing:number;failed:number;completed:number;expiredLeases:number;oldestPendingAgeSeconds:number|null;lastCompletionAgeSeconds:number|null};
/** Operator-only aggregate queries. No identities, error details, URLs or content. */
export async function readOperationalStatus(db:Database):Promise<{intents:JobStatus;candidates:JobStatus;notifications:JobStatus}>{
 async function jobs(table:'social_candidate_jobs'|'social_notification_jobs'|'social_intent_jobs',successful:'completed'|'delivered'):Promise<JobStatus>{
  const row=(await db.query<JobStatus>(`SELECT
   count(*) FILTER(WHERE status='pending')::integer AS pending,
   count(*) FILTER(WHERE status='processing')::integer AS processing,
   count(*) FILTER(WHERE status='failed')::integer AS failed,
   count(*) FILTER(WHERE status=$1)::integer AS completed,
   count(*) FILTER(WHERE status='processing' AND lease_until<=clock_timestamp())::integer AS "expiredLeases",
   greatest(0,extract(epoch FROM clock_timestamp()-min(created_at) FILTER(WHERE status='pending')))::float8 AS "oldestPendingAgeSeconds",
   CASE WHEN max(finished_at) FILTER(WHERE status=$1) IS NULL THEN NULL ELSE
    greatest(0,extract(epoch FROM clock_timestamp()-max(finished_at) FILTER(WHERE status=$1)))::float8 END AS "lastCompletionAgeSeconds"
   FROM ${table}`,[successful])).rows[0]!;
  return row;
 }
 return{intents:await jobs('social_intent_jobs','completed'),candidates:await jobs('social_candidate_jobs','completed'),notifications:await jobs('social_notification_jobs','delivered')};
}
