import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { socialActor, forbiddenKeys } from "../support/social";
import { GoalService } from "@/features/goals/service";
import { processGoalJobs } from "@/features/goals/worker";
let c: Awaited<ReturnType<typeof startTestDatabase>>;
beforeAll(async () => {
  c = await startTestDatabase();
  await applyMigrations(c.db);
});
afterAll(async () => {
  if (c) await c.stop();
});
beforeEach(async () => {
  await c.db.query("TRUNCATE social_profiles CASCADE");
});
it("uses real privacy-projected Intent Network matches inside a durable goal step", async () => {
  const a = await socialActor(c.db, "Owner"),
    b = await socialActor(c.db, "Secret name");
  const s = new GoalService(c.db),
    g = await s.create(a.token, {
      text: "Найди партнёра для шахмат",
      environment: "demo",
    });
  expect(g.status).toBe("PLANNING");
  await processGoalJobs(c.db);
  const result = await s.get(a.token, g.publicKey);
  expect(result).toMatchObject({
    status: "PAUSED",
    failureCode: "INTERACTION_REQUIRED",
  });
  expect(
    result.events.some((e) => e.description.includes("1 совместимый")),
  ).toBe(true);
  const step = (
    await c.db.query<{ evidence: unknown }>(
      "SELECT evidence FROM agent_steps WHERE tool='search_people'",
    )
  ).rows[0]!;
  expect(JSON.stringify(step.evidence)).not.toContain("Secret name");
  expect(forbiddenKeys(step.evidence)).toEqual([]);
  expect(
    (await c.db.query("SELECT * FROM discovery_handles")).rows,
  ).toHaveLength(1);
  await expect(s.get(b.token, g.publicKey)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it("never fabricates availability, candidates or successful contact for a people goal", async () => {
  const a = await socialActor(c.db, "Owner"),
    s = new GoalService(c.db),
    g = await s.create(a.token, {
      text: "Найди фотографа",
      environment: "demo",
    });
  await processGoalJobs(c.db);
  const result = await s.get(a.token, g.publicKey);
  expect(result).toMatchObject({
    status: "PAUSED",
    failureCode: "SEEKING_REQUIRED",
  });
  expect(
    (await c.db.query("SELECT * FROM discovery_handles")).rows,
  ).toHaveLength(0);
  expect(result.confirmedAmountMinor).toBe(0);
});
it("applies mutual blocks to autonomous discovery", async () => {
  const a = await socialActor(c.db, "Owner"),
    b = await socialActor(c.db, "Peer");
  await c.db.query(
    "INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) SELECT p.profile_id,q.profile_id FROM seeking_posts p,seeking_posts q WHERE p.public_key=$1 AND q.public_key=$2",
    [b.post.publicKey, a.post.publicKey],
  );
  const s = new GoalService(c.db),
    g = await s.create(a.token, {
      text: "Найди партнёра для шахмат",
      environment: "demo",
    });
  await processGoalJobs(c.db);
  expect((await s.get(a.token, g.publicKey)).failureCode).toBe(
    "NO_COMPATIBLE_PEOPLE",
  );
  expect(
    (await c.db.query("SELECT * FROM discovery_handles")).rows,
  ).toHaveLength(0);
});
