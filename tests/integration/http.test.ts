import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VeyaBackend } from "@/features/backend/service";
import { createBackendHandlers } from "@/features/backend/http";
import { applyMigrations } from "@/lib/db/migrations";
import { startTestDatabase } from "../support/postgres";

const origin = "https://veya.example";
function request(
  method: string,
  body?: unknown,
  cookie?: string,
  requestOrigin = origin,
) {
  const headers: Record<string, string> = {
    Origin: requestOrigin,
    "Content-Type": "application/json",
  };
  if (cookie) headers.Cookie = cookie;
  return new Request(`${origin}/api/test`, {
    method,
    headers,
    ...(method !== "GET" && method !== "DELETE"
      ? { body: JSON.stringify(body ?? {}) }
      : {}),
  });
}

describe("HTTP authorization boundary with native PostgreSQL", () => {
  let cluster: Awaited<ReturnType<typeof startTestDatabase>>;
  let backend: VeyaBackend;
  let api: ReturnType<typeof createBackendHandlers>;
  beforeAll(async () => {
    cluster = await startTestDatabase();
    await applyMigrations(cluster.db);
  });
  afterAll(async () => {
    if (cluster) await cluster.stop();
  });
  beforeEach(async () => {
    await cluster.db.query(
      "TRUNCATE guest_participant_sessions,intents,analytics_events CASCADE",
    );
    backend = new VeyaBackend(cluster.db);
    api = createBackendHandlers({
      backend: () => backend,
      origin,
      secureCookie: true,
    });
  });

  it("exposes bounded result/vote/decision routes with stale and origin protection", async () => {
    const owner = await backend.createSession(),
      guest = await backend.createSession();
    const v = await backend.createIntent(owner.token, { rawText: "Coffee" }),
      slug = v.intent.publicSlug;
    const start = new Date(Date.now() + 86400000).toISOString(),
      end = new Date(Date.now() + 86400000 + 3 * 3600000).toISOString();
    await backend.joinIntent(guest.token, slug, {
      displayName: "Sam",
      availability: [{ startAt: start, endAt: end }],
    });
    const response = await api.getResults(
      request("GET", undefined, `veya_guest=${guest.token}`),
      slug,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const r = await response.json(),
      body = {
        suggestionKey: r.suggestions[0].suggestionKey,
        revision: r.revision,
        value: "yes",
      };
    expect(
      (
        await api.vote(
          request(
            "POST",
            body,
            `veya_guest=${guest.token}`,
            "https://evil.example",
          ),
          slug,
        )
      ).status,
    ).toBe(403);
    expect((await api.vote(request("POST", body), slug)).status).toBe(401);
    expect(
      (
        await api.vote(
          request(
            "POST",
            { ...body, revision: body.revision + 1 },
            `veya_guest=${guest.token}`,
          ),
          slug,
        )
      ).status,
    ).toBe(409);
    expect(
      (await api.vote(request("POST", body, `veya_guest=${guest.token}`), slug))
        .status,
    ).toBe(200);
    const decision = {
      suggestionKey: body.suggestionKey,
      revision: body.revision,
    };
    expect(
      (
        await api.decide(
          request("POST", decision, `veya_guest=${guest.token}`),
          slug,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api.decide(
          request("POST", decision, `veya_guest=${owner.token}`),
          slug,
        )
      ).status,
    ).toBe(200);
  });
  it("sets a private secure cookie and reuses it without exposing the token", async () => {
    const response = await api.createSession(request("POST"));
    expect(response.status).toBe(201);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/veya_guest=[A-Za-z0-9_-]{43}/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Secure/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ authenticated: true });
    const reused = await api.createSession(
      request("POST", {}, cookie.split(";")[0]),
    );
    expect(reused.status).toBe(200);
    expect(JSON.stringify(await reused.json())).not.toMatch(
      /token|guestId|hash/,
    );
    expect(
      (await cluster.db.query("SELECT * FROM guest_participant_sessions"))
        .rowCount,
    ).toBe(1);
  });

  it("requires a session cookie for writes", async () => {
    const response = await api.createIntent(
      request("POST", { rawText: "Coffee" }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("rejects cross-origin and absent-origin mutations before writing", async () => {
    expect(
      (
        await api.createSession(
          request("POST", {}, undefined, "https://evil.example"),
        )
      ).status,
    ).toBe(403);
    const missing = new Request(`${origin}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect((await api.createSession(missing)).status).toBe(403);
    expect(
      (await cluster.db.query("SELECT * FROM guest_participant_sessions"))
        .rowCount,
    ).toBe(0);
  });

  it("rejects malformed, wrong-type and oversized JSON including streamed bodies", async () => {
    const headers = { Origin: origin, "Content-Type": "application/json" };
    expect(
      (
        await api.createIntent(
          new Request(`${origin}/api/intents`, {
            method: "POST",
            headers,
            body: "{bad",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await api.createIntent(
          new Request(`${origin}/api/intents`, {
            method: "POST",
            headers: { Origin: origin, "Content-Type": "text/plain" },
            body: "x",
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await api.createIntent(
          new Request(`${origin}/api/intents`, {
            method: "POST",
            headers,
            body: JSON.stringify({ rawText: "a".repeat(17_000) }),
          }),
        )
      ).status,
    ).toBe(413);
  });

  it("creates, reads, joins and updates without accounts or internal IDs", async () => {
    const owner = await backend.createSession();
    const created = await api.createIntent(
      request(
        "POST",
        { rawText: "Game night", creatorName: "Sam" },
        `veya_guest=${owner.token}`,
      ),
    );
    expect(created.status).toBe(201);
    const view = await created.json();
    const slug = view.intent.publicSlug as string;
    const guest = await backend.createSession();
    const cookie = `veya_guest=${guest.token}`;
    expect(
      (
        await api.joinIntent(
          request(
            "POST",
            { displayName: "Alex", notes: "keep private" },
            cookie,
          ),
          slug,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await api.joinIntent(
          request("POST", { displayName: "Alex" }, cookie),
          slug,
        )
      ).status,
    ).toBe(200);
    const publicView = await (await api.getIntent(request("GET"), slug)).json();
    expect(publicView.intent.participantCount).toBe(1);
    expect(JSON.stringify(publicView)).not.toMatch(
      /keep private|"id":|guest_id|token_hash/,
    );
    const updated = await api.updateParticipant(
      request("PUT", { displayName: "Alex updated" }, cookie),
      slug,
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).ownParticipant.displayName).toBe(
      "Alex updated",
    );
    expect(
      (await api.closeIntent(request("DELETE", undefined, cookie), slug))
        .status,
    ).toBe(403);
    expect(
      (
        await api.closeIntent(
          request("DELETE", undefined, `veya_guest=${owner.token}`),
          slug,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await api.joinIntent(
          request("POST", { displayName: "Alex" }, cookie),
          slug,
        )
      ).status,
    ).toBe(410);
  });

  it("revokes the server session and clears the browser cookie", async () => {
    const guest = await backend.createSession();
    const cookie = `veya_guest=${guest.token}`;
    const response = await api.revokeSession(
      request("DELETE", undefined, cookie),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(
      (await api.createIntent(request("POST", { rawText: "x" }, cookie)))
        .status,
    ).toBe(401);
  });

  it("normalizes accepted far-offset timestamps before PostgreSQL writes", async () => {
    const guest = await backend.createSession();
    const view = await backend.createIntent(guest.token, {
      rawText: "Offset boundary",
    });
    const start = new Date(Date.now() + 24 * 3_600_000);
    const end = new Date(start.getTime() + 3_600_000);
    const offset = (date: Date) =>
      new Date(date.getTime() + 16 * 3_600_000)
        .toISOString()
        .replace("Z", "+16:00");
    const response = await api.joinIntent(
      request(
        "POST",
        {
          displayName: "Offset guest",
          availability: [{ startAt: offset(start), endAt: offset(end) }],
        },
        `veya_guest=${guest.token}`,
      ),
      view.intent.publicSlug,
    );
    expect(response.status).toBe(201);
    expect((await response.json()).ownParticipant.availability).toEqual([
      { startAt: start.toISOString(), endAt: end.toISOString() },
    ]);
  });

  it("uses safe service-unavailable errors when the database cannot be acquired", async () => {
    const failing = createBackendHandlers({
      backend: () => {
        throw new Error("postgres://private-password@host");
      },
      origin,
      secureCookie: false,
    });
    const response = await failing.createSession(request("POST"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The service is temporarily unavailable.",
      },
    });
  });
});
