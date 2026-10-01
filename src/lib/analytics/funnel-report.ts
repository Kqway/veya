import 'server-only';
import type {DatabaseExecutor} from '@/lib/db/types';
/** Aggregate seeking cohort, no rows/identifiers leave this reporting boundary. */
export async function readAggregateFunnel(db:DatabaseExecutor,days=7){
 if(!Number.isInteger(days)||days<1||days>30)throw new Error('Choose a cohort from 1 to 30 days.');
 const result=await db.query<{seeking:number;candidates:number;interested:number;matches:number;conversations:number;plans:number;confirmed:number}>(`WITH cohort AS(SELECT id,discovery_found_at FROM seeking_posts WHERE created_at>=clock_timestamp()-($1::int*interval '1 day')),
 connected AS(SELECT DISTINCT r.source_post_id AS post_id,m.id AS match_id,m.plan_intent_id FROM connection_requests r LEFT JOIN social_matches m ON m.request_id=r.id WHERE r.source_post_id IN(SELECT id FROM cohort)),
 chatted AS(SELECT DISTINCT c.match_id FROM conversations c JOIN messages msg ON msg.conversation_id=c.id)
 SELECT (SELECT count(*)::int FROM cohort) seeking,(SELECT count(*)::int FROM cohort WHERE discovery_found_at IS NOT NULL) candidates,
 (SELECT count(DISTINCT post_id)::int FROM connected) interested,(SELECT count(DISTINCT post_id)::int FROM connected WHERE match_id IS NOT NULL) matches,
 (SELECT count(DISTINCT post_id)::int FROM connected WHERE match_id IN(SELECT match_id FROM chatted)) conversations,
 (SELECT count(DISTINCT post_id)::int FROM connected WHERE plan_intent_id IS NOT NULL) plans,
 (SELECT count(DISTINCT post_id)::int FROM connected WHERE plan_intent_id IN(SELECT id FROM intents WHERE status='decided')) confirmed`,[days]);
 return {days,...result.rows[0]!};
}
