import "server-only";
import { getDatabase } from "@/lib/db";
import { getServerEnv } from "@/lib/config/server";
import { runtimeLimiter } from "@/lib/security/rate-limit";
import { createGoalHandler } from "./http";
export function goalHandler() {
  return createGoalHandler({
    origin: getServerEnv().NEXT_PUBLIC_APP_URL,
    db: getDatabase,
    limiter: runtimeLimiter,
  });
}
