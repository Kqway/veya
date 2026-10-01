import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "@/lib/db/migrations";
import { startTestDatabase } from "../support/postgres";
import { VeyaBackend } from "@/features/backend/service";

describe("native PostgreSQL boundary", () => {
  let cluster: Awaited<ReturnType<typeof startTestDatabase>>;
  beforeAll(async () => { cluster = await startTestDatabase(); });
  afterAll(async () => { if (cluster) await cluster.stop(); });

  it("rolls back all writes when a transaction fails", async () => {
    await cluster.db.query("CREATE TABLE rollback_probe (value integer)");
    await expect(cluster.db.transaction(async (tx) => {
      await tx.query("INSERT INTO rollback_probe VALUES (1)");
      throw new Error("deliberate abort");
    })).rejects.toThrow("deliberate abort");
    expect((await cluster.db.query("SELECT * FROM rollback_probe")).rows).toEqual([]);
  });

  it("commits successful transactions with parameterized values", async () => {
    await cluster.db.transaction(async (tx) => {
      await tx.query("INSERT INTO rollback_probe VALUES ($1)", [2]);
    });
    expect((await cluster.db.query("SELECT value FROM rollback_probe")).rows).toEqual([{ value: 2 }]);
  });

  it("applies the domain schema once and preserves checksums", async () => {
    expect(await applyMigrations(cluster.db)).toEqual(["0001_initial.sql", "0002_private_server_tables.sql", "0003_scheduling.sql", "0004_retention_indexes.sql", "0005_social_identity.sql", "0006_seeking_posts.sql", "0007_social_connections.sql", "0008_social_conversations.sql"]);
    expect(await applyMigrations(cluster.db)).toEqual([]);
    const result = await cluster.db.query<{ count: string }>(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','intents','participants','availability_windows','preferences','plan_suggestions','votes','analytics_events','guest_participant_sessions')",
    );
    expect(result.rows[0]?.count).toBe("9");
  });

  it("rejects a changed applied migration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "veya-migration-"));
    try {
      const original = await readFile("db/migrations/0001_initial.sql", "utf8");
      await writeFile(join(directory, "0001_initial.sql"), `${original}\n-- changed`);
      await expect(applyMigrations(cluster.db, directory)).rejects.toThrow("checksum");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rolls back a migration containing invalid SQL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "veya-migration-"));
    try {
      await writeFile(join(directory, "0002_invalid.sql"), "CREATE TABLE must_rollback (id int); SELECT nonexistent_column;");
      await expect(applyMigrations(cluster.db, directory)).rejects.toThrow();
      expect((await cluster.db.query("SELECT to_regclass('public.must_rollback') AS table_name")).rows[0]?.table_name).toBeNull();
      expect((await cluster.db.query("SELECT version FROM veya_schema_migrations WHERE version='0002_invalid.sql'")).rows).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("enforces ownership, budget and window constraints in PostgreSQL itself", async () => {
    const backend = new VeyaBackend(cluster.db);
    const guest = await backend.createSession();
    const view = await backend.createIntent(guest.token, { rawText: "Schema constraints" });
    const ids = (await cluster.db.query<{ id: string; guest_id: string }>("SELECT id,creator_guest_id AS guest_id FROM intents WHERE public_slug=$1", [view.intent.publicSlug])).rows[0]!;
    await expect(cluster.db.query("UPDATE intents SET creator_guest_id=NULL WHERE id=$1", [ids.id])).rejects.toMatchObject({ code: "23514" });
    await expect(cluster.db.query("INSERT INTO participants(intent_id,guest_id,display_name,budget_min,budget_max,currency) VALUES ($1,$2,'Invalid',3000,1000,'USD')", [ids.id, ids.guest_id])).rejects.toMatchObject({ code: "23514" });
    await backend.joinIntent(guest.token, view.intent.publicSlug, { displayName: "Valid" });
    const participant = (await cluster.db.query<{ id: string }>("SELECT id FROM participants WHERE intent_id=$1", [ids.id])).rows[0]!;
    await expect(cluster.db.query("INSERT INTO availability_windows(participant_id,start_at,end_at) VALUES ($1,now()+interval '2 days',now()+interval '1 day')", [participant.id])).rejects.toMatchObject({ code: "23514" });
  });

  it("prevents cross-intent votes using composite foreign keys", async () => {
    const backend = new VeyaBackend(cluster.db);
    const guest = await backend.createSession();
    const first = await backend.createIntent(guest.token, { rawText: "First group" });
    const second = await backend.createIntent(guest.token, { rawText: "Second group" });
    await backend.joinIntent(guest.token, first.intent.publicSlug, { displayName: "Alex" });
    const ids = (await cluster.db.query<{ intent_id: string; id: string }>("SELECT p.intent_id,p.id FROM participants p JOIN intents i ON i.id=p.intent_id WHERE i.public_slug=$1", [first.intent.publicSlug])).rows[0]!;
    const other = (await cluster.db.query<{ id: string }>("SELECT id FROM intents WHERE public_slug=$1", [second.intent.publicSlug])).rows[0]!;
    const suggestion = (await cluster.db.query<{ id: string }>("INSERT INTO plan_suggestions(intent_id,title,start_at,end_at,score,available_count) VALUES ($1,'Other group',now()+interval '1 day',now()+interval '25 hours',50,1) RETURNING id", [other.id])).rows[0]!;
    await expect(cluster.db.query("INSERT INTO votes(intent_id,participant_id,suggestion_id,value) VALUES ($1,$2,$3,1)", [ids.intent_id, ids.id, suggestion.id])).rejects.toMatchObject({ code: "23503" });
    await expect(cluster.db.query("INSERT INTO votes(intent_id,participant_id,suggestion_id,value) VALUES ($1,$2,$3,1)", [other.id, ids.id, suggestion.id])).rejects.toMatchObject({ code: "23503" });
  });

  it("preserves case-insensitive uniqueness of user emails", async () => {
    await cluster.db.query("INSERT INTO users(email,display_name) VALUES ('Alex@example.com','Alex')");
    await expect(cluster.db.query("INSERT INTO users(email,display_name) VALUES ('alex@example.com','Other')")).rejects.toMatchObject({ code: "23505" });
  });

  it("blocks direct client access even if a hosted provider grants table privileges", async () => {
    expect((await cluster.db.query("SELECT * FROM intents")).rowCount).toBeGreaterThan(0);
    await cluster.db.transaction(async (tx) => {
      await tx.query("CREATE ROLE public_client NOLOGIN");
      await tx.query("GRANT SELECT ON intents,users,guest_participant_sessions TO public_client");
      await tx.query("SET LOCAL ROLE public_client");
      expect((await tx.query("SELECT * FROM intents")).rows).toEqual([]);
      expect((await tx.query("SELECT * FROM users")).rows).toEqual([]);
      expect((await tx.query("SELECT * FROM guest_participant_sessions")).rows).toEqual([]);
    });
  });
});
