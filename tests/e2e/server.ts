import { spawn } from "node:child_process";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
// This owns an isolated database; never reads or reuses DATABASE_URL.
const database = await startTestDatabase();
let stopping = false;
try {
  await applyMigrations(database.db);
} catch (error) {
  await database.stop();
  throw error;
}
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      DATABASE_URL: database.connectionString,
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
      ANALYTICS_ENABLED: "true",
      NODE_ENV: "production",
    },
  },
);
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  if (server.exitCode === null && server.signalCode === null) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        server.kill("SIGKILL");
      }, 5000);
      server.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      server.kill("SIGTERM");
    });
  }
  await database.stop();
  process.exit(code);
}
server.once("error", () => {
  void stop(1);
});
server.once("exit", (code) => {
  if (!stopping) void stop(code ?? 1);
});
process.once("SIGINT", () => {
  void stop(0);
});
process.once("SIGTERM", () => {
  void stop(0);
});
