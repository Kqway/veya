import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { VeyaBackend } from "@/features/backend/service";
import { cleanupExpired } from "@/lib/db/retention";
let database: Awaited<ReturnType<typeof startTestDatabase>>,
  backend: VeyaBackend;
beforeAll(async () => {
  database = await startTestDatabase();
  await applyMigrations(database.db);
  backend = new VeyaBackend(database.db);
});
afterAll(async () => database?.stop());
beforeEach(async () => {
  await database.db.query(
    "TRUNCATE analytics_events,intents,guest_participant_sessions CASCADE",
  );
});
async function oldPlan(decided = false) {
  const guest = await backend.createSession();
  const view = await backend.createIntent(guest.token, {
    rawText: "Coffee",
    creatorName: "Artem",
  });
  const slug = view.intent.publicSlug;
  const start = new Date(Date.now() + 3600000).toISOString(),
    end = new Date(Date.now() + 7200000).toISOString();
  await backend.joinIntent(guest.token, slug, {
    displayName: "Artem",
    availability: [{ startAt: start, endAt: end }],
    preferences: [{ category: "activity", value: "coffee" }],
    notes: "Private",
  });
  if (decided) {
    const r = await backend.getResults(slug, guest.token),
      key = r.suggestions[0]!.suggestionKey;
    await backend.vote(guest.token, slug, {
      suggestionKey: key,
      revision: r.revision,
      value: "yes",
    });
    await backend.decide(guest.token, slug, {
      suggestionKey: key,
      revision: r.revision,
    });
  }
  await database.db.query(
    "UPDATE intents SET created_at=clock_timestamp()-interval '100 days',expires_at=clock_timestamp()-interval '91 days' WHERE public_slug=$1",
    [slug],
  );
  return { guest, slug };
}
describe("explicit bounded retention", () => {
  it("defaults to dry-run and then cascades only old eligible data, retaining referenced guests", async () => {
    await oldPlan(true);
    const retained = await backend.createSession();
    const live = await backend.createIntent(retained.token, {
      rawText: "Live plan",
    });
    await database.db.query(
      "UPDATE guest_participant_sessions SET created_at=clock_timestamp()-interval '100 days',expires_at=clock_timestamp()-interval '8 days'",
    );
    await database.db.query(
      "INSERT INTO analytics_events(event_name,surface,created_at) VALUES ('landing_view','landing',clock_timestamp()-interval '31 days'),('landing_view','landing',clock_timestamp())",
    );
    expect(await cleanupExpired(database.db)).toEqual({
      dryRun: true,
      intents: 1,
      guests: 1,
      analytics: 1,
    });
    expect((await database.db.query("SELECT id FROM intents")).rowCount).toBe(
      2,
    );
    expect(
      (await database.db.query("SELECT participant_id FROM votes")).rowCount,
    ).toBe(1);
    expect(await cleanupExpired(database.db, { apply: true })).toEqual({
      dryRun: false,
      intents: 1,
      guests: 1,
      analytics: 1,
    });
    expect(
      (await backend.getIntent(live.intent.publicSlug)).intent.rawText,
    ).toBe("Live plan");
    for (const table of [
      "participants",
      "availability_windows",
      "preferences",
      "plan_suggestions",
      "votes",
    ]) {
      expect((await database.db.query(`SELECT * FROM ${table}`)).rowCount).toBe(
        0,
      );
    }
    expect(
      (await database.db.query("SELECT id FROM guest_participant_sessions"))
        .rowCount,
    ).toBe(1);
    expect(
      (await database.db.query("SELECT id FROM analytics_events")).rowCount,
    ).toBe(1);
  });
  it("limits each batch and is idempotent without deleting recent/unexpired records", async () => {
    const first = await oldPlan();
    const second = await oldPlan();
    await database.db.query(
      "UPDATE guest_participant_sessions SET created_at=clock_timestamp()-interval '100 days',expires_at=clock_timestamp()-interval '8 days'",
    );
    const result = await cleanupExpired(database.db, {
      apply: true,
      batchSize: 1,
    });
    expect(result.intents).toBe(1);
    expect(result.guests).toBe(1);
    expect(
      (
        await database.db.query(
          "SELECT public_slug FROM intents WHERE public_slug=ANY($1::text[])",
          [[first.slug, second.slug]],
        )
      ).rowCount,
    ).toBe(1);
    await cleanupExpired(database.db, { apply: true, batchSize: 1 });
    expect(await cleanupExpired(database.db, { apply: true })).toEqual({
      dryRun: false,
      intents: 0,
      guests: 0,
      analytics: 0,
    });
  });
  it("skips locked plans instead of blocking or reversing guest/intent lock order", async () => {
    const { slug } = await oldPlan();
    let unlock!: () => void, ready!: () => void;
    const started = new Promise<void>((r) => {
        ready = r;
      }),
      gate = new Promise<void>((r) => {
        unlock = r;
      });
    const held = database.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM intents WHERE public_slug=$1 FOR UPDATE", [
        slug,
      ]);
      ready();
      await gate;
    });
    await started;
    try {
      expect((await cleanupExpired(database.db, { apply: true })).intents).toBe(
        0,
      );
    } finally {
      unlock();
    }
    await held;
    expect((await cleanupExpired(database.db, { apply: true })).intents).toBe(
      1,
    );
  });
  it.each([0, 501, -1, 1.5])(
    "rejects invalid batch size %s before maintenance",
    async (batchSize) => {
      await expect(
        cleanupExpired(database.db, { apply: true, batchSize }),
      ).rejects.toThrow(/batch/i);
    },
  );
});
