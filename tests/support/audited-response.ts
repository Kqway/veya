import type { Route } from "@playwright/test";

export function fetchAuditedResponse(route: Route) {
  // Playwright retries ECONNRESET only, never HTTP errors. Reading an idle socket
  // may reset after navigation; mutations must never be replayed by the auditor.
  return route.fetch({ maxRetries: route.request().method() === "GET" ? 1 : 0 });
}
