import "server-only";
import { randomBytes } from "node:crypto";
import type { DatabaseExecutor } from "@/lib/db/types";
import { createDatabaseAnalyticsClient } from "@/lib/analytics/postgres";
import { BackendError } from "./errors";
import { requireSession } from "./sessions";
import { projectIntent } from "./repository";
import { validate, createIntentSchema } from "./validation";
import type { IntentRow, IntentView } from "./types";
/** Existing coordination creation in a caller-owned transaction; all validation stays here. */
export async function createIntentInTransaction(
  tx: DatabaseExecutor,
  token: string,
  input: unknown,
  options: { analyticsEnabled?: boolean } = {},
): Promise<IntentView> {
  const data = validate(createIntentSchema, input);
  const now = Date.now();
  const expiresAt = data.expiresAt
    ? new Date(data.expiresAt)
    : new Date(now + 7 * 86400000);
  if (expiresAt.getTime() <= now || expiresAt.getTime() > now + 30 * 86400000)
    throw new BackendError("INVALID_INPUT");
  const guestId = await requireSession(tx, token);
  const result = await tx.query<IntentRow>(
    "INSERT INTO intents(public_slug,creator_guest_id,creator_display_name,raw_text,title,structured_intent,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
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
  if (options.analyticsEnabled)
    await createDatabaseAnalyticsClient(tx).track({
      name: "intent_created",
      surface: "create",
    });
  return projectIntent(tx, result.rows[0]!, guestId);
}
