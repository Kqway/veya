import "server-only";
import { runtimeLimiter } from "@/lib/security/rate-limit";
import { getDatabase } from "@/lib/db";
import type { DatabaseExecutor } from "@/lib/db/types";
import { slugSchema } from "@/features/backend/validation";
import type { PublicIntent } from "@/features/backend/types";
export const previewDescription =
  "Укажите свободное время, и Intavro найдёт подходящий вариант для всех.";
export type InvitePreview = { title: string; description: string };
export async function readPublicPreview(
  db: DatabaseExecutor,
  slug: string,
): Promise<Pick<PublicIntent, "creatorName" | "status">> {
  if (!(await runtimeLimiter.check("preview")).allowed)
    throw new Error("Предпросмотр временно ограничен.");
  const result = await db.query<Pick<PublicIntent, "creatorName" | "status">>(
    `SELECT creator_display_name AS "creatorName", CASE WHEN status IN ('collecting','ready') AND expires_at <= clock_timestamp() THEN 'expired' ELSE status END AS status FROM intents WHERE public_slug=$1`,
    [slug],
  );
  if (!result.rows[0]) throw new Error("Приглашение недоступно.");
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
    title: "Здесь начинается ваша следующая встреча",
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
        .slice(0, 60) || "Друг";
    return {
      title: `${name} предлагает встретиться 👀`,
      description: previewDescription,
    };
  } catch {
    return generic;
  }
}
