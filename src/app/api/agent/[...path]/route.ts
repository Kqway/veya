import { goalHandler } from "@/features/goals/runtime";
import { after } from "next/server";
import { getDatabase } from "@/lib/db";
import { getBetaControls } from "@/lib/config/beta-policy";
import { processGoalWindow } from "@/features/goals/background";
import { logOperationalEvent } from "@/lib/logging/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) {
  const path = (await context.params).path;
  const response = await goalHandler()(request, path);
  if (process.env.VERCEL === "1" && request.method !== "GET" && response.ok) {
    after(async () => {
      if (getBetaControls().readOnly) return;
      try {
        logOperationalEvent(
          "worker_complete",
          await processGoalWindow(getDatabase()),
        );
      } catch {
        logOperationalEvent("worker_failed");
      }
    });
  }
  return response;
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
