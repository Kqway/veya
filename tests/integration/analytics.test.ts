import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { createDatabaseAnalyticsClient } from "@/lib/analytics/postgres";
import { createAnalyticsHandler } from "@/features/backend/analytics-http";
let database: Awaited<ReturnType<typeof startTestDatabase>>;
beforeAll(async () => {
  database = await startTestDatabase();
  await applyMigrations(database.db);
});
afterAll(async () => database?.stop());
const request = (body: unknown, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/analytics", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
describe("optional browser analytics", () => {
  it("accepts bounded event/surface pairs with no personal fields", async () => {
    const handler = createAnalyticsHandler({
      origin: "http://localhost:3000",
      client: () => createDatabaseAnalyticsClient(database.db),
    });
    for (const [name, surface] of [
      ["landing_view", "landing"],
      ["intent_started", "create"],
      ["invite_opened", "invite"],
      ["invite_link_copied", "invite"],
      ["result_viewed", "result"],
      ["new_intent_from_invite", "invite"],
      ["new_intent_from_invite", "result"],
    ])
      expect((await handler(request({ name, surface }))).status).toBe(200);
    for (const data of [
      { name: "landing_view", surface: "invite" },
      { name: "new_intent_from_invite", surface: "landing" },
      { name: "new_intent_from_invite", surface: "result", slug: "private" },
      { name: "intent_created", surface: "create" },
      { name: "vote_submitted", surface: "result" },
      { name: "invite_opened", surface: "invite", notes: "private" },
    ])
      expect((await handler(request(data))).status).toBe(400);
    expect(
      (
        await handler(
          request(
            { name: "landing_view", surface: "landing" },
            "https://other.test",
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (await database.db.query("SELECT * FROM analytics_events")).rowCount,
    ).toBe(7);
  });
  it("disabled tracking needs no database and database failures remain safe", async () => {
    const handler = createAnalyticsHandler({
      origin: "http://localhost:3000",
      client: () => null,
    });
    expect(
      (await handler(request({ name: "landing_view", surface: "landing" })))
        .status,
    ).toBe(200);
    const broken = createAnalyticsHandler({
      origin: "http://localhost:3000",
      client: () => ({
        track: async () => {
          throw new Error("secret driver details");
        },
      }),
    });
    const response = await broken(
      request({ name: "landing_view", surface: "landing" }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
