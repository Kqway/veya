import { runtimeLimiter } from "@/lib/security/rate-limit";
import { getInvitePreview } from "@/features/entry/preview";
import { shareImage } from "@/components/share-image";
export const alt = "Соберите друзей с Intavro";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";
export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const limit = await runtimeLimiter.check("image");
  if (!limit.allowed)
    return new Response(null, {
      status: 429,
      headers: {
        "Retry-After": String(limit.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    });
  return shareImage(await getInvitePreview((await params).slug));
}
