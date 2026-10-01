import 'server-only';
import { z } from 'zod';
import type { DatabaseExecutor } from '@/lib/db/types';
export const funnelEventSchema=z.enum(['seeking_created','discovery_results_seen','interest_sent','interest_received','match_created','first_message_sent','plan_created','plan_confirmed']);
export type FunnelEvent=z.infer<typeof funnelEventSchema>;
/** Only fixed server transitions; no entity identifiers or content are stored. */
export async function trackFunnel(tx:DatabaseExecutor,event:FunnelEvent,enabled:boolean):Promise<void>{
 const name=funnelEventSchema.parse(event);
 if(enabled)await tx.query("INSERT INTO analytics_events(event_name,surface) VALUES($1,'social')",[name]);
}
