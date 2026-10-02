/** Register lifecycle only; importing this during build never creates connections. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installShutdownHandlers } = await import("./lib/logging/shutdown");
    installShutdownHandlers();
    const {logOperationalEvent}=await import('./lib/logging/server');
    logOperationalEvent('startup_complete');
  }
}
