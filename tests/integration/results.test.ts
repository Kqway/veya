import { createHash } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { VeyaBackend } from "@/features/backend/service";
import { applyMigrations } from "@/lib/db/migrations";
import { startTestDatabase } from "../support/postgres";
const date = new Date(Date.now() + 2 * 86400000);
date.setUTCHours(0, 0, 0, 0);
const at = (hour: number) =>
  new Date(date.getTime() + hour * 3600000).toISOString();
const data = (displayName: string) => ({
  displayName,
  availability: [{ startAt: at(18), endAt: at(22) }],
  notes: "private note",
  budgetMin: 0,
  budgetMax: 2000,
  currency: "USD",
  preferences: [{ category: "activity", value: "Coffee" }],
});
describe("durable scheduling and guest decisions", () => {
  let cluster: Awaited<ReturnType<typeof startTestDatabase>>,
    backend: VeyaBackend;
  beforeAll(async () => {
    cluster = await startTestDatabase();
    await applyMigrations(cluster.db);
  });
  afterAll(async () => cluster?.stop());
  beforeEach(async () => {
    await cluster.db.query(
      "TRUNCATE users, guest_participant_sessions, intents, analytics_events CASCADE",
    );
    backend = new VeyaBackend(cluster.db, { analyticsEnabled: true });
  });
  async function group() {
    const owner = await backend.createSession(),
      alice = await backend.createSession(),
      bob = await backend.createSession();
    const view = await backend.createIntent(owner.token, {
      rawText: "Coffee together",
      creatorName: "Artem",
      structuredIntent: { activities: ["coffee"] },
    });
    const slug = view.intent.publicSlug;
    await backend.joinIntent(alice.token, slug, data("Alice"));
    await backend.joinIntent(bob.token, slug, data("Bob"));
    return { owner, alice, bob, slug };
  }
  it("persists stable proposal keys and preserves votes on repeated results", async () => {
    const g = await group(),
      result = await backend.getResults(g.slug, g.alice.token),
      first = result.suggestions[0]!;
    expect(result.intent.status).toBe("ready");
    expect(first.suggestionKey).toMatch(/^[a-f0-9]{32}$/);
    expect(first.availableCount).toBe(2);
    await backend.vote(g.alice.token, g.slug, {
      suggestionKey: first.suggestionKey,
      revision: result.revision,
      value: "yes",
    });
    const repeated = await backend.getResults(g.slug, g.alice.token);
    expect(repeated.revision).toBe(result.revision);
    expect(repeated.suggestions.map((p) => p.suggestionKey)).toEqual(
      result.suggestions.map((p) => p.suggestionKey),
    );
    expect(repeated.suggestions[0]).toMatchObject({
      ownVote: "yes",
      votes: { yes: 1, maybe: 0, no: 0 },
    });
  });
  it("shows public counts and own data, with derived names only to members/creator", async () => {
    const g = await group(),
      outside = await backend.createSession();
    for (const token of [undefined, outside.token]) {
      const result = await backend.getResults(g.slug, token);
      expect(result.suggestions[0]?.availableCount).toBe(2);
      expect(result.canVote).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(
        /Alice|Bob|private note|budgetMin|guest_id|participant_id|availableParticipantIds/,
      );
      expect(result.suggestions[0]?.attendance).toBeUndefined();
    }
    const member = await backend.getResults(g.slug, g.alice.token);
    expect(member.suggestions[0]?.attendance).toEqual([
      { displayName: "Alice", status: "available" },
      { displayName: "Bob", status: "available" },
    ]);
    expect(
      (await backend.getResults(g.slug, g.owner.token)).suggestions[0]
        ?.attendance,
    ).toHaveLength(2);
    expect(JSON.stringify(member.suggestions)).not.toMatch(
      /private note|budgetMin|guest_id|participant_id|"id":/,
    );
  });
  it("keeps private activity preferences out of anonymous suggestions without public activities", async () => {
    const owner = await backend.createSession(),
      alice = await backend.createSession(),
      bob = await backend.createSession();
    const plan = await backend.createIntent(owner.token, {
        rawText: "Let's meet",
      }),
      slug = plan.intent.publicSlug;
    await backend.joinIntent(alice.token, slug, {
      ...data("Alice"),
      preferences: [
        { category: "activity", value: "private sensitive activity" },
      ],
    });
    await backend.joinIntent(bob.token, slug, {
      ...data("Bob"),
      preferences: [],
    });
    const result = await backend.getResults(slug);
    expect(result.suggestions[0]?.activity).toBeNull();
    expect(JSON.stringify(result)).not.toContain("private sensitive activity");
  });
  it("upserts one vote, counts yes/maybe/no and tracks only changed votes", async () => {
    const g = await group(),
      r = await backend.getResults(g.slug),
      p = r.suggestions[0]!,
      body = {
        suggestionKey: p.suggestionKey,
        revision: r.revision,
        value: "yes",
      };
    await backend.vote(g.alice.token, g.slug, body);
    await backend.vote(g.alice.token, g.slug, body);
    await backend.vote(g.alice.token, g.slug, { ...body, value: "no" });
    const result = await backend.vote(g.bob.token, g.slug, {
      ...body,
      value: "maybe",
    });
    expect(result.suggestions[0]?.votes).toEqual({ yes: 0, maybe: 1, no: 1 });
    expect((await cluster.db.query("SELECT * FROM votes")).rowCount).toBe(2);
    expect(
      (
        await cluster.db.query(
          "SELECT * FROM analytics_events WHERE event_name='vote_submitted'",
        )
      ).rowCount,
    ).toBe(3);
  });
  it("rejects outsiders, forged identity fields and cross-intent proposal keys", async () => {
    const g = await group(),
      r = await backend.getResults(g.slug),
      outside = await backend.createSession();
    const body = {
      suggestionKey: r.suggestions[0]!.suggestionKey,
      revision: r.revision,
      value: "yes",
    };
    await expect(
      backend.vote(outside.token, g.slug, body),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      backend.vote(g.alice.token, g.slug, { ...body, participantId: "forged" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const other = await group(),
      r2 = await backend.getResults(other.slug);
    await expect(
      backend.vote(g.alice.token, g.slug, {
        ...body,
        suggestionKey: r2.suggestions[0]!.suggestionKey,
      }),
    ).rejects.toMatchObject({ code: "STALE_RESULTS" });
  });
  it("rejects revoked/expired sessions and expired invites", async () => {
    const g = await group(),
      r = await backend.getResults(g.slug),
      body = {
        suggestionKey: r.suggestions[0]!.suggestionKey,
        revision: r.revision,
        value: "yes",
      };
    await backend.revokeSession(g.alice.token);
    await expect(
      backend.vote(g.alice.token, g.slug, body),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await cluster.db.query(
      "UPDATE guest_participant_sessions SET created_at=NOW()-interval '2 days', expires_at=NOW()-interval '1 hour' WHERE token_hash=$1",
      [createHash("sha256").update(g.bob.token).digest("hex")],
    );
    await expect(backend.vote(g.bob.token, g.slug, body)).rejects.toMatchObject(
      { code: "UNAUTHORIZED" },
    );
    await backend.joinIntent(g.owner.token, g.slug, data("Artem"));
    await backend.closeIntent(g.owner.token, g.slug);
    await expect(
      backend.vote(g.owner.token, g.slug, body),
    ).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
    expect((await backend.getResults(g.slug)).intent.status).toBe("expired");
  });
  it("regenerates after updates and rejects old revisions/keys", async () => {
    const g = await group(),
      before = await backend.getResults(g.slug, g.alice.token),
      body = {
        suggestionKey: before.suggestions[0]!.suggestionKey,
        revision: before.revision,
        value: "yes",
      };
    await backend.vote(g.alice.token, g.slug, body);
    await backend.updateParticipant(g.bob.token, g.slug, {
      ...data("Bob"),
      availability: [{ startAt: at(9), endAt: at(12) }],
    });
    await expect(
      backend.vote(g.alice.token, g.slug, body),
    ).rejects.toMatchObject({ code: "STALE_RESULTS" });
    const after = await backend.getResults(g.slug, g.alice.token);
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.suggestions[0]?.availableCount).toBe(1);
    expect((await cluster.db.query("SELECT * FROM votes")).rowCount).toBe(0);
  });
  it("handles concurrent result reads and votes with one stable proposal set", async () => {
    const g = await group(),
      reads = await Promise.all([
        backend.getResults(g.slug),
        backend.getResults(g.slug),
      ]);
    expect(reads[0]?.suggestions[0]?.suggestionKey).toBe(
      reads[1]?.suggestions[0]?.suggestionKey,
    );
    const r = reads[0]!,
      body = {
        suggestionKey: r.suggestions[0]!.suggestionKey,
        revision: r.revision,
        value: "yes",
      };
    await Promise.all([
      backend.vote(g.alice.token, g.slug, body),
      backend.vote(g.bob.token, g.slug, body),
    ]);
    expect((await backend.getResults(g.slug)).suggestions[0]?.votes.yes).toBe(
      2,
    );
  });
  it("recomputes elapsed proposals, discards their votes and never returns past times", async () => {
    const g = await group(),
      before = await backend.getResults(g.slug),
      first = before.suggestions[0]!;
    await backend.vote(g.alice.token, g.slug, {
      suggestionKey: first.suggestionKey,
      revision: before.revision,
      value: "yes",
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.parse(first.window.endAt) + 60_000));
      const after = await backend.getResults(g.slug);
      expect(after.revision).toBeGreaterThan(before.revision);
      expect(after.suggestions.length).toBeGreaterThan(0);
      for (const proposal of after.suggestions) {
        expect(Date.parse(proposal.window.startAt)).toBeGreaterThanOrEqual(
          Date.now(),
        );
        expect(proposal.suggestionKey).not.toBe(first.suggestionKey);
        expect(proposal.votes).toEqual({ yes: 0, maybe: 0, no: 0 });
      }
      expect((await cluster.db.query("SELECT * FROM votes")).rowCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("persists votes without analytics when tracking is disabled", async () => {
    const g = await group();
    backend = new VeyaBackend(cluster.db);
    const r = await backend.getResults(g.slug);
    await backend.vote(g.alice.token, g.slug, {
      suggestionKey: r.suggestions[0]!.suggestionKey,
      revision: r.revision,
      value: "yes",
    });
    expect((await cluster.db.query("SELECT * FROM votes")).rowCount).toBe(1);
    expect(
      (
        await cluster.db.query(
          "SELECT * FROM analytics_events WHERE event_name='vote_submitted'",
        )
      ).rowCount,
    ).toBe(0);
  });
  it("allows creator-only confirmation and freezes the decided result", async () => {
    const g = await group(),
      r = await backend.getResults(g.slug),
      body = {
        suggestionKey: r.suggestions[0]!.suggestionKey,
        revision: r.revision,
      };
    await expect(
      backend.decide(g.alice.token, g.slug, body),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const decided = await backend.decide(g.owner.token, g.slug, body);
    expect(decided.intent.status).toBe("decided");
    expect(decided.selectedSuggestionKey).toBe(body.suggestionKey);
    expect(
      (await backend.decide(g.owner.token, g.slug, body)).selectedSuggestionKey,
    ).toBe(body.suggestionKey);
    await expect(
      backend.vote(g.alice.token, g.slug, { ...body, value: "yes" }),
    ).rejects.toMatchObject({ code: "INTENT_CLOSED" });
    await expect(
      backend.updateParticipant(g.bob.token, g.slug, data("Bob")),
    ).rejects.toMatchObject({ code: "INTENT_CLOSED" });
    expect(
      (await backend.getResults(g.slug)).suggestions.map(
        (p) => p.suggestionKey,
      ),
    ).toEqual(r.suggestions.map((p) => p.suggestionKey));
  });
  it("has useful empty and disjoint-availability states", async () => {
    const owner = await backend.createSession(),
      v = await backend.createIntent(owner.token, { rawText: "A plan" });
    const empty = await backend.getResults(v.intent.publicSlug);
    expect(empty.suggestions).toEqual([]);
    expect(empty.message).toMatch(/availability/i);
    expect(empty.intent.status).toBe("collecting");
    const g = await group();
    await backend.updateParticipant(g.bob.token, g.slug, {
      ...data("Bob"),
      availability: [],
    });
    const r = await backend.getResults(g.slug);
    expect(r.summary).toMatchObject({
      participantsWithAvailability: 1,
      participantsMissingAvailability: 1,
    });
    expect(r.message).toMatch(/1 of 2/);
  });
  it("preserves the selected alternative when the collection deadline passes or the organizer closes it", async () => {
    const g = await group(),
      r = await backend.getResults(g.slug),
      selected = r.suggestions[1]!;
    const body = {
      suggestionKey: selected.suggestionKey,
      revision: r.revision,
    };
    await backend.decide(g.owner.token, g.slug, body);
    await cluster.db.query(
      "UPDATE intents SET created_at=NOW()-interval '2 days', expires_at=NOW()-interval '1 hour' WHERE public_slug=$1",
      [g.slug],
    );
    const after = await backend.getResults(g.slug);
    expect(after.intent.status).toBe("decided");
    expect(after.selectedSuggestionKey).toBe(selected.suggestionKey);
    expect(after.suggestions.map((p) => p.suggestionKey)).toEqual(
      r.suggestions.map((p) => p.suggestionKey),
    );
    expect(
      (await backend.decide(g.owner.token, g.slug, body)).selectedSuggestionKey,
    ).toBe(selected.suggestionKey);
    await backend.closeIntent(g.owner.token, g.slug);
    expect((await backend.getResults(g.slug)).intent.status).toBe("decided");
    await expect(
      backend.vote(g.alice.token, g.slug, { ...body, value: "yes" }),
    ).rejects.toMatchObject({ code: "INTENT_CLOSED" });
  });
  it("rolls back votes/decisions/analytics if persistence fails", async () => {
    const g = await group(),
      r = await backend.getResults(g.slug),
      body = {
        suggestionKey: r.suggestions[0]!.suggestionKey,
        revision: r.revision,
        value: "yes",
      };
    await cluster.db.query(
      "ALTER TABLE analytics_events ADD CONSTRAINT fail_votes CHECK(event_name<>'vote_submitted')",
    );
    try {
      await expect(backend.vote(g.alice.token, g.slug, body)).rejects.toThrow();
      expect((await cluster.db.query("SELECT * FROM votes")).rowCount).toBe(0);
    } finally {
      await cluster.db.query(
        "ALTER TABLE analytics_events DROP CONSTRAINT fail_votes",
      );
    }
    await cluster.db.query(
      "ALTER TABLE intents ADD CONSTRAINT fail_decision CHECK(status<>'decided')",
    );
    try {
      await expect(
        backend.decide(g.owner.token, g.slug, body),
      ).rejects.toThrow();
      expect((await backend.getResults(g.slug)).intent.status).toBe("ready");
    } finally {
      await cluster.db.query(
        "ALTER TABLE intents DROP CONSTRAINT fail_decision",
      );
    }
  });
});
