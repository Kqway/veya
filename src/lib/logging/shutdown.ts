import "server-only";
import { logOperationalEvent } from "./server";

/** All owners get a cleanup attempt; a stalled owner cannot prevent the grace deadline. */
export async function drainResources(resources: ReadonlyArray<() => Promise<void>>, graceMs = 5_000): Promise<void> {
  logOperationalEvent("shutdown_started");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    Promise.allSettled(resources.map((close) => Promise.resolve().then(close))),
    new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), graceMs); timer.unref(); }),
  ]);
  if (timer) clearTimeout(timer);
  if (!result || result.some((resource) => resource.status === "rejected")) logOperationalEvent("shutdown_failed");
  else logOperationalEvent("shutdown_complete");
}

const registered = Symbol.for("veya.shutdown.registered");
const shared = globalThis as typeof globalThis & { [registered]?: boolean };
export function installShutdownHandlers(): void {
  if (shared[registered]) return;
  shared[registered] = true;
  let stopping: Promise<void> | undefined;
  const stop = () => {
    // Leave HTTP listening/draining and process termination to Next's signal handler.
    stopping ??= drainResources([
      async () => { const { closeRealtimeRuntime } = await import("@/features/realtime/runtime"); await closeRealtimeRuntime(); },
      async () => { const { closeDatabase } = await import("@/lib/db"); await closeDatabase(); },
    ]);
    void stopping;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
