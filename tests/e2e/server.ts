import { isolatedBrowserEnvironment } from '../support/e2e-environment';
import { spawn } from "node:child_process";
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { installBrowserFixtureControl } from '../support/browser-rate-isolation';
// This owns an isolated database; never reads or reuses DATABASE_URL.
const database = await startTestDatabase();
const artifactDirectory = await mkdtemp(join(tmpdir(),'veya-browser-artifacts-'));
let stopping = false;
let cleanupFixture: (() => Promise<void>) | undefined;
try {
  await applyMigrations(database.db);
  const fixturePath = process.env.VEYA_E2E_FIXTURE_FILE;
  if (!fixturePath) throw new Error('Browser fixture control unavailable.');
  cleanupFixture = await installBrowserFixtureControl(fixturePath,database.connectionString,database.db);
} catch (error) {
  await database.stop();
  await rm(artifactDirectory,{recursive:true,force:true});
  await cleanupFixture?.();
  throw error;
}
const environment={...isolatedBrowserEnvironment(process.env,database.connectionString),GOAL_ARTIFACT_DIR:artifactDirectory};
// A separate durable process owns execution. Closing every browser tab cannot
// stop it, and the fixture never exposes a production worker-control endpoint.
const goalWorker=spawn(process.execPath,['--conditions=react-server','--import','tsx','scripts/agent-worker.ts','--watch'],{stdio:['ignore','ignore','inherit'],env:environment});
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
    env: environment,
  },
);
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  if(goalWorker.exitCode===null&&goalWorker.signalCode===null){
    await new Promise<void>(resolve=>{const timeout=setTimeout(()=>goalWorker.kill('SIGKILL'),5000);goalWorker.once('exit',()=>{clearTimeout(timeout);resolve();});goalWorker.kill('SIGTERM');});
  }
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
  await rm(artifactDirectory,{recursive:true,force:true});
  await cleanupFixture?.();
  process.exit(code);
}
server.once("error", () => {
  void stop(1);
});
goalWorker.once('error',()=>{void stop(1);});
goalWorker.once('exit',()=>{if(!stopping)void stop(1);});
server.once("exit", (code) => {
  if (!stopping) void stop(code ?? 1);
});
process.once("SIGINT", () => {
  void stop(0);
});
process.once("SIGTERM", () => {
  void stop(0);
});
