import "server-only";
import { randomBytes } from "node:crypto";
import type { Database } from "@/lib/db/types";
import { createDatabaseAnalyticsClient } from "@/lib/analytics/postgres";
import { BackendError } from "./errors";
import {
  createGuestSession,
  findSession,
  readGuestSession,
  requireSession,
  revokeGuestSession,
} from "./sessions";
import {
  invalidateSuggestions,
  projectIntent,
  readIntent,
  replaceParticipantDetails,
  requireOpenIntent,
} from "./repository";
import {
  createIntentSchema,
  participantSchema,
  slugSchema,
  validate,
  validateWindows,
} from "./validation";
import { ResultsService } from "./results-service";
import type { IntentRow, IntentView } from "./types";

export class VeyaBackend {
  constructor(
    private readonly db: Database,
    private readonly options: { analyticsEnabled?: boolean } = {},
  ) {}

  getResults(slug: string, token?: string) {
    return new ResultsService(this.db, this.options).getResults(slug, token);
  }
  vote(token: string, slug: string, input: unknown) {
    return new ResultsService(this.db, this.options).vote(token, slug, input);
  }
  decide(token: string, slug: string, input: unknown) {
    return new ResultsService(this.db, this.options).decide(token, slug, input);
  }

  createSession(): Promise<{ token: string; expiresAt: string }> {
    return createGuestSession(this.db);
  }
  revokeSession(token: string): Promise<void> {
    return revokeGuestSession(this.db, token);
  }

  async getSession(token: string): Promise<{ expiresAt: string } | null> {
    const session = await readGuestSession(this.db, token);
    return session ? { expiresAt: session.expires_at.toISOString() } : null;
  }

  async createIntent(token: string, input: unknown): Promise<IntentView> {
    const data = validate(createIntentSchema, input);
    const now = Date.now();
    const expiresAt = data.expiresAt
      ? new Date(data.expiresAt)
      : new Date(now + 7 * 86_400_000);
    if (
      expiresAt.getTime() <= now ||
      expiresAt.getTime() > now + 30 * 86_400_000
    )
      throw new BackendError("INVALID_INPUT");
    return this.db.transaction(async (tx) => {
      const guestId = await requireSession(tx, token);
      const result = await tx.query<IntentRow>(
        "INSERT INTO intents(public_slug,creator_guest_id,creator_display_name,raw_text,title,structured_intent,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          randomBytes(18).toString("base64url"),
          guestId,
          data.creatorName,
          data.rawText,
          data.title ?? data.rawText.slice(0, 120),
          JSON.stringify(data.structuredIntent),
          expiresAt,
        ],
      );
      if (this.options.analyticsEnabled)
        await createDatabaseAnalyticsClient(tx).track({
          name: "intent_created",
          surface: "create",
        });
      return projectIntent(tx, result.rows[0]!, guestId);
    });
  }

  async getIntent(slug: string, token?: string): Promise<IntentView> {
    if (!slugSchema.safeParse(slug).success)
      throw new BackendError("NOT_FOUND");
    return this.db.transaction(async (tx) => {
      const intent = await readIntent(tx, slug);
      return projectIntent(tx, intent, await findSession(tx, token));
    });
  }

  async joinIntent(
    token: string,
    slug: string,
    input: unknown,
  ): Promise<{ created: boolean; view: IntentView }> {
    const data = validate(participantSchema, input);
    validate(slugSchema, slug);
    return this.db.transaction(async (tx) => {
      const guestId = await requireSession(tx, token);
      const intent = await readIntent(tx, slug, "write");
      requireOpenIntent(intent);
      validateWindows(data, intent.expires_at);
      const result = await tx.query<{ id: string }>(
        "INSERT INTO participants(intent_id,guest_id,display_name,budget_min,budget_max,currency,notes) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (intent_id,guest_id) DO NOTHING RETURNING id",
        [
          intent.id,
          guestId,
          data.displayName,
          data.budgetMin,
          data.budgetMax,
          data.currency,
          data.notes,
        ],
      );
      const participant = result.rows[0];
      if (participant) {
        await replaceParticipantDetails(tx, participant.id, data);
        await invalidateSuggestions(tx, intent);
        if (this.options.analyticsEnabled)
          await createDatabaseAnalyticsClient(tx).track({
            name: "participant_joined",
            surface: "invite",
          });
      }
      return {
        created: Boolean(participant),
        view: await projectIntent(tx, intent, guestId),
      };
    });
  }

  async updateParticipant(
    token: string,
    slug: string,
    input: unknown,
  ): Promise<IntentView> {
    const data = validate(participantSchema, input);
    validate(slugSchema, slug);
    return this.db.transaction(async (tx) => {
      const guestId = await requireSession(tx, token);
      const intent = await readIntent(tx, slug, "write");
      requireOpenIntent(intent);
      validateWindows(data, intent.expires_at);
      const result = await tx.query<{ id: string }>(
        "UPDATE participants SET display_name=$3,budget_min=$4,budget_max=$5,currency=$6,notes=$7,updated_at=now() WHERE intent_id=$1 AND guest_id=$2 RETURNING id",
        [
          intent.id,
          guestId,
          data.displayName,
          data.budgetMin,
          data.budgetMax,
          data.currency,
          data.notes,
        ],
      );
      if (!result.rows[0]) throw new BackendError("NOT_FOUND");
      await replaceParticipantDetails(tx, result.rows[0].id, data);
      await invalidateSuggestions(tx, intent);
      return projectIntent(tx, intent, guestId);
    });
  }

  async closeIntent(token: string, slug: string): Promise<void> {
    validate(slugSchema, slug);
    await this.db.transaction(async (tx) => {
      const guestId = await requireSession(tx, token);
      const intent = await readIntent(tx, slug, "write");
      if (intent.creator_guest_id !== guestId)
        throw new BackendError("FORBIDDEN");
      await tx.query(
        "UPDATE intents SET status='expired' WHERE id=$1 AND status<>'decided'",
        [intent.id],
      );
    });
  }
}
