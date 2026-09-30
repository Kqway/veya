import "server-only";
import type { DatabaseExecutor } from "@/lib/db/types";
import { BackendError } from "./errors";
import type { IntentRow, IntentView, OwnParticipant } from "./types";
import type { ParticipantInput } from "./validation";

export async function readIntent(db: DatabaseExecutor, slug: string, lock: "share" | "write" = "share"): Promise<IntentRow> {
  const result = await db.query<IntentRow>(
    `SELECT i.*, CASE WHEN expires_at<=now() THEN 'expired' ELSE status END AS status FROM intents i WHERE public_slug=$1 FOR ${lock === "write" ? "UPDATE" : "SHARE"}`,
    [slug],
  );
  if (!result.rows[0]) throw new BackendError("NOT_FOUND");
  return result.rows[0];
}

export function requireOpenIntent(intent: IntentRow): void {
  if (intent.status === "expired") throw new BackendError("INVITE_EXPIRED");
  if (intent.status === "decided") throw new BackendError("INTENT_CLOSED");
}

type ParticipantRow = { id: string; display_name: string; budget_min: number | null; budget_max: number | null; currency: string | null; notes: string };

export async function projectIntent(db: DatabaseExecutor, intent: IntentRow, guestId: string | null): Promise<IntentView> {
  const count = await db.query<{ count: string }>("SELECT count(*) FROM participants WHERE intent_id=$1", [intent.id]);
  let ownParticipant: OwnParticipant | null = null;
  if (guestId) {
    const result = await db.query<ParticipantRow>("SELECT id,display_name,budget_min,budget_max,currency,notes FROM participants WHERE intent_id=$1 AND guest_id=$2", [intent.id, guestId]);
    const own = result.rows[0];
    if (own) {
      const windows = await db.query<{ start_at: Date; end_at: Date }>("SELECT start_at,end_at FROM availability_windows WHERE participant_id=$1 ORDER BY start_at", [own.id]);
      const preferences = await db.query<{ category: "activity" | "dietary" | "location"; value: string }>("SELECT category,value FROM preferences WHERE participant_id=$1 ORDER BY category,value", [own.id]);
      ownParticipant = {
        displayName: own.display_name, budgetMin: own.budget_min, budgetMax: own.budget_max,
        currency: own.currency, notes: own.notes, preferences: preferences.rows,
        availability: windows.rows.map((window) => ({ startAt: window.start_at.toISOString(), endAt: window.end_at.toISOString() })),
      };
    }
  }
  return {
    intent: {
      publicSlug: intent.public_slug, creatorName: intent.creator_display_name, rawText: intent.raw_text,
      title: intent.title, structuredIntent: intent.structured_intent, status: intent.status,
      createdAt: intent.created_at.toISOString(), expiresAt: intent.expires_at.toISOString(),
      participantCount: Number(count.rows[0]!.count),
    },
    ownParticipant, isCreator: guestId !== null && intent.creator_guest_id === guestId,
  };
}

export async function replaceParticipantDetails(db: DatabaseExecutor, participantId: string, input: ParticipantInput): Promise<void> {
  await db.query("DELETE FROM availability_windows WHERE participant_id=$1", [participantId]);
  await db.query("DELETE FROM preferences WHERE participant_id=$1", [participantId]);
  for (const window of input.availability) {
    await db.query("INSERT INTO availability_windows(participant_id,start_at,end_at) VALUES ($1,$2,$3)",
      [participantId, new Date(window.startAt).toISOString(), new Date(window.endAt).toISOString()]);
  }
  for (const preference of input.preferences) {
    await db.query("INSERT INTO preferences(participant_id,category,value) VALUES ($1,$2,$3)", [participantId, preference.category, preference.value]);
  }
}

export async function invalidateSuggestions(db: DatabaseExecutor, intent: IntentRow): Promise<void> {
  await db.query("DELETE FROM plan_suggestions WHERE intent_id=$1", [intent.id]);
  if (intent.status === "ready") {
    await db.query("UPDATE intents SET status='collecting' WHERE id=$1", [intent.id]);
    intent.status = "collecting";
  }
}
