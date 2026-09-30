import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "@/lib/db/migrations";
import { VeyaBackend } from "@/features/backend/service";
import { startTestDatabase } from "../support/postgres";

const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const member = (displayName = "Alex") => ({
  displayName, notes: "Private note", budgetMin: 1000, budgetMax: 3000, currency: "USD",
  availability: [{ startAt: future(24), endAt: future(26) }],
  preferences: [{ category: "activity", value: "Games" }],
});

describe("guest-authorized persistent backend", () => {
  let cluster: Awaited<ReturnType<typeof startTestDatabase>>;
  let backend: VeyaBackend;
  beforeAll(async () => { cluster = await startTestDatabase(); await applyMigrations(cluster.db); });
  afterAll(async () => { if (cluster) await cluster.stop(); });
  beforeEach(async () => {
    await cluster.db.query("TRUNCATE users, guest_participant_sessions, intents, analytics_events CASCADE");
    backend = new VeyaBackend(cluster.db, { analyticsEnabled: true });
  });
  const session = () => backend.createSession();
  async function intent() {
    const owner = await session();
    const view = await backend.createIntent(owner.token, { rawText: "  Let's meet this week.  ", creatorName: "Artem" });
    return { owner, slug: view.intent.publicSlug };
  }

  it("stores token hashes, not bearer tokens", async () => {
    const guest = await session();
    expect(guest.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = (await cluster.db.query("SELECT token_hash, expires_at, created_at FROM guest_participant_sessions")).rows[0];
    expect(row?.token_hash).toBe(createHash("sha256").update(guest.token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(guest.token);
    expect(new Date(guest.expiresAt).getTime() - (row?.created_at as Date).getTime()).toBe(30 * 86_400_000);
  });

  it("creates a trimmed intent and high-entropy public slug", async () => {
    const { owner, slug } = await intent();
    expect(slug).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const view = await backend.getIntent(slug, owner.token);
    expect(view.intent.rawText).toBe("Let's meet this week.");
    expect(view.intent.creatorName).toBe("Artem");
    expect(view.intent.status).toBe("collecting");
    expect(view.isCreator).toBe(true);
    expect(view.ownParticipant).toBeNull();
  });

  it("rejects forged, revoked and expired credentials", async () => {
    await expect(backend.createIntent("a".repeat(43), { rawText: "Coffee" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const revoked = await session();
    await backend.revokeSession(revoked.token);
    await expect(backend.createIntent(revoked.token, { rawText: "Coffee" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const expired = await session();
    await cluster.db.query("UPDATE guest_participant_sessions SET created_at=now()-interval '2 days', expires_at=now()-interval '1 day' WHERE token_hash=$1", [createHash("sha256").update(expired.token).digest("hex")]);
    await expect(backend.createIntent(expired.token, { rawText: "Coffee" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await cluster.db.query("SELECT * FROM intents")).rows).toEqual([]);
  });

  it("returns only the current guest's private participant details", async () => {
    const { slug } = await intent();
    const guest = await session();
    await backend.joinIntent(guest.token, slug, member());
    const anonymous = await backend.getIntent(slug);
    expect(anonymous.intent.participantCount).toBe(1);
    expect(anonymous.ownParticipant).toBeNull();
    const serialized = JSON.stringify(anonymous);
    expect(serialized).not.toMatch(/Private note|budgetMin|token_hash|guest_id|creator_guest_id/);
    const own = await backend.getIntent(slug, guest.token);
    expect(own.ownParticipant?.notes).toBe("Private note");
    expect(own.ownParticipant?.preferences).toEqual([{ category: "activity", value: "games" }]);
    expect(JSON.stringify(own)).not.toMatch(/"id":|guest_id|token_hash/);
  });

  it("handles duplicate and concurrent joins as one membership", async () => {
    const { slug } = await intent();
    const guest = await session();
    const results = await Promise.all([
      backend.joinIntent(guest.token, slug, member()), backend.joinIntent(guest.token, slug, member()),
    ]);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect((await backend.getIntent(slug, guest.token)).intent.participantCount).toBe(1);
    expect((await cluster.db.query("SELECT * FROM availability_windows")).rowCount).toBe(1);
    await backend.joinIntent(guest.token, slug, { displayName: "Attempted replacement" });
    expect((await backend.getIntent(slug, guest.token)).ownParticipant?.displayName).toBe("Alex");
  });

  it("updates only the caller's own membership atomically", async () => {
    const { slug } = await intent();
    const alice = await session(), bob = await session(), outsider = await session();
    await backend.joinIntent(alice.token, slug, member("Alice"));
    await backend.joinIntent(bob.token, slug, member("Bob"));
    await expect(backend.updateParticipant(outsider.token, slug, member("Hijack"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await backend.updateParticipant(alice.token, slug, { displayName: "Alice updated", availability: [] });
    expect((await backend.getIntent(slug, alice.token)).ownParticipant?.notes).toBe("");
    expect((await backend.getIntent(slug, alice.token)).ownParticipant?.availability).toEqual([]);
    expect((await backend.getIntent(slug, bob.token)).ownParticipant?.displayName).toBe("Bob");
  });

  it("allows only the creator to close an intent", async () => {
    const { owner, slug } = await intent();
    const stranger = await session();
    await expect(backend.closeIntent(stranger.token, slug)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await backend.closeIntent(owner.token, slug);
    expect((await backend.getIntent(slug)).intent.status).toBe("expired");
    await expect(backend.joinIntent(stranger.token, slug, member())).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
  });

  it("reports timestamp expiry and refuses writes to expired or decided groups", async () => {
    const { slug } = await intent();
    const guest = await session();
    await cluster.db.query("UPDATE intents SET created_at=now()-interval '2 days', expires_at=now()-interval '1 day' WHERE public_slug=$1", [slug]);
    expect((await backend.getIntent(slug)).intent.status).toBe("expired");
    await expect(backend.joinIntent(guest.token, slug, member())).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
    await cluster.db.query("UPDATE intents SET expires_at=now()+interval '7 days', status='decided' WHERE public_slug=$1", [slug]);
    await expect(backend.joinIntent(guest.token, slug, member())).rejects.toMatchObject({ code: "INTENT_CLOSED" });
  });

  it.each([
    { displayName: "" }, { ...member(), budgetMin: 4000, budgetMax: 1000 },
    { ...member(), currency: null }, { ...member(), budgetMax: 1.5 },
    { ...member(), currency: "ZZZ" },
    { ...member(), guestId: "someone-else" },
    { ...member(), availability: [{ startAt: "2026-09-30T19:00:00", endAt: future(25) }] },
    { ...member(), availability: [{ startAt: future(25), endAt: future(24) }] },
    { ...member(), availability: [{ startAt: future(24), endAt: future(50) }] },
    { ...member(), availability: [{ startAt: future(-2), endAt: future(-1) }] },
    { ...member(), availability: [{ startAt: future(24), endAt: future(27) }, { startAt: future(26), endAt: future(28) }] },
  ])("rejects invalid participant data without partial writes %#", async (input) => {
    const { slug } = await intent();
    const guest = await session();
    await expect(backend.joinIntent(guest.token, slug, input)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await backend.getIntent(slug)).intent.participantCount).toBe(0);
  });

  it("rejects untrusted creator IDs and invalid expiry", async () => {
    const guest = await session();
    for (const input of [{ rawText: "x", creatorGuestId: "forged" }, { rawText: " " }, { rawText: "x", expiresAt: future(-1) }, { rawText: "x", expiresAt: future(800) }]) {
      await expect(backend.createIntent(guest.token, input)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  it("normalizes offset windows and treats user text as bound values", async () => {
    const { slug } = await intent();
    const guest = await session();
    const instant = new Date(Date.now() + 86_400_000);
    const startAt = new Date(instant.getTime() + 3 * 3_600_000).toISOString().replace("Z", "+03:00");
    await backend.joinIntent(guest.token, slug, { displayName: "O'Brian'); DROP TABLE users;--", availability: [{ startAt, endAt: future(25) }] });
    const view = await backend.getIntent(slug, guest.token);
    expect(view.ownParticipant?.availability[0]?.startAt).toBe(new Date(startAt).toISOString());
    expect(view.ownParticipant?.availability[0]?.startAt).toBe(instant.toISOString());
    expect((await cluster.db.query("SELECT count(*) FROM users")).rows[0]?.count).toBe("0");
  });

  it("rolls back an entire participant update if a child insert fails", async () => {
    const { slug } = await intent();
    const guest = await session();
    await backend.joinIntent(guest.token, slug, member());
    const before = (await backend.getIntent(slug, guest.token)).ownParticipant;
    await cluster.db.query("ALTER TABLE preferences ADD CONSTRAINT test_reject_preference CHECK(value <> 'trigger-failure')");
    try {
      await expect(backend.updateParticipant(guest.token, slug, { ...member("Changed"), preferences: [{ category: "activity", value: "trigger-failure" }] })).rejects.toThrow();
      expect((await backend.getIntent(slug, guest.token)).ownParticipant).toEqual(before);
    } finally { await cluster.db.query("ALTER TABLE preferences DROP CONSTRAINT test_reject_preference"); }
  });

  it("records safe analytics when enabled and remains off by default", async () => {
    const { slug } = await intent();
    const guest = await session();
    await backend.joinIntent(guest.token, slug, member());
    const rows = (await cluster.db.query("SELECT event_name,surface FROM analytics_events ORDER BY id")).rows;
    expect(rows).toEqual([{ event_name: "intent_created", surface: "create" }, { event_name: "participant_joined", surface: "invite" }]);
    const disabled = new VeyaBackend(cluster.db);
    await disabled.createIntent(guest.token, { rawText: "Another idea" });
    expect((await cluster.db.query("SELECT * FROM analytics_events")).rowCount).toBe(2);
  });
});
