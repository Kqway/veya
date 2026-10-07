import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { socialActor } from "../support/social";
import { GoalService } from "@/features/goals/service";
import { processGoalJobs } from "@/features/goals/worker";
import { artifactStorage } from "@/features/goals/storage";

let fixture: Awaited<ReturnType<typeof startTestDatabase>>;
beforeAll(async () => {
  fixture = await startTestDatabase();
  await applyMigrations(fixture.db);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await fixture?.stop();
});

it("stores bounded private documents durably, verifies checksums and erases them with their goal", async () => {
  vi.stubEnv("GOAL_ARTIFACT_STORAGE", "postgres");
  const owner = await socialActor(fixture.db, "Hosted owner");
  const service = new GoalService(fixture.db);
  const goal = await service.create(owner.token, {
    text: "Заработай 10000 ₽",
    environment: "demo",
  });
  const id = (
    await fixture.db.query<{ id: string }>(
      "SELECT id FROM agent_goals WHERE public_key=$1",
      [goal.publicKey],
    )
  ).rows[0]!.id;
  const stored = await artifactStorage(fixture.db).put(
    id,
    "# Настоящий документ",
  );
  expect(await artifactStorage(fixture.db).get(stored.reference)).toBe(
    "# Настоящий документ",
  );
  await expect(
    artifactStorage(fixture.db).put(id, "я".repeat(8193)),
  ).rejects.toThrow();
  await expect(
    artifactStorage(fixture.db).get("../" + stored.reference),
  ).rejects.toThrow();
  await fixture.db.query(
    "UPDATE agent_document_contents SET content=$1 WHERE goal_id=$2",
    ["tampered", id],
  );
  await expect(
    artifactStorage(fixture.db).get(stored.reference),
  ).rejects.toThrow(/checksum/i);
  await fixture.db.query("DELETE FROM agent_goals WHERE id=$1", [id]);
  expect(
    (
      await fixture.db.query(
        "SELECT * FROM agent_document_contents WHERE goal_id=$1",
        [id],
      )
    ).rowCount,
  ).toBe(0);
}, 30000);

it("completes the real worker journey using database-backed artifacts across storage instances", async () => {
  vi.stubEnv("GOAL_ARTIFACT_STORAGE", "postgres");
  const owner = await socialActor(fixture.db, "Hosted second owner");
  const service = new GoalService(fixture.db);
  const goal = await service.create(owner.token, {
    text: "Заработай 10000 ₽",
    environment: "demo",
  });
  for (let i = 0; i < 35; i++) {
    await fixture.db.query(
      "UPDATE agent_jobs SET available_at=clock_timestamp() WHERE status='pending'",
    );
    await processGoalJobs(fixture.db);
    const current = await service.get(owner.token, goal.publicKey);
    if (current.status === "WAITING_APPROVAL")
      await service.approve(
        owner.token,
        goal.publicKey,
        current.approvals.find((a) => a.status === "pending")!.publicKey,
        { decision: "approve" },
      );
    if (current.status === "COMPLETED") break;
  }
  const complete = await service.get(owner.token, goal.publicKey);
  expect(complete).toMatchObject({
    status: "COMPLETED",
    confirmedAmountMinor: 1000000,
  });
  expect(
    (
      await service.artifact(
        owner.token,
        goal.publicKey,
        complete.artifacts[0]!.publicKey,
      )
    ).content,
  ).toContain("## План внедрения");
  expect(
    (await fixture.db.query("SELECT * FROM agent_document_contents")).rowCount,
  ).toBeGreaterThan(0);
}, 30000);
