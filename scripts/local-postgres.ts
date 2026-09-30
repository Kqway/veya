import { mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const directory = resolve(".local/postgres");
await mkdir(resolve(".local"), { recursive: true, mode: 0o700 });
const postgres = new EmbeddedPostgres({
  databaseDir: directory, user: "veya", password: "veya-local-only", port: 54322,
  authMethod: "scram-sha-256", persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-h", "127.0.0.1"], onLog: () => {}, onError: () => {},
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await postgres.stop();
  process.exit(0);
}

try {
  const initialized = await access(resolve(directory, "PG_VERSION")).then(() => true, () => false);
  if (!initialized) await postgres.initialise();
  await postgres.start();
  const client = postgres.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname='veya'");
    if (!existing.rowCount) await client.query('CREATE DATABASE "veya"');
  } finally { await client.end(); }
  console.log("Local PostgreSQL ready at 127.0.0.1:54322. Data persists in .local/postgres.");
  console.log("Use the local DATABASE_URL in README; run db:migrate and db:seed in another terminal.");
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
} catch {
  console.error("Local PostgreSQL could not start. Check port 54322, file permissions and the installed platform binary.");
  await postgres.stop().catch(() => {});
  process.exitCode = 1;
}
