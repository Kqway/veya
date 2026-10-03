import { runtimeLimiter } from "@/lib/security/rate-limit";
import { shareImage } from "@/components/share-image";
export const alt = "Intavro — Меньше планирования. Больше жизни.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";
export default async function Image() {
  const limit = await runtimeLimiter.check("image");
  if (!limit.allowed)
    return new Response(null, {
      status: 429,
      headers: {
        "Retry-After": String(limit.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    });
  return shareImage({
    title: "От идеи к встрече — вместе.",
    description:
      "Расскажите, чем хотите заняться. Найдите компанию и договоритесь о встрече.",
  });
}
