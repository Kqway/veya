import { beforeAll, afterAll, it, expect } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { createGuestSession } from "@/features/backend/sessions";
import { createSocialHandler } from "@/features/social/http";
import { AiTasks } from "@/lib/ai/tasks";
import { MockAiProvider } from "@/lib/ai/mock-provider";
import { seekingInput, forbiddenKeys } from "../support/social";
let c: Awaited<ReturnType<typeof startTestDatabase>>;
let handler: ReturnType<typeof createSocialHandler>;
const origin = "http://localhost:3000";
beforeAll(async () => {
  c = await startTestDatabase();
  await applyMigrations(c.db);
  handler = createSocialHandler({
    origin,
    db: () => c.db,
    tasks: () => new AiTasks({ provider: new MockAiProvider() }),
  });
});
afterAll(async () => {
  if (c) await c.stop();
});
async function req(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
) {
  return handler(
    new Request(origin + "/api/social/" + path, {
      method,
      headers: {
        origin,
        "content-type": "application/json",
        cookie: "veya_guest=" + token,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split("?")[0]!.split("/"),
  );
}
it("authenticates social flow and uses explicit no-store projections", async () => {
  const a = (await createGuestSession(c.db)).token;
  const b = (await createGuestSession(c.db)).token;
  expect((await req("profile", "")).status).toBe(401);
  const created = await req("profile", a, "POST", {
    alias: "SecretA",
    privacyMode: "INCOGNITO",
    adultConfirmed: true,
  });
  const own = await created.json();
  expect(created.status).toBe(201);
  expect(own.recoveryKey).toMatch(/^[\w-]{43}$/);
  const get = await req("profile", a);
  expect(get.headers.get("cache-control")).toBe("no-store");
  const profile = await get.json();
  expect(profile).toHaveProperty("profile.alias", "SecretA");
  expect(JSON.stringify(profile)).not.toMatch(
    /recoveryKey|hash|profile_id|guest_id/,
  );
  const update = await req("profile", a, "PATCH", { alias: "NewA" });
  expect(await update.json()).toHaveProperty("profile.alias", "NewA");
  await req("profile", b, "POST", {
    alias: "SecretB",
    privacyMode: "INCOGNITO",
    adultConfirmed: true,
  });
  const pa = await (await req("seeking", a, "POST", seekingInput())).json();
  await req("seeking", b, "POST", seekingInput());
  const cards = await (await req("discover?source=" + pa.publicKey, a)).json();
  expect(forbiddenKeys(cards)).toEqual([]);
  expect(cards.cards).toHaveLength(1);
  const request = await (
    await req("connections", a, "POST", { handle: cards.cards[0].handle })
  ).json();
  const accepted = await (
    await req("connections/" + request.publicKey + "/respond", b, "POST", {
      action: "accept",
    })
  ).json();
  expect(accepted.matchKey).toMatch(/^[\w-]{24}$/);
  const message = await (
    await req("matches/" + accepted.matchKey + "/messages", a, "POST", {
      text: "<script>plain</script>",
    })
  ).json();
  expect(forbiddenKeys(message)).toEqual([]);
  expect(message.text).toBe("<script>plain</script>");
  const payload = await (await req("matches/" + accepted.matchKey, b)).json();
  expect(forbiddenKeys(payload)).toEqual([]);
  expect(payload.identity.alias).not.toBe("NewA");
  expect(
    (await req("matches/" + accepted.matchKey + "/messages?limit=999", a))
      .status,
  ).toBe(400);
  expect(
    (await req("profile", a, "PATCH", { profileId: "spoof" })).status,
  ).toBe(400);
  expect((await req("not-an-endpoint", a)).status).toBe(404);
});
it("parser sends only own bounded input and works without database candidates", async () => {
  const a = (await createGuestSession(c.db)).token;
  const out = await req("ai/seeking", a, "POST", {
    text: "Ищу человека сыграть в шахматы в Москве, средний уровень",
    referenceDate: "2026-10-01",
    timeZone: "Europe/Moscow",
  });
  expect(out.status).toBe(200);
  const body = await out.json();
  expect(body.data).toMatchObject({
    activityKey: "chess",
    city: "Moscow",
    skill: "intermediate",
  });
  expect(
    (
      await req("ai/seeking", a, "POST", {
        text: "Chess",
        referenceDate: "2026-10-01",
        timeZone: "UTC",
        candidateProfiles: [],
      })
    ).status,
  ).toBe(400);
});
