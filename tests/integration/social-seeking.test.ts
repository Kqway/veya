import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { createGuestSession } from "@/features/backend/sessions";
import { IdentityService } from "@/features/social/identity";
import { SeekingService } from "@/features/social/seeking";

describe("social seeking ownership and bounds", () => {
  let cluster: Awaited<ReturnType<typeof startTestDatabase>>;
  let service: SeekingService;
  let token: string;
  let outsider: string;
  beforeAll(async () => {
    cluster = await startTestDatabase();
    await applyMigrations(cluster.db);
    service = new SeekingService(cluster.db);
    token = (await createGuestSession(cluster.db)).token;
    outsider = (await createGuestSession(cluster.db)).token;
    await new IdentityService(cluster.db).create(token, {
      alias: "Quiet player",
      privacyMode: "INCOGNITO",
      adultConfirmed: true,
      languages: ["ru"],
    });
    await new IdentityService(cluster.db).create(outsider, {
      alias: "Other",
      privacyMode: "PRIVATE",
      adultConfirmed: true,
    });
  });
  afterAll(async () => {
    if (cluster) await cluster.stop();
  });
  const post = () => ({
    rawText: "Хочу сыграть в шахматы",
    activityKey: "chess",
    activityLabel: "Chess",
    interactionMode: "in_person",
    format: "one_to_one",
    city: "Moscow",
    area: "North",
    availability: [
      {
        startAt: new Date(Date.now() + 86400000).toISOString(),
        endAt: new Date(Date.now() + 90000000).toISOString(),
      },
    ],
    skill: "intermediate",
    languages: ["ru"],
    tags: ["friendly"],
  });
  it("persists own bounded fields but never database identities", async () => {
    const own = await service.create(token, post());
    expect(own.publicKey).toMatch(/^[\w-]{24}$/);
    expect(own.privacyMode).toBe("INCOGNITO");
    expect(own.availability).toHaveLength(1);
    expect(JSON.stringify(own)).not.toMatch(
      /profileId|guestId|token_hash|profile_id/,
    );
    expect(await service.get(token, own.publicKey)).toEqual(own);
    await expect(service.get(outsider, own.publicKey)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("limits three active posts and releases slots on close", async () => {
    await service.create(token, post());
    const third = await service.create(token, post());
    await expect(service.create(token, post())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await service.close(token, third.publicKey);
    await expect(service.create(token, post())).resolves.toHaveProperty(
      "publicKey",
    );
  });
  it("rejects lowering incognito privacy, invalid temporal/text/tag limits", async () => {
    for (const patch of [
      { privacyMode: "OPEN" },
      {
        availability: [
          {
            startAt: new Date(Date.now() - 86400000).toISOString(),
            endAt: new Date(Date.now() + 3600000).toISOString(),
          },
        ],
      },
      { expiresAt: new Date(Date.now() + 31 * 86400000).toISOString() },
      { tags: Array(9).fill("tag") },
      { rawText: "x".repeat(501) },
      { city: null },
    ])
      await expect(
        service.create(token, { ...post(), ...patch }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("has database-enforced slots/window durations and server-only RLS", async () => {
    const rows = await cluster.db.query<{ id: string }>(
      "SELECT id FROM seeking_posts LIMIT 1",
    );
    const id = rows.rows[0]!.id;
    await expect(
      cluster.db.query(
        "INSERT INTO seeking_availability(post_id,slot,start_at,end_at) VALUES($1,15,clock_timestamp(),clock_timestamp()+interval '1 hour')",
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const rls = await cluster.db.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname='seeking_posts'",
    );
    expect(rls.rows[0]!.relrowsecurity).toBe(true);
  });
});
