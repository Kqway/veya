import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { socialActor } from "../support/social";
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
it("executes a durable document deal through revision, exact invoice approval and confirmed payment", async () => {
  const a = await socialActor(c.db, "Owner"),
    s = new GoalService(c.db),
    goal = await s.create(a.token, {
      text: "Заработай 10 000 рублей",
      environment: "demo",
    });
  expect(goal.status).toBe("PLANNING");
  expect(goal.events).toHaveLength(1);
  for (let i = 0; i < 60; i++) {
    await c.db.query(
      "UPDATE agent_jobs SET available_at=clock_timestamp() WHERE status='pending'",
    );
    await processGoalJobs(c.db);
    const g = await s.get(a.token, goal.publicKey);
    if (g.status === "WAITING_APPROVAL") {
      expect(g.confirmedAmountMinor).toBe(0);
      await s.approve(
        a.token,
        g.publicKey,
        g.approvals.find((x) => x.status === "pending")!.publicKey,
        { decision: "approve" },
      );
    }
    if (g.status === "COMPLETED") break;
  }
  const complete = await s.get(a.token, goal.publicKey);
  expect(complete).toMatchObject({
    status: "COMPLETED",
    confirmedAmountMinor: 1000000,
    currency: "RUB",
  });
  expect(complete.deals[0]).toMatchObject({ status: "paid", revision: 1 });
  expect(complete.artifacts.some((x) => x.verified)).toBe(true);
  const artifact = await s.artifact(
    a.token,
    goal.publicKey,
    complete.artifacts[0]!.publicKey,
  );
  expect(artifact.content).toContain("## Рекомендации");
  expect(
    (await c.db.query("SELECT * FROM agent_payment_events")).rows,
  ).toHaveLength(1);
  expect((await c.db.query("SELECT * FROM agent_proposals")).rows).toHaveLength(
    1,
  );
});
it("scopes ownership, saves unsupported goals honestly and bounds communication consent", async () => {
  const a = await socialActor(c.db, "A"),
    b = await socialActor(c.db, "B"),
    s = new GoalService(c.db),
    g = await s.create(a.token, { text: "Fly to Mars", environment: "demo" });
  expect(g).toMatchObject({
    status: "PAUSED",
    failureCode: "CAPABILITY_UNAVAILABLE",
  });
  await expect(s.get(b.token, g.publicKey)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    s.savePolicy(a.token, { communicationLimit: 11 }),
  ).rejects.toBeTruthy();
});
async function create() {
  const a = await socialActor(c.db, "Owner"),
    s = new GoalService(c.db),
    g = await s.create(a.token, {
      text: "Earn 10000 RUB",
      environment: "demo",
    });
  return { a, s, g };
}
async function advanceUntil(key: string, token: string, status: string) {
  const s = new GoalService(c.db);
  for (let i = 0; i < 40; i++) {
    await c.db.query(
      "UPDATE agent_jobs SET available_at=clock_timestamp() WHERE status='pending'",
    );
    await processGoalJobs(c.db);
    const g = await s.get(token, key);
    if (g.status === status) return g;
  }
  throw new Error("Status not reached: " + status);
}
it("concurrent workers commit one durable step and cannot duplicate proposals", async () => {
  const { g, a, s } = await create();
  await Promise.all([processGoalJobs(c.db), processGoalJobs(c.db)]);
  const steps = (await c.db.query("SELECT action_key FROM agent_steps")).rows;
  expect(new Set(steps.map((x) => x.action_key)).size).toBe(steps.length);
  await advanceUntil(g.publicKey, a.token, "WAITING_APPROVAL");
  expect((await s.get(a.token, g.publicKey)).confirmedAmountMinor).toBe(0);
  expect((await c.db.query("SELECT * FROM agent_proposals")).rows).toHaveLength(
    1,
  );
});
it("rejects foreign artifacts and approval IDs, expires exact consent, and pauses on decline", async () => {
  const { g, a, s } = await create(),
    b = await socialActor(c.db, "Other");
  const pending = await advanceUntil(g.publicKey, a.token, "WAITING_APPROVAL"),
    approval = pending.approvals[0]!;
  await expect(
    s.artifact(b.token, g.publicKey, pending.artifacts[0]!.publicKey),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    s.approve(b.token, g.publicKey, approval.publicKey, {
      decision: "approve",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await c.db.query(
    "UPDATE agent_approvals SET expires_at=clock_timestamp()-interval '1 second'",
  );
  await expect(
    s.approve(a.token, g.publicKey, approval.publicKey, {
      decision: "approve",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await s.command(a.token, g.publicKey, { type: "pause" });
  await s.command(a.token, g.publicKey, { type: "resume" });
  await processGoalJobs(c.db);
  const fresh = await s.get(a.token, g.publicKey);
  expect(fresh.approvals.filter((x) => x.status === "pending")).toHaveLength(1);
  await s.approve(
    a.token,
    g.publicKey,
    fresh.approvals.find((x) => x.status === "pending")!.publicKey,
    { decision: "decline" },
  );
  expect((await s.get(a.token, g.publicKey)).status).toBe("PAUSED");
  expect((await processGoalJobs(c.db)).claimed).toBe(0);
  expect(
    (await c.db.query("SELECT * FROM agent_payment_events")).rows,
  ).toHaveLength(0);
});
it.each(["disable", "cancel", "moderate"])(
  "rechecks %s before connector effects",
  async (kind) => {
    const { g, a, s } = await create();
    if (kind === "disable") await s.setConnection(a.token, { enabled: false });
    if (kind === "cancel")
      await s.command(a.token, g.publicKey, { type: "cancel" });
    if (kind === "moderate")
      await c.db.query(
        "UPDATE social_profiles SET moderation_status='suspended'",
      );
    await processGoalJobs(c.db);
    expect(
      (await c.db.query("SELECT * FROM agent_opportunities")).rows,
    ).toHaveLength(0);
    expect(
      (await c.db.query("SELECT status FROM agent_goals")).rows[0]!.status,
    ).toBe(kind === "cancel" ? "CANCELLED" : "PAUSED");
  },
);
it("discard stale worker nonce after a profile-lock wait", async () => {
  await create();
  let changed = false;
  const db: typeof c.db = {
    query: (sql, args) => c.db.query(sql, args),
    close: async () => {},
    transaction: (work) =>
      c.db.transaction((tx) =>
        work({
          query: async (sql, args) => {
            if (!changed && sql.includes("pg_advisory_xact_lock")) {
              changed = true;
              await tx.query(
                "UPDATE agent_jobs SET lease_key='BBBBBBBBBBBBBBBBBBBBBBBB' WHERE status='processing'",
              );
            }
            return tx.query(sql, args);
          },
        }),
      ),
  };
  expect(await processGoalJobs(db)).toMatchObject({ claimed: 1, completed: 0 });
  expect(
    (await c.db.query("SELECT * FROM agent_opportunities")).rows,
  ).toHaveLength(0);
  expect(
    (await c.db.query("SELECT lease_key FROM agent_jobs")).rows[0]!.lease_key,
  ).toBe("BBBBBBBBBBBBBBBBBBBBBBBB");
});
it("retries transaction rollback and exhausts five attempts without persisting raw errors", async () => {
  await create();
  const db: typeof c.db = {
    query: (sql, args) => c.db.query(sql, args),
    close: async () => {},
    transaction: (work) =>
      c.db.transaction((tx) =>
        work({
          query: async (sql, args) => {
            if (sql.startsWith("INSERT INTO agent_opportunities"))
              throw new Error("SECRET raw input");
            return tx.query(sql, args);
          },
        }),
      ),
  };
  expect(await processGoalJobs(db)).toMatchObject({ retried: 1 });
  expect((await c.db.query("SELECT * FROM agent_steps")).rows).toHaveLength(0);
  await c.db.query(
    "UPDATE agent_jobs SET attempts=4,available_at=clock_timestamp()",
  );
  expect(await processGoalJobs(db)).toMatchObject({ failed: 1 });
  expect(
    (await c.db.query("SELECT status,failure_code FROM agent_goals")).rows[0],
  ).toEqual({ status: "FAILED", failure_code: "STEP_FAILED" });
});
it("bounds external messages by owner/day across separate goals", async () => {
  const { a, s } = await create();
  await s.create(a.token, { text: "Earn 10000 RUB", environment: "demo" });
  await s.savePolicy(a.token, { communicationLimit: 1 });
  for (let i = 0; i < 4; i++) await processGoalJobs(c.db);
  expect(
    (await c.db.query("SELECT used FROM agent_communication_usage")).rows,
  ).toEqual([{ used: 1 }]);
  expect((await c.db.query("SELECT * FROM agent_proposals")).rows).toHaveLength(
    1,
  );
  expect(
    (
      await c.db.query(
        "SELECT * FROM agent_goals WHERE failure_code='COMMUNICATION_LIMIT'",
      )
    ).rows,
  ).toHaveLength(1);
});
it("deduplicates provider evidence and rejects mismatched amount, currency and invoice", async () => {
  const { a, s, g } = await create(),
    pending = await advanceUntil(g.publicKey, a.token, "WAITING_APPROVAL");
  await s.approve(a.token, g.publicKey, pending.approvals[0]!.publicKey, {
    decision: "approve",
  });
  await advanceUntil(g.publicKey, a.token, "COMPLETED");
  const { recordMockPayment } = await import("@/features/goals/connectors");
  const payment = (await c.db.query("SELECT * FROM agent_payment_events"))
    .rows[0]!;
  const e = {
    providerEventId: payment.provider_event_id as string,
    invoiceKey: payment.invoice_key as string,
    amountMinor: Number(payment.amount_minor),
    currency: "RUB" as const,
  };
  await c.db.transaction((tx) =>
    recordMockPayment(tx, payment.goal_id, payment.deal_id, e),
  );
  for (const change of [
    { amountMinor: 1 },
    { currency: "USD" as const },
    { invoiceKey: "wrong" },
  ])
    await expect(
      c.db.transaction((tx) =>
        recordMockPayment(tx, payment.goal_id, payment.deal_id, {
          ...e,
          ...change,
        }),
      ),
    ).rejects.toThrow();
  expect((await s.get(a.token, g.publicKey)).confirmedAmountMinor).toBe(
    1000000,
  );
  expect(
    (await c.db.query("SELECT * FROM agent_payment_events")).rows,
  ).toHaveLength(1);
});
it("erases durable state and stored artifacts when a profile is tombstoned", async () => {
  const { a, g } = await create();
  await advanceUntil(g.publicKey, a.token, "WAITING_APPROVAL");
  const reference = (
    await c.db.query<{ storage_ref: string }>(
      "SELECT storage_ref FROM agent_artifacts LIMIT 1",
    )
  ).rows[0]!.storage_ref;
  const { MockArtifactStorage } = await import("@/features/goals/storage");
  expect(await new MockArtifactStorage().get(reference)).toContain("## Обзор");
  const { ProfileDeletionService } = await import("@/features/social/deletion");
  await new ProfileDeletionService(c.db).delete(a.token, {
    confirmation: "DELETE",
  });
  expect((await c.db.query("SELECT * FROM agent_goals")).rows).toHaveLength(0);
  expect((await c.db.query("SELECT * FROM agent_steps")).rows).toHaveLength(0);
  await expect(new MockArtifactStorage().get(reference)).rejects.toThrow();
  expect((await processGoalJobs(c.db)).claimed).toBe(0);
});
it("expires final crashed leases and releases aborted batches", async () => {
  await create();
  const controller = new AbortController();
  controller.abort();
  expect(
    await processGoalJobs(c.db, { signal: controller.signal }),
  ).toMatchObject({ claimed: 0 });
  await c.db.query(
    "UPDATE agent_jobs SET status='processing',attempts=5,lease_key='AAAAAAAAAAAAAAAAAAAAAAAA',lease_until=clock_timestamp()-interval '1 second'",
  );
  expect(await processGoalJobs(c.db)).toMatchObject({ failed: 1 });
  expect(
    (await c.db.query("SELECT status FROM agent_goals")).rows[0]!.status,
  ).toBe("FAILED");
});
it("previews retention without deleting, then erases bounded old terminal goals", async () => {
  const { a, s, g } = await create();
  await s.command(a.token, g.publicKey, { type: "cancel" });
  await c.db.query(
    "UPDATE agent_goals SET updated_at=clock_timestamp()-interval '181 days'",
  );
  const { cleanupGoals } = await import("@/features/goals/retention");
  expect(await cleanupGoals(c.db)).toEqual({ dryRun: true, goals: 1 });
  expect(await s.list(a.token)).toHaveLength(1);
  expect(await cleanupGoals(c.db, { apply: true })).toEqual({
    dryRun: false,
    goals: 1,
  });
  expect(await s.list(a.token)).toHaveLength(0);
});
it("repeats separate deals until matching confirmed payments reach a larger target", async () => {
  const a = await socialActor(c.db, "Repeat owner"),
    s = new GoalService(c.db),
    g = await s.create(a.token, {
      text: "Заработай 15000 рублей",
      environment: "demo",
    });
  await s.savePolicy(a.token, { communicationLimit: 10 });
  for (let i = 0; i < 70; i++) {
    await c.db.query(
      "UPDATE agent_jobs SET available_at=clock_timestamp() WHERE status='pending'",
    );
    await processGoalJobs(c.db);
    const state = await s.get(a.token, g.publicKey);
    if (state.status === "WAITING_APPROVAL")
      await s.approve(
        a.token,
        g.publicKey,
        state.approvals.find((x) => x.status === "pending")!.publicKey,
        { decision: "approve" },
      );
    if (state.status === "COMPLETED") break;
  }
  const result = await s.get(a.token, g.publicKey);
  expect(result).toMatchObject({
    status: "COMPLETED",
    confirmedAmountMinor: 1500000,
  });
  expect(result.deals).toHaveLength(2);
  expect(result.deals.map((x) => x.amountMinor).sort()).toEqual(
    [1000000, 500000].sort(),
  );
  expect(
    (await c.db.query("SELECT * FROM agent_payment_events")).rows,
  ).toHaveLength(2);
});
it("rechecks connector disable and profile deletion after waiting, not from claim-time snapshot", async () => {
  const { a } = await create();
  let changed = false;
  const db: typeof c.db = {
    query: (sql, args) => c.db.query(sql, args),
    close: async () => {},
    transaction: (work) =>
      c.db.transaction((tx) =>
        work({
          query: async (sql, args) => {
            if (!changed && sql.includes("pg_advisory_xact_lock")) {
              changed = true;
              await tx.query(
                "UPDATE agent_connector_accounts SET enabled=false",
              );
            }
            return tx.query(sql, args);
          },
        }),
      ),
  };
  expect(await processGoalJobs(db)).toMatchObject({ completed: 1 });
  expect((await c.db.query("SELECT * FROM agent_steps")).rows).toHaveLength(0);
  const { ProfileDeletionService } = await import("@/features/social/deletion");
  await new ProfileDeletionService(c.db).delete(a.token, {
    confirmation: "DELETE",
  });
  expect((await processGoalJobs(db)).claimed).toBe(0);
});
it("renews expired invoice consent automatically without executing the financial action", async () => {
  const { g, a, s } = await create(),
    pending = await advanceUntil(g.publicKey, a.token, "WAITING_APPROVAL");
  await c.db.query(
    "UPDATE agent_approvals SET expires_at=clock_timestamp()-interval '1 second'",
  );
  // Repeated consent deadlines are successful waits, never failure retries.
  for (let i = 0; i < 7; i++) {
    await processGoalJobs(c.db);
    if (i < 6)
      await c.db.query(
        "UPDATE agent_approvals SET expires_at=clock_timestamp()-interval '1 second' WHERE status='pending'",
      );
  }
  const renewed = await s.get(a.token, g.publicKey);
  expect(renewed.status).toBe("WAITING_APPROVAL");
  expect(renewed.approvals.filter((x) => x.status === "pending")).toHaveLength(
    1,
  );
  expect(
    renewed.approvals.find((x) => x.status === "pending")!.publicKey,
  ).not.toBe(pending.approvals[0]!.publicKey);
  expect(
    (await c.db.query("SELECT invoice_key FROM agent_deals")).rows[0]!
      .invoice_key,
  ).toBeNull();
});
it("budget waits do not consume failure retries and changing the allowance wakes the goal", async () => {
  const { a, s, g } = await create();
  await s.savePolicy(a.token, { communicationLimit: 0 });
  for (let i = 0; i < 9; i++) {
    await c.db.query(
      "UPDATE agent_jobs SET available_at=clock_timestamp() WHERE status='pending'",
    );
    await processGoalJobs(c.db);
  }
  expect(
    (await c.db.query("SELECT attempts FROM agent_jobs")).rows[0]!.attempts,
  ).toBe(0);
  await s.savePolicy(a.token, { communicationLimit: 5 });
  expect((await processGoalJobs(c.db)).claimed).toBe(1);
  expect(await s.get(a.token, g.publicKey)).toMatchObject({
    status: "WAITING_EXTERNAL",
    failureCode: null,
  });
  expect((await c.db.query("SELECT * FROM agent_proposals")).rows).toHaveLength(
    1,
  );
});
it("returns committed deletion when artifact cleanup is temporarily unavailable", async () => {
  const { a } = await create();
  const { ProfileDeletionService } = await import("@/features/social/deletion");
  const db: typeof c.db = {
    query: async (sql, args) => {
      if (sql.startsWith("SELECT goal_id FROM agent_artifact_erasure"))
        throw new Error("storage unavailable");
      return c.db.query(sql, args);
    },
    transaction: c.db.transaction.bind(c.db),
    close: async () => {},
  };
  expect(
    await new ProfileDeletionService(db).delete(a.token, {
      confirmation: "DELETE",
    }),
  ).toEqual({ deleted: true });
  expect((await c.db.query("SELECT * FROM agent_goals")).rows).toHaveLength(0);
  expect(
    (await c.db.query("SELECT * FROM agent_artifact_erasure")).rows,
  ).toHaveLength(1);
  await processGoalJobs(c.db);
  expect(
    (await c.db.query("SELECT * FROM agent_artifact_erasure")).rows,
  ).toHaveLength(0);
});
