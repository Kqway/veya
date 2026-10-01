import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import * as deployment from "@/lib/db";
import { createDatabase } from "@/lib/db/postgres";

let fixture: Awaited<ReturnType<typeof startTestDatabase>>;
beforeAll(async () => { fixture = await startTestDatabase(); });
afterAll(async () => { await fixture?.stop(); });

describe("database readiness", () => {
  it("requires the exact current migration set and checksums", async () => {
    expect(typeof deployment.isDatabaseReady).toBe("function");
    expect(await deployment.isDatabaseReady(fixture.db)).toBe(false);
    await applyMigrations(fixture.db);
    expect(await deployment.isDatabaseReady(fixture.db)).toBe(true);
    await fixture.db.query("UPDATE veya_schema_migrations SET checksum='incorrect' WHERE version=(SELECT min(version) FROM veya_schema_migrations)");
    expect(await deployment.isDatabaseReady(fixture.db)).toBe(false);
  });
  it("fails safely after a configured pool closes and closes idempotently", async () => {
    const db = createDatabase(fixture.connectionString, { max: 1 });
    expect((await db.query("SELECT 1 AS alive")).rows).toEqual([{ alive: 1 }]);
    await db.close();
    await db.close();
    expect(await deployment.isDatabaseReady(db)).toBe(false);
  });
});
