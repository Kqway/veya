import "server-only";
import { getDatabase } from "@/lib/db";
import type { DatabaseExecutor } from "@/lib/db/types";
import { slugSchema } from "@/features/backend/validation";
import type { PublicIntent } from "@/features/backend/types";
export const previewDescription =
  "Add your availability and Veya will find what works for everyone.";
export type InvitePreview = { title: string; description: string };
export async function readPublicPreview(
  db: DatabaseExecutor,
  slug: string,
): Promise<Pick<PublicIntent, "creatorName" | "status">> {
  const result = await db.query<Pick<PublicIntent, "creatorName" | "status">>(
    `SELECT creator_display_name AS "creatorName", CASE WHEN status IN ('collecting','ready') AND expires_at <= clock_timestamp() THEN 'expired' ELSE status END AS status FROM intents WHERE public_slug=$1`,
    [slug],
  );
  if (!result.rows[0]) throw new Error("Invite unavailable.");
  return result.rows[0];
}
export async function getInvitePreview(
  slug: string,
  load: (
    slug: string,
  ) => Promise<Pick<PublicIntent, "creatorName" | "status">> = (slug) =>
    readPublicPreview(getDatabase(), slug),
): Promise<InvitePreview> {
  const generic = {
    title: "Your next good time starts here",
    description: previewDescription,
  };
  if (!slugSchema.safeParse(slug).success) return generic;
  try {
    const intent = await load(slug);
    if (intent.status !== "collecting" && intent.status !== "ready")
      return generic;
    const name =
      intent.creatorName
        .replace(/[\p{C}]/gu, "")
        .trim()
        .slice(0, 60) || "A friend";
    return {
      title: `${name} wants to make a plan 👀`,
      description: previewDescription,
    };
  } catch {
    return generic;
  }
}
