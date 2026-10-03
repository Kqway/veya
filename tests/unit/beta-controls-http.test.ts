import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackendHandlers } from "@/features/backend/http";
import { createAiHandlers } from "@/features/backend/ai-http";
import { createAnalyticsHandler } from "@/features/backend/analytics-http";
import { createNotificationHandler } from "@/features/notifications/http";
import { createSocialHandler } from "@/features/social/http";

const origin = "https://veya.test";
const request = (method = "POST") => new Request(`${origin}/api/test`, {
  method,
  headers: { origin, "content-type": "application/json" },
  ...(method === "GET" ? {} : { body: "malformed-json" }),
});
afterEach(() => vi.unstubAllEnvs());

function forbidden() {
  return vi.fn(() => { throw new Error("Expensive work must not run"); });
}

async function expectPaused(response: Response, code = "BETA_READ_ONLY") {
  expect(response.status).toBe(503);
  const messages: Record<string, string> = {
    BETA_READ_ONLY: "Приложение временно доступно только для просмотра. Попробуйте позже.",
    BETA_SIGNUPS_PAUSED: "Создание новых профилей временно приостановлено. Попробуйте позже.",
    BETA_SEEKING_PAUSED: "Создание новых объявлений о поиске компании временно приостановлено. Попробуйте позже.",
  };
  expect(await response.json()).toEqual({ error: { code, message: messages[code] } });
  expect(response.headers.get("cache-control")).toBe("no-store");
}

describe("closed beta direct HTTP controls", () => {
  it("rejects every coordination mutation before body, shared quota, or backend work", async () => {
    vi.stubEnv("BETA_READ_ONLY", "true");
    const backend = forbidden(), check = forbidden();
    const api = createBackendHandlers({ origin, secureCookie: false, backend, limiter: { check } });
    for (const response of [
      api.createSession(request()), api.createIntent(request()),
      api.joinIntent(request(), "a".repeat(24)), api.updateParticipant(request("PUT"), "a".repeat(24)),
      api.vote(request(), "a".repeat(24)), api.decide(request(), "a".repeat(24)),
      api.closeIntent(request("DELETE"), "a".repeat(24)),
    ]) await expectPaused(await response);
    expect(backend).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  it("rejects optional AI and analytics before quotas, bodies, providers, and clients", async () => {
    vi.stubEnv("BETA_READ_ONLY", "true");
    const tasks = forbidden(), backend = forbidden(), client = forbidden(), check = forbidden();
    const ai = createAiHandlers({ origin, tasks, backend, limiter: { check } });
    await expectPaused(await ai.parseIntent(request()));
    await expectPaused(await ai.assist(request(), "a".repeat(24)));
    await expectPaused(await createAnalyticsHandler({ origin, client, limiter: { check } })(request()));
    expect(tasks).not.toHaveBeenCalled(); expect(backend).not.toHaveBeenCalled();
    expect(client).not.toHaveBeenCalled(); expect(check).not.toHaveBeenCalled();
  });

  it("rejects notification writes before quotas, body, and database", async () => {
    vi.stubEnv("BETA_READ_ONLY", "true");
    const db = forbidden(), check = forbidden();
    const handler = createNotificationHandler({ origin, db, limiter: { check } });
    for (const [method, path] of [["POST", ["push"]], ["POST", ["a".repeat(24), "read"]]] as const)
      await expectPaused(await handler(request(method), [...path]));
    expect(db).not.toHaveBeenCalled(); expect(check).not.toHaveBeenCalled();
  });

  it("pauses only new profile creation and new seeking while reads and recovery dispatch remain", async () => {
    vi.stubEnv("BETA_SIGNUPS_ENABLED", "false");
    vi.stubEnv("BETA_SEEKING_ENABLED", "false");
    const db = forbidden(), tasks = forbidden(), check = forbidden();
    const handler = createSocialHandler({ origin, db, tasks });
    await expectPaused(await handler(request(), ["profile"]), "BETA_SIGNUPS_PAUSED");
    await expectPaused(await handler(request(), ["seeking"]), "BETA_SEEKING_PAUSED");
    expect(db).not.toHaveBeenCalled(); expect(tasks).not.toHaveBeenCalled();
    expect((await handler(request(), ["profile", "recover"])).status).toBe(400);
    expect((await handler(request("GET"), ["profile"])).status).toBe(503);
    expect(db).toHaveBeenCalledTimes(1);
    const guarded = createSocialHandler({ origin, db, tasks, limiter: { check } });
    await expectPaused(await guarded(request(), ["seeking"]), "BETA_SEEKING_PAUSED");
    expect(check).not.toHaveBeenCalled();
  });

  it("rejects social updates, recovery, keys, seeking closure, connections, chat, disclosures, plans, and AI before expensive work", async () => {
    vi.stubEnv("BETA_READ_ONLY", "true");
    const db = forbidden(), tasks = forbidden(), check = forbidden();
    const handler = createSocialHandler({ origin, db, tasks, limiter: { check } });
    const key = "a".repeat(24);
    for (const [method, path] of [
      ["POST", ["profile"]], ["PATCH", ["profile"]], ["POST", ["profile", "recover"]],
      ["POST", ["profile", "key"]], ["POST", ["seeking"]], ["DELETE", ["seeking", key]],
      ["POST", ["discover", key, "pass"]], ["POST", ["connections"]],
      ["POST", ["connections", key, "respond"]], ["POST", ["matches", key, "messages"]],
      ["POST", ["matches", key, "disclosures"]], ["POST", ["matches", key, "plan"]],
      ["POST", ["ai", "seeking"]],
    ] as const) await expectPaused(await handler(request(method), [...path]));
    expect(db).not.toHaveBeenCalled(); expect(tasks).not.toHaveBeenCalled(); expect(check).not.toHaveBeenCalled();
  });

  it("preserves foreign-origin rejection before beta policy and quotas", async () => {
    vi.stubEnv("BETA_READ_ONLY", "true");
    const backend = forbidden(), check = forbidden();
    const api = createBackendHandlers({ origin, secureCookie: false, backend, limiter: { check } });
    const response = await api.createIntent(new Request(`${origin}/api/intents`, { method: "POST", headers: { origin: "https://other.test" } }));
    expect(response.status).toBe(403);
    expect(check).not.toHaveBeenCalled(); expect(backend).not.toHaveBeenCalled();
  });
});
