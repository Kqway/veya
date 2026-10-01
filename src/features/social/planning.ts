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
      const title = `${ctx.match.activity_label} together`;
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
      return { publicSlug: view.intent.publicSlug };
    });
  }
}
