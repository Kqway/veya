import "server-only";
import { getDatabase } from "@/lib/db";
import { getServerEnv } from "@/lib/config/server";
import { createBackendHandlers } from "./http";
import { VeyaBackend } from "./service";

const config = getServerEnv();
export const backendHandlers = createBackendHandlers({
  backend: () => new VeyaBackend(getDatabase(), { analyticsEnabled: config.ANALYTICS_ENABLED }),
  origin: config.NEXT_PUBLIC_APP_URL,
  secureCookie: config.NODE_ENV === "production",
});
