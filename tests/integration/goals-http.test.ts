import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { socialActor } from "../support/social";
import { createGoalHandler } from "@/features/goals/http";
import { processGoalJobs } from "@/features/goals/worker";
let c: Awaited<ReturnType<typeof startTestDatabase>>;
const origin = "http://localhost:3000";
beforeAll(async () => {
  c = await startTestDatabase();
  await applyMigrations(c.db);
});
afterAll(async () => {
  if (c) await c.stop();
});
function request(
  path: string,
  token = "",
  method = "GET",
  body?: unknown,
  requestOrigin = origin,
) {
  return new Request(origin + "/api/agent/" + path, {
    method,
    headers: {
      origin: requestOrigin,
      "content-type": "application/json",
      cookie: "veya_guest=" + token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
it("authenticates scoped no-store DTOs, binary artifacts and persisted commands", async () => {
  const a = await socialActor(c.db, "Owner"),
    b = await socialActor(c.db, "Other"),
    handler = createGoalHandler({ origin, db: () => c.db });
  expect((await handler(request("goals"), ["goals"])).status).toBe(401);
  const created = await handler(
    request("goals", a.token, "POST", {
      text: "Заработай 10000 рублей",
      environment: "demo",
    }),
    ["goals"],
  );
  expect(created.status).toBe(201);
  const { goal } = await created.json();
  expect(created.headers.get("cache-control")).toBe("no-store");
  expect(JSON.stringify(goal)).not.toMatch(
    /profile_id|lease_key|storage_ref|input_hash/,
  );
  expect(
    (
      await handler(request("goals/" + goal.publicKey, b.token), [
        "goals",
        goal.publicKey,
      ])
    ).status,
  ).toBe(404);
  for (let i = 0; i < 8; i++) {
    await c.db.query(
      "UPDATE agent_jobs SET available_at=clock_timestamp() WHERE status='pending'",
    );
    await processGoalJobs(c.db);
  }
  const detail = await (
    await handler(request("goals/" + goal.publicKey, a.token), [
      "goals",
      goal.publicKey,
    ])
  ).json();
  const key = detail.goal.artifacts[0].publicKey;
  const file = await handler(
    request("goals/" + goal.publicKey + "/artifacts/" + key, a.token),
    ["goals", goal.publicKey, "artifacts", key],
  );
  expect(file.status).toBe(200);
  expect(file.headers.get("content-disposition")).toContain("attachment");
  expect(await file.text()).toContain("## Рекомендации");
  expect(
    (
      await handler(
        request("goals/" + goal.publicKey + "/artifacts/" + key, b.token),
        ["goals", goal.publicKey, "artifacts", key],
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await handler(
        request("goals/" + goal.publicKey + "/command", a.token, "POST", {
          type: "cancel",
        }),
        ["goals", goal.publicKey, "command"],
      )
    ).status,
  ).toBe(200);
  expect((await processGoalJobs(c.db)).claimed).toBe(0);
});
it("enforces same-origin, rate and beta protection before database access", async () => {
  const db = vi.fn(() => c.db);
  const handler = createGoalHandler({ origin, db });
  expect(
    (
      await handler(
        request("goals", "", "POST", {}, "http://attacker.invalid"),
        ["goals"],
      )
    ).status,
  ).toBe(403);
  expect(db).not.toHaveBeenCalled();
  const readOnly = createGoalHandler({
    origin,
    db,
    getBetaControls: () => ({
      readOnly: true,
      signupsEnabled: true,
      seekingEnabled: true,
    }),
  });
  expect(
    (await readOnly(request("goals", "", "POST", {}), ["goals"])).status,
  ).toBe(503);
  expect(db).not.toHaveBeenCalled();
  const limited = createGoalHandler({
    origin,
    db,
    limiter: { check: async () => ({ allowed: false, retryAfterSeconds: 10 }) },
  });
  expect((await limited(request("goals"), ["goals"])).status).toBe(429);
  expect(db).not.toHaveBeenCalled();
});
it("bounds and strictly validates input; browser has no payment confirmation endpoint", async () => {
  const a = await socialActor(c.db, "Input owner"),
    handler = createGoalHandler({ origin, db: () => c.db });
  expect(
    (
      await handler(
        request("goals", a.token, "POST", {
          text: "Earn $100",
          environment: "demo",
          confirmedAmountMinor: 10000,
        }),
        ["goals"],
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handler(
        request("goals", a.token, "POST", {
          text: "x".repeat(17000),
          environment: "demo",
        }),
        ["goals"],
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await handler(
        request("payments", a.token, "POST", { amountMinor: 10000 }),
        ["payments"],
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await handler(
        request("policy", a.token, "PATCH", { communicationLimit: 100 }),
        ["policy"],
      )
    ).status,
  ).toBe(400);
  expect(
    (await handler(request("goals?profile_id=other", a.token), ["goals"]))
      .status,
  ).toBe(400);
  expect(
    (
      await handler(
        request("connections", a.token, "PATCH", { enabled: false }),
        ["connections"],
      )
    ).status,
  ).toBe(200);
  const connections = await (
    await handler(request("connections", a.token), ["connections"])
  ).json();
  expect(connections.connections[0].enabled).toBe(false);
  expect(
    connections.connections
      .slice(1)
      .every(
        (x: { enabled: boolean; available: boolean }) =>
          !x.enabled && !x.available,
      ),
  ).toBe(true);
});
