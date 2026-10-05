import { enqueueNotification } from '@/features/notifications/service';
import { trackFunnel } from '@/lib/analytics/funnel';
import { publishSocialEvent } from '@/features/realtime/events';
import "server-only";
import type { Database } from "@/lib/db/types";
import { validate } from "@/features/backend/validation";
import { createIntentInTransaction } from "@/features/backend/intent-creation";
import { authorizeMatch } from "./conversations";
import { publicKeySchema } from "./seeking-schema";
import { pairIdentity } from "./pairs";
import { fail } from "./errors";
export class PlanningService {
  constructor(
    private readonly db: Database,
    private readonly options: { analyticsEnabled?: boolean } = {},
  ) {}
  async plan(token: string, matchKey: string) {
    validate(publicKeySchema, matchKey);
    return this.db.transaction(async (tx) => {
      const ctx = await authorizeMatch(tx, token, matchKey);
      if (ctx.closed) fail("CONFLICT");
      if (ctx.match.plan_slug) return { publicSlug: ctx.match.plan_slug };
      const identity = await pairIdentity(tx, ctx.pair, ctx.own);
      const title = `${ctx.match.activity_label} — вместе`;
      const view = await createIntentInTransaction(
        tx,
        token,
        {
          rawText: title,
          title,
          creatorName: identity.alias,
          structuredIntent: {
            type: "meet",
            activities: [ctx.match.activity_label],
            location: null,
          },
        },
        this.options,
      );
      await tx.query(
        "UPDATE social_matches SET plan_intent_id=(SELECT id FROM intents WHERE public_slug=$2) WHERE id=$1",
        [ctx.match.id, view.intent.publicSlug],
      );
      await tx.query('INSERT INTO social_linked_plan_identities(plan_intent_id,profile_id,guest_id) SELECT id,$2,creator_guest_id FROM intents WHERE public_slug=$1 ON CONFLICT DO NOTHING',[view.intent.publicSlug,ctx.own.id]);
      for (const [recipient,peer] of [[ctx.own.id,ctx.peer.id],[ctx.peer.id,ctx.own.id]]) await enqueueNotification(tx,{recipientProfileId:recipient!,peerProfileId:peer!,type:'PLAN_READY',matchKey,dedupeKey:'plan:'+ctx.match.id});
      await trackFunnel(tx,'plan_created',this.options.analyticsEnabled ?? false);
      await publishSocialEvent(tx,[ctx.own.id,ctx.peer.id],{topic:'match',matchKey});
      return { publicSlug: view.intent.publicSlug };
    });
  }
}
