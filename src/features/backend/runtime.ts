import "server-only";
import { runtimeLimiter } from "@/lib/security/rate-limit";
import { createAiHandlers } from "./ai-http";
import { getAiTasks } from "@/lib/ai";
import { getDatabase } from "@/lib/db";
import { getServerEnv } from "@/lib/config/server";
import { createBackendHandlers } from "./http";
import { createAnalyticsHandler } from "./analytics-http";
import { createDatabaseAnalyticsClient } from "@/lib/analytics/postgres";
import { VeyaBackend } from "./service";

const config = getServerEnv();
export const backendHandlers = createBackendHandlers({
  limiter: runtimeLimiter,
  backend: () =>
    new VeyaBackend(getDatabase(), {
      analyticsEnabled: config.ANALYTICS_ENABLED,
    }),
  origin: config.NEXT_PUBLIC_APP_URL,
  secureCookie: config.NODE_ENV === "production",
});

export const analyticsHandler = createAnalyticsHandler({
  limiter: runtimeLimiter,
  origin: config.NEXT_PUBLIC_APP_URL,
  client: () =>
    config.ANALYTICS_ENABLED
      ? createDatabaseAnalyticsClient(getDatabase())
      : null,
});

export const aiHandlers = createAiHandlers({
  limiter: runtimeLimiter,
  origin: config.NEXT_PUBLIC_APP_URL,
  tasks: getAiTasks,
  backend: () =>
    new VeyaBackend(getDatabase(), {
      analyticsEnabled: config.ANALYTICS_ENABLED,
    }),
});
