import { publishModerationInvalidations } from './events';
import "server-only";
import { getDatabase } from "@/lib/db";
import { getServerEnv } from "@/lib/config/server";
import { runtimeLimiter } from "@/lib/security/rate-limit";
import { createModerationHandler } from "./http";
export function moderationHandler(){
 const config=getServerEnv();
 return createModerationHandler({db:getDatabase,origin:config.NEXT_PUBLIC_APP_URL,secureCookie:config.NODE_ENV==='production',adminSecret:()=>getServerEnv().MODERATION_ADMIN_SECRET,onRestriction:publishModerationInvalidations,limiter:runtimeLimiter});
}
