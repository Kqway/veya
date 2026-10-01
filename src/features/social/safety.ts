import "server-only";
import { z } from "zod";
import type { Database, DatabaseExecutor } from "@/lib/db/types";
import { lockProfiles, reauthorize, requireProfile } from "./context";
import { requestByKey } from "./connections";
import { authorizeMatch } from "./conversations";
import { peerId, readPair } from "./pairs";
import { publicKeySchema } from "./seeking-schema";
import { parseSocialInput } from "./profile-schema";
const contexts = {
  request: { requestKey: publicKeySchema },
  match: { matchKey: publicKeySchema },
};
export const blockSchema = z.union([z.object(contexts.request).strict(),z.object(contexts.match).strict()]);
const reportFields = { reason: z.enum(["spam","harassment","unsafe_meeting","impersonation","other"]), text: z.string().max(1000).refine((v) => !v.includes("\0")).optional() };
export const reportSchema = z.union([z.object({...contexts.request,...reportFields}).strict(),z.object({...contexts.match,...reportFields}).strict()]);
type Interaction = z.infer<typeof blockSchema>;
async function authorizeInteraction(tx: DatabaseExecutor,token: string,input: Interaction) {
  if ("matchKey" in input) {
    const context = await authorizeMatch(tx,token,input.matchKey);
    return { pairId: context.pair.id, ownId: context.own.id, peerId: context.peer.id, requestId: null, matchId: context.match.id };
  }
  const own = await requireProfile(tx,token);
  const initial = await requestByKey(tx,input.requestKey,own.id);
  const pair = await readPair(tx,initial.pair_id);
  peerId(pair,own.id);
  await lockProfiles(tx,[pair.low_profile_id,pair.high_profile_id]);
  await reauthorize(tx,token,own.id);
  const request = await requestByKey(tx,input.requestKey,own.id), currentPair = await readPair(tx,request.pair_id);
  return { pairId: currentPair.id, ownId: own.id, peerId: peerId(currentPair,own.id), requestId: request.id, matchId: null };
}
export class SafetyService {
  constructor(private readonly db: Database) {}
  async block(token: string,input: unknown): Promise<{blocked:true}> {
    const data = parseSocialInput(blockSchema,input);
    return this.db.transaction(async (tx) => {
      const context = await authorizeInteraction(tx,token,data);
      await tx.query("INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[context.ownId,context.peerId]);
      await tx.query("UPDATE connection_requests SET status='declined',updated_at=clock_timestamp() WHERE pair_id=$1 AND status='pending'",[context.pairId]);
      await tx.query("UPDATE social_matches SET status='closed',closed_at=COALESCE(closed_at,clock_timestamp()) WHERE pair_id=$1 AND status<>'closed'",[context.pairId]);
      await tx.query("UPDATE conversations SET status='closed' WHERE match_id IN(SELECT id FROM social_matches WHERE pair_id=$1) AND status<>'closed'",[context.pairId]);
      return {blocked:true};
    });
  }
  async report(token: string,input: unknown): Promise<{reported:true}> {
    const data = parseSocialInput(reportSchema,input);
    return this.db.transaction(async (tx) => {
      const context = await authorizeInteraction(tx,token,data);
      await tx.query("INSERT INTO social_reports(reporter_profile_id,target_profile_id,request_id,match_id,reason,text) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",[context.ownId,context.peerId,context.requestId,context.matchId,data.reason,data.text ?? null]);
      return {reported:true};
    });
  }
}
