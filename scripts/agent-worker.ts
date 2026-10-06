import { getAiTasks } from "@/lib/ai";
import { setTimeout } from "node:timers/promises";
import { createDatabase } from "@/lib/db/postgres";
import { getServerEnv } from "@/lib/config/server";
import { getBetaControls } from "@/lib/config/beta-policy";
import { processGoalJobs } from "@/features/goals/worker";
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--watch") || args.length > 1)
  throw new Error("Use --watch or no arguments.");
const config = getServerEnv();
if (!config.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const db = createDatabase(config.DATABASE_URL, {
    max: config.DB_POOL_MAX,
    ...(config.DATABASE_SSL_MODE ? { sslMode: config.DATABASE_SSL_MODE } : {}),
  }),
  controller = new AbortController();
const planner = getAiTasks();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  do {
    if (!getBetaControls().readOnly) {
      const result = await processGoalJobs(db, {
        limit: 20,
        signal: controller.signal,
        planner,
      });
      console.log(JSON.stringify(result));
      if (result.failed) process.exitCode = 1;
    }
    if (!args.includes("--watch") || controller.signal.aborted) break;
    try {
      await setTimeout(1000, undefined, { signal: controller.signal });
    } catch {
      break;
    }
  } while (!controller.signal.aborted);
} catch {
  console.error(
    "Goal worker unavailable. Check database migrations and configuration.",
  );
  process.exitCode = 1;
} finally {
  await db.close();
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
