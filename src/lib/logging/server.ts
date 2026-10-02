import "server-only";

const operationalEvents = new Set([
  "startup_complete", "api_unavailable", "worker_started", "worker_complete", "worker_interrupted", "worker_skipped", "worker_exit",
  "status_started", "status_complete", "status_failed", "status_interrupted", "status_exit",
  "migration_started", "migration_complete", "migration_failed", "migration_interrupted", "migration_exit",
  "retention_started", "retention_complete", "retention_failed", "retention_interrupted", "retention_skipped", "retention_exit",
  "database_unavailable", "database_idle_error", "shutdown_started", "shutdown_complete", "shutdown_failed",
  "realtime_unavailable", "worker_failed",
]);
export type OperationalEvent = "startup_complete" | "api_unavailable" | `${"worker" | "migration" | "retention" | "status"}_${"started" | "complete" | "failed" | "interrupted" | "exit"}` | "worker_skipped" | "retention_skipped" | "database_unavailable" | "database_idle_error" | "shutdown_started" | "shutdown_complete" | "shutdown_failed" | "realtime_unavailable";

const occurrences=new Map<OperationalEvent,number>();

/** Fixed event names and numeric counters only; never serialize arbitrary caller data. */
export function logOperationalEvent(event: OperationalEvent, fields: Record<string, unknown> = {}): void {
  if (!operationalEvents.has(event)) return;
  const safe: Record<string, string | number> = { event };
  const total=Math.min((occurrences.get(event)??0)+1,Number.MAX_SAFE_INTEGER);
  occurrences.set(event,total);safe.occurrences=total;
  for (const key of ["durationMs", "count", "exitCode", "claimed", "completed", "delivered", "cancelled", "retried", "failed", "notified", "reminders"] as const) {
    const value = fields[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) safe[key] = Math.min(value, Number.MAX_SAFE_INTEGER);
  }
  const line = JSON.stringify(safe);
  if (event.endsWith("error") || event.endsWith("failed") || event.endsWith("unavailable")) console.error(line);
  else console.info(line);
}
