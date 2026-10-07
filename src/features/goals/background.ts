import "server-only";
import { setTimeout } from "node:timers/promises";
import type { Database } from "@/lib/db/types";
import { processGoalJobs } from "./worker";

/** Bounded worker invocation; all execution authority and leases remain in PostgreSQL. */
export async function processGoalWindow(
  db: Database,
  options: {
    durationMs?: number;
    pollMs?: number;
    signal?: AbortSignal;
  } = {},
) {
  const durationMs = options.durationMs ?? 120000;
  const pollMs = options.pollMs ?? 1000;
  if (
    !Number.isInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > 120000 ||
    !Number.isInteger(pollMs) ||
    pollMs < 1 ||
    pollMs > 5000
  )
    throw new Error("Invalid worker window");
  const signal = AbortSignal.any([
    AbortSignal.timeout(durationMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  const deadline = Date.now() + durationMs;
  const result = { claimed: 0, completed: 0, retried: 0, failed: 0 };
  let tick = 0;
  while (tick < 80 && !signal.aborted) {
    const batch = await processGoalJobs(db, { limit: 5, signal });
    if (batch.claimed) tick++;
    for (const key of ["claimed", "completed", "retried", "failed"] as const)
      result[key] += batch[key];
    if (!batch.claimed) {
      const pending = await db.query(
        "SELECT 1 FROM agent_jobs WHERE status='pending' AND available_at<=clock_timestamp()+($1::integer*interval '1 millisecond') LIMIT 1",
        [Math.max(0, deadline - Date.now())],
      );
      if (!pending.rowCount) break;
    }
    try {
      await setTimeout(pollMs, undefined, { signal });
    } catch {
      break;
    }
  }
  return result;
}
