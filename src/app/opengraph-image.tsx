import { runtimeLimiter } from "@/lib/security/rate-limit";
import { shareImage } from "@/components/share-image";
export const alt = "Veya — Less planning. More living.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  const limit = runtimeLimiter.check("image");
  if (!limit.allowed)
    return new Response(null, {
      status: 429,
      headers: {
        "Retry-After": String(limit.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    });
  return shareImage({
    title: "Less “we should.” More “let's do it.”",
    description:
      "Start with an idea. Bring your people. Find your moment together.",
  });
}
