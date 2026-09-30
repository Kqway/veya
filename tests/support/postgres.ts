import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { createDatabase } from "@/lib/db/postgres";

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No test port"));
      server.close(() => resolve(address.port));
    });
  });
}

export async function startTestDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "veya-pg-"));
  const port = await freePort();
  const password = randomBytes(24).toString("hex");
  const postgres = new EmbeddedPostgres({
    databaseDir: join(directory, "data"), port, user: "veya_test", password,
    authMethod: "scram-sha-256", persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1", "-k", directory],
    onLog: () => {}, onError: () => {},
  });
  try {
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase("veya_test");
  } catch (error) {
    await postgres.stop().catch(() => {});
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const connectionString = `postgresql://veya_test:${password}@127.0.0.1:${port}/veya_test`;
  const db = createDatabase(connectionString);
  return {
    db,
    connectionString,
    async stop() {
      await db.close();
      try { await postgres.stop(); } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}
