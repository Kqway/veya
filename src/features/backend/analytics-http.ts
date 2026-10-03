import "server-only";
import type { RequestLimiter } from "@/lib/security/rate-limit";
import { z } from "zod";
import type { AnalyticsClient } from "@/lib/analytics/types";
import { HttpError, json, readJson, enforceRateLimit, apiError } from "./http";
import { assertBetaOperationAllowed, getBetaControls, type BetaControls } from "@/lib/config/beta-policy";
const eventSchema = z.discriminatedUnion("name", [
  z
    .object({
      name: z.literal("new_intent_from_invite"),
      surface: z.enum(["invite", "result"]),
    })
    .strict(),
  z
    .object({ name: z.literal("result_viewed"), surface: z.literal("result") })
    .strict(),
  z
    .object({ name: z.literal("landing_view"), surface: z.literal("landing") })
    .strict(),
  z
    .object({ name: z.literal("intent_started"), surface: z.literal("create") })
    .strict(),
  z
    .object({ name: z.literal("invite_opened"), surface: z.literal("invite") })
    .strict(),
  z
    .object({
      name: z.literal("invite_link_copied"),
      surface: z.literal("invite"),
    })
    .strict(),
]);
export function createAnalyticsHandler(options: {
  origin: string;
  client: () => AnalyticsClient | null;
  limiter?: RequestLimiter;
  getBetaControls?: () => BetaControls;
}) {
  return async (request: Request) => {
    try {
      if (request.headers.get("origin") !== new URL(options.origin).origin)
        throw new HttpError(
          403,
          "ORIGIN_REJECTED",
          "Отправьте запрос с адреса приложения.",
        );
      assertBetaOperationAllowed("mutation", options.getBetaControls?.() ?? getBetaControls());
      await enforceRateLimit(options.limiter, "analytics", request);
      const parsed = eventSchema.safeParse(await readJson(request));
      if (!parsed.success)
        throw new HttpError(400, "INVALID_INPUT", "Передайте поддерживаемое событие.");
      await options.client()?.track(parsed.data);
      return json({ accepted: true });
    } catch (error) {
      return apiError(error);
    }
  };
}
