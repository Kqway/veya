import { it, expect, vi } from "vitest";
import { createSocialHandler } from "@/features/social/http";
import { FixedWindowLimiter } from "@/lib/security/rate-limit";
const origin = "http://localhost:3000";
it("social quotas stop before body/database/provider work and reject foreign origin without quotas", async () => {
  const db = vi.fn(() => {
    throw new Error("MUST NOT ACCESS");
  });
  const tasks = vi.fn(() => {
    throw new Error("MUST NOT CALL");
  });
  const handler = createSocialHandler({
    origin,
    db,
    tasks,
    limiter: new FixedWindowLimiter({
      policies: {
        recovery: { global: 1, guest: 1 },
        message: { global: 1, guest: 1 },
        discovery: { global: 1, guest: 1 },
        ai: { global: 1, guest: 1 },
      },
    }),
  });
  const send = (path: string, foreign = false) =>
    handler(
      new Request(origin + "/api/social/" + path, {
        method: "POST",
        headers: {
          origin: foreign ? "https://evil.test" : origin,
          "content-type": "application/json",
        },
        body: "{}",
      }),
      path.split("/"),
    );
  expect((await send("profile/recover", true)).status).toBe(403);
  expect((await send("profile/recover")).status).toBe(503);
  expect(db).toHaveBeenCalledTimes(1);
  const denied = await send("profile/recover");
  expect(denied.status).toBe(429);
  expect(denied.headers.get("retry-after")).toMatch(/^\d+$/);
  expect(db).toHaveBeenCalledTimes(1);
  await send("matches/" + "a".repeat(24) + "/messages");
  await send("matches/" + "a".repeat(24) + "/messages");
  expect(db).toHaveBeenCalledTimes(2);
  await send("ai/seeking");
  expect(tasks).toHaveBeenCalledTimes(1);
  expect((await send("ai/seeking")).status).toBe(429);
  expect(tasks).toHaveBeenCalledTimes(1);
  expect(denied.headers.get("cache-control")).toBe("no-store");
});
