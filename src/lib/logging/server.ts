import "server-only";

const operationalEvents = new Set([
  "database_unavailable", "database_idle_error", "shutdown_started", "shutdown_complete", "shutdown_failed",
  "realtime_unavailable", "worker_failed",
]);
export type OperationalEvent = "database_unavailable" | "database_idle_error" | "shutdown_started" | "shutdown_complete" | "shutdown_failed" | "realtime_unavailable" | "worker_failed";

/** Fixed event names and numeric counters only; never serialize arbitrary caller data. */
export function logOperationalEvent(event: OperationalEvent, fields: Record<string, unknown> = {}): void {
  if (!operationalEvents.has(event)) return;
  const safe: Record<string, string | number> = { event };
  for (const key of ["durationMs", "count"] as const) {
    const value = fields[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) safe[key] = Math.min(value, Number.MAX_SAFE_INTEGER);
  }
  const line = JSON.stringify(safe);
  if (event.endsWith("error") || event.endsWith("failed") || event.endsWith("unavailable")) console.error(line);
  else console.info(line);
}
