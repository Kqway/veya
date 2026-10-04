import "server-only";
import { getServerEnv } from "@/lib/config/server";
import { createDatabase } from "./postgres";
import { loadMigrations } from "./migrations";
import type { Database } from "./types";

let database: Database | undefined;

export function getDatabase(): Database {
  if (database) return database;
  const { DATABASE_URL, DB_POOL_MAX, DATABASE_SSL_MODE, VERCEL } = getServerEnv();
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required for database access. See .env.example.");
  }
  database = createDatabase(DATABASE_URL, { max: DB_POOL_MAX, serverless: VERCEL === "1", ...(DATABASE_SSL_MODE ? { sslMode: DATABASE_SSL_MODE } : {}) });
  return database;
}

export type { Database, DatabaseExecutor, DatabaseResult } from "./types";

/** Clear the lazy singleton and release its resources; safe before first use. */
export async function closeDatabase(): Promise<void> {
  const current = database;
  database = undefined;
  await current?.close();
}

/** Read-only readiness. Missing configuration, connectivity or schema is never public detail. */
export async function isDatabaseReady(configuredDatabase?: Database): Promise<boolean> {
  try {
    const db = configuredDatabase ?? getDatabase();
    const expected = await loadMigrations();
    const applied = await db.query<{ version: string; checksum: string }>("SELECT version, checksum FROM veya_schema_migrations ORDER BY version");
    return applied.rows.length === expected.length && expected.every((migration, index) =>
      applied.rows[index]?.version === migration.version && applied.rows[index]?.checksum === migration.checksum);
  } catch {
    return false;
  }
}
