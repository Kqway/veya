import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "@/lib/db/migrations";
import { seedDemo } from "@/lib/db/seed";
import { VeyaBackend } from "@/features/backend/service";
import { startTestDatabase } from "../support/postgres";

describe("demo seed", () => {
  let cluster: Awaited<ReturnType<typeof startTestDatabase>>;
  beforeAll(async () => { cluster = await startTestDatabase(); await applyMigrations(cluster.db); });
  afterAll(async () => { if (cluster) await cluster.stop(); });

  it("creates complete demo data once, including suggestions and votes", async () => {
    const first = await seedDemo(cluster.db);
    const second = await seedDemo(cluster.db);
    expect(first.created).toBe(true);
    expect(second).toEqual({ publicSlug: first.publicSlug, created: false });
    const view = await new VeyaBackend(cluster.db).getIntent(first.publicSlug);
    expect(view.intent.participantCount).toBe(4);
    expect(view.intent.status).toBe("ready");
    expect(view.ownParticipant).toBeNull();
    for (const [table, count] of [["intents", 1], ["participants", 4], ["availability_windows", 4], ["preferences", 8], ["plan_suggestions", 2], ["votes", 2], ["analytics_events", 1]] as const) {
      expect(Number((await cluster.db.query(`SELECT count(*) FROM ${table}`)).rows[0]?.count)).toBe(count);
    }
  });

  it("invalidates suggestions and their votes after a real participant joins", async () => {
    const demo = await seedDemo(cluster.db);
    const backend = new VeyaBackend(cluster.db);
    const guest = await backend.createSession();
    const result = await backend.joinIntent(guest.token, demo.publicSlug, { displayName: "New friend" });
    expect(result.view.intent.status).toBe("collecting");
    expect((await cluster.db.query("SELECT * FROM plan_suggestions")).rowCount).toBe(0);
    expect((await cluster.db.query("SELECT * FROM votes")).rowCount).toBe(0);
  });
});
