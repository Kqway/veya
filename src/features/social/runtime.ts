import "server-only";
import { getDatabase } from "@/lib/db";
import { getServerEnv } from "@/lib/config/server";
import { getAiTasks } from "@/lib/ai";
import { runtimeLimiter } from "@/lib/security/rate-limit";
import { createSocialHandler } from "./http";
export function socialHandler() {
  const config = getServerEnv();
  return createSocialHandler({
    origin: config.NEXT_PUBLIC_APP_URL,
    db: getDatabase,
    tasks: getAiTasks,
    limiter: runtimeLimiter,
    analyticsEnabled: config.ANALYTICS_ENABLED,
  });
}
