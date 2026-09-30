import "server-only";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "./types";

export async function applyMigrations(db: Database, directory = join(process.cwd(), "db/migrations")): Promise<string[]> {
  const files = (await readdir(directory)).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
  if (!files.length) throw new Error("No SQL migrations found.");
  const migrations = await Promise.all(files.map(async (version) => {
    const sql = await readFile(join(directory, version), "utf8");
    return { version, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }));
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(782014221)");
    await tx.query("CREATE TABLE IF NOT EXISTS veya_schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied: string[] = [];
    for (const migration of migrations) {
      const existing = await tx.query<{ checksum: string }>("SELECT checksum FROM veya_schema_migrations WHERE version=$1", [migration.version]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== migration.checksum) throw new Error(`Migration checksum mismatch: ${migration.version}`);
        continue;
      }
      await tx.query(migration.sql);
      await tx.query("INSERT INTO veya_schema_migrations(version,checksum) VALUES ($1,$2)", [migration.version, migration.checksum]);
      applied.push(migration.version);
    }
    return applied;
  });
}
