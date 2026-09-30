import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAiHandlers } from "@/features/backend/ai-http";
import { VeyaBackend } from "@/features/backend/service";
import { createBackendHandlers } from "@/features/backend/http";
import { AiTasks } from "@/lib/ai/tasks";
import { MockAiProvider } from "@/lib/ai/mock-provider";
import type { AiRequest } from "@/lib/ai/types";
import { applyMigrations } from "@/lib/db/migrations";
import { startTestDatabase } from "../support/postgres";
import { parsedIntent, parseInput } from "../support/ai";
const origin = "http://localhost:3000";
function request(body: unknown, token?: string, suppliedOrigin = origin) {
  return new Request(`${origin}/api/ai/intent`, {
    method: "POST",
    headers: {
      origin: suppliedOrigin,
      "content-type": "application/json",
      ...(token ? { cookie: `veya_guest=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
describe("optional safe AI HTTP boundaries with PostgreSQL", () => {
  let cluster: Awaited<ReturnType<typeof startTestDatabase>>,
    backend: VeyaBackend;
  const mock = new MockAiProvider();
  beforeAll(async () => {
    cluster = await startTestDatabase();
    await applyMigrations(cluster.db);
  });
  afterAll(async () => cluster?.stop());
  beforeEach(async () => {
    await cluster.db.query(
      "TRUNCATE users, guest_participant_sessions, intents, analytics_events CASCADE",
    );
    backend = new VeyaBackend(cluster.db);
  });
  const handlers = (tasks = new AiTasks({ provider: mock })) =>
    createAiHandlers({ origin, backend: () => backend, tasks: () => tasks });
  async function group() {
    const owner = await backend.createSession(),
      member = await backend.createSession();
    const plan = await backend.createIntent(owner.token, {
        rawText: "Coffee together",
        structuredIntent: { activities: ["coffee"] },
      }),
      slug = plan.intent.publicSlug;
    const day = new Date(Date.now() + 2 * 86400000);
    day.setUTCHours(18, 0, 0, 0);
    await backend.joinIntent(member.token, slug, {
      displayName: "SECRET_PRIVATE_NAME",
      notes: "SECRET_PRIVATE_NOTE",
      budgetMax: 234567,
      currency: "USD",
      preferences: [
        { category: "dietary", value: "secret_private_preference" },
      ],
      availability: [
        {
          startAt: day.toISOString(),
          endAt: new Date(day.getTime() + 4 * 3600000).toISOString(),
        },
      ],
    });
    const results = await backend.getResults(slug),
      selection = {
        suggestionKey: results.suggestions[0]!.suggestionKey,
        revision: results.revision,
      };
    return { owner, member, slug, results, selection };
  }
  it("parses without a DB/session and uses no-store JSON", async () => {
    const api = createAiHandlers({
      origin,
      backend: () => {
        throw new Error("No database");
      },
      tasks: () => new AiTasks({ provider: mock }),
    });
    const response = await api.parseIntent(request(parseInput));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: parsedIntent,
      source: "mock",
    });
  });
  it("enforces input/origin/body/content boundaries before provider work", async () => {
    const api = handlers();
    expect(
      (
        await api.parseIntent(
          request(parseInput, undefined, "https://other.test"),
        )
      ).status,
    ).toBe(403);
    expect(
      (await api.parseIntent(request({ ...parseInput, guestId: "forged" })))
        .status,
    ).toBe(400);
    expect(
      (
        await api.parseIntent(
          request({ ...parseInput, text: "x".repeat(17000) }),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await api.parseIntent(
          new Request(origin, {
            method: "POST",
            headers: { origin, "content-type": "text/plain" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(415);
  });
  it("persists only reviewed valid advisory hints, while old intent bodies remain valid", async () => {
    const owner = await backend.createSession();
    const api = createBackendHandlers({
      backend: () => backend,
      origin,
      secureCookie: false,
    });
    const response = await api.createIntent(
      request(
        { rawText: parseInput.text, structuredIntent: parsedIntent },
        owner.token,
      ),
    );
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved.intent.structuredIntent).toEqual(parsedIntent);
    const legacy = await backend.createIntent(owner.token, {
      rawText: "Legacy idea",
    });
    expect(legacy.intent.structuredIntent).toEqual({
      type: "general",
      activities: [],
      location: null,
    });
    expect(
      (
        await api.createIntent(
          request(
            {
              rawText: "Wrong dates",
              structuredIntent: {
                ...parsedIntent,
                dateHint: {
                  startDate: "2026-10-02",
                  endDate: "2026-10-01",
                  text: "soon",
                },
              },
            },
            owner.token,
          ),
        )
      ).status,
    ).toBe(400);
  });
  it("allows creator/member ideas without changing proposal keys, revision or votes", async () => {
    const g = await group();
    await backend.vote(g.member.token, g.slug, {
      ...g.selection,
      value: "yes",
    });
    for (const token of [g.owner.token, g.member.token]) {
      const response = await handlers().assist(
        request(g.selection, token),
        g.slug,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ...g.selection,
        idea: { data: { title: expect.stringMatching(/coffee/i) } },
        explanation: { data: { explanation: expect.stringMatching(/All 1/) } },
      });
    }
    const after = await backend.getResults(g.slug, g.member.token);
    expect(after.revision).toBe(g.results.revision);
    expect(after.suggestions.map((p) => p.suggestionKey)).toEqual(
      g.results.suggestions.map((p) => p.suggestionKey),
    );
    expect(after.suggestions[0]?.ownVote).toBe("yes");
  });
  it("passes only minimal public data to both tasks, never participant/private fields", async () => {
    const g = await group(),
      received: AiRequest[] = [];
    const tasks = new AiTasks({
      provider: {
        name: "openai",
        complete: async (req, signal) => {
          received.push(req);
          return mock.complete(req, signal);
        },
      },
    });
    const response = await handlers(tasks).assist(
      request(g.selection, g.member.token),
      g.slug,
    );
    expect(response.status).toBe(200);
    expect(received).toHaveLength(2);
    expect(JSON.stringify(received)).not.toMatch(
      /SECRET_PRIVATE|secret_private|234567|guest|participant|suggestionKey|revision|budgetMax|notes|preferences|availableParticipantIds/,
    );
    for (const req of received)
      expect(Object.keys(req.input).sort()).toEqual(["intent", "proposal"]);
  });
  it("rejects outsiders, revoked sessions, forged fields and stale/cross-group keys", async () => {
    const g = await group(),
      outside = await backend.createSession(),
      api = handlers();
    expect((await api.assist(request(g.selection), g.slug)).status).toBe(401);
    expect(
      (await api.assist(request(g.selection, outside.token), g.slug)).status,
    ).toBe(403);
    expect(
      (
        await api.assist(
          request({ ...g.selection, participantId: "forged" }, g.member.token),
          g.slug,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await api.assist(
          request(
            { ...g.selection, revision: g.selection.revision + 1 },
            g.member.token,
          ),
          g.slug,
        )
      ).status,
    ).toBe(409);
    const other = await group();
    expect(
      (
        await api.assist(
          request(
            { ...g.selection, suggestionKey: other.selection.suggestionKey },
            g.member.token,
          ),
          g.slug,
        )
      ).status,
    ).toBe(409);
    await backend.revokeSession(g.member.token);
    expect(
      (await api.assist(request(g.selection, g.member.token), g.slug)).status,
    ).toBe(401);
  });
  it("releases DB locks during generation and rejects a revision change before returning", async () => {
    const g = await group();
    let start!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
        start = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    const tasks = new AiTasks({
      provider: {
        name: "openai",
        complete: async (req, signal) => {
          start();
          await gate;
          return mock.complete(req, signal);
        },
      },
    });
    const pending = handlers(tasks).assist(
      request(g.selection, g.member.token),
      g.slug,
    );
    try {
      await started;
      await cluster.db.transaction(async (tx) => {
        await tx.query("SET LOCAL lock_timeout='300ms'");
        await tx.query(
          "SELECT id FROM intents WHERE public_slug=$1 FOR UPDATE",
          [g.slug],
        );
      });
      const own = (await backend.getIntent(g.slug, g.member.token))
        .ownParticipant!;
      await backend.updateParticipant(g.member.token, g.slug, {
        ...own,
        displayName: "Changed",
      });
    } finally {
      release();
    }
    const response = await pending;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "STALE_RESULTS" },
    });
  });
  it("rechecks credentials after generation and keeps provider failures safe", async () => {
    const g = await group();
    let start!: () => void, release!: () => void;
    const started = new Promise<void>((r) => {
        start = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const tasks = new AiTasks({
      provider: {
        name: "openai",
        complete: async (req, signal) => {
          start();
          await gate;
          return mock.complete(req, signal);
        },
      },
    });
    const pending = handlers(tasks).assist(
      request(g.selection, g.member.token),
      g.slug,
    );
    try {
      await started;
      await backend.revokeSession(g.member.token);
    } finally {
      release();
    }
    expect((await pending).status).toBe(401);
    const broken = new AiTasks({
      provider: {
        name: "openai",
        complete: async () => {
          throw new Error("SECRET error");
        },
      },
    });
    const response = await handlers(broken).assist(
      request(g.selection, g.owner.token),
      g.slug,
    );
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("SECRET");
  });
  it("can explain frozen and expired saved options without reopening them", async () => {
    const g = await group();
    await backend.decide(g.owner.token, g.slug, g.selection);
    expect(
      (await handlers().assist(request(g.selection, g.member.token), g.slug))
        .status,
    ).toBe(200);
    expect((await backend.getResults(g.slug)).selectedSuggestionKey).toBe(
      g.selection.suggestionKey,
    );
    const other = await group();
    await backend.closeIntent(other.owner.token, other.slug);
    expect(
      (
        await handlers().assist(
          request(other.selection, other.owner.token),
          other.slug,
        )
      ).status,
    ).toBe(200);
    expect((await backend.getResults(other.slug)).intent.status).toBe(
      "expired",
    );
  });
});
