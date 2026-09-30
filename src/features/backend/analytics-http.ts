import "server-only";
import { z } from "zod";
import type { AnalyticsClient } from "@/lib/analytics/types";
import { HttpError, json, readJson } from "./http";
const eventSchema = z.discriminatedUnion("name", [
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
}) {
  return async (request: Request) => {
    try {
      if (request.headers.get("origin") !== new URL(options.origin).origin)
        throw new HttpError(
          403,
          "ORIGIN_REJECTED",
          "Use the application's origin.",
        );
      const parsed = eventSchema.safeParse(await readJson(request));
      if (!parsed.success)
        throw new HttpError(400, "INVALID_INPUT", "Provide a supported event.");
      await options.client()?.track(parsed.data);
      return json({ accepted: true });
    } catch (error) {
      if (error instanceof HttpError)
        return json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      return json(
        {
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "The service is temporarily unavailable.",
          },
        },
        503,
      );
    }
  };
}
