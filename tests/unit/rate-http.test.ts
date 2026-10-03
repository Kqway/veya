import { describe, expect, it, vi } from "vitest";
import { FixedWindowLimiter } from "@/lib/security/rate-limit";
import { createBackendHandlers } from "@/features/backend/http";
import { createAiHandlers } from "@/features/backend/ai-http";
import { createAnalyticsHandler } from "@/features/backend/analytics-http";
import { AiTasks } from "@/lib/ai/tasks";
import { MockAiProvider } from "@/lib/ai/mock-provider";
import type { VeyaBackend } from "@/features/backend/service";
const origin = "http://localhost:3000";
const request = (path: string, body: unknown, requestOrigin = origin) =>
  new Request(origin + path, {
    method: "POST",
    headers: { origin: requestOrigin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
describe("rate limiting HTTP boundaries", () => {
  it("rejects quota exhaustion before guest database work and leaves foreign origin outside quotas", async () => {
    const factory = vi.fn(
      () =>
        ({
          getSession: async () => null,
          createSession: async () => ({
            token: "a".repeat(43),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          }),
        }) as unknown as VeyaBackend,
    );
    const handlers = createBackendHandlers({
      origin,
      secureCookie: false,
      backend: factory,
      limiter: new FixedWindowLimiter({
        policies: { session: { global: 1, guest: 1 } },
      }),
    });
    expect(
      (
        await handlers.createSession(
          request("/api/session", {}, "https://evil.test"),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handlers.createSession(request("/api/session", {}))).status,
    ).toBe(201);
    const calls = factory.mock.calls.length;
    const rejected = await handlers.createSession(request("/api/session", {}));
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toEqual({ error: { code: "RATE_LIMITED", message: "Слишком много запросов. Немного подождите и попробуйте снова." } });
    expect(rejected.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(rejected.headers.get("cache-control")).toBe("no-store");
    expect(factory).toHaveBeenCalledTimes(calls);
  });
  it("limits stateless parsing before invoking any provider", async () => {
    const complete = vi.fn(
      new MockAiProvider().complete.bind(new MockAiProvider()),
    );
    const tasks = new AiTasks({ provider: { name: "mock", complete } });
    const handlers = createAiHandlers({
      origin,
      tasks: () => tasks,
      backend: () => {
        throw new Error("No DB");
      },
      limiter: new FixedWindowLimiter({
        policies: { ai: { global: 1, guest: 1 } },
      }),
    });
    const body = {
      text: "Coffee",
      referenceDate: "2026-10-01",
      timeZone: "UTC",
    };
    expect(
      (await handlers.parseIntent(request("/api/ai/intent", body))).status,
    ).toBe(200);
    expect(
      (await handlers.parseIntent(request("/api/ai/intent", body))).status,
    ).toBe(429);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("limits analytics independently before database tracking", async () => {
    const track = vi.fn(async () => {});
    const handler = createAnalyticsHandler({
      origin,
      client: () => ({ track }),
      limiter: new FixedWindowLimiter({
        policies: { analytics: { global: 1, guest: 1 } },
      }),
    });
    const body = { name: "landing_view", surface: "landing" };
    expect((await handler(request("/api/analytics", body))).status).toBe(200);
    expect((await handler(request("/api/analytics", body))).status).toBe(429);
    expect(track).toHaveBeenCalledTimes(1);
  });
});
