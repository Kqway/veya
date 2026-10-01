import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { socialActor, forbiddenKeys } from "../support/social";
import { DiscoveryService } from "@/features/social/discovery";
import { SeekingService } from "@/features/social/seeking";
import { seekingInput } from "../support/social";
import { ConnectionsService } from "@/features/social/connections";
describe("private intent discovery and mutual requests", () => {
  let c: Awaited<ReturnType<typeof startTestDatabase>>;
  let d: DiscoveryService;
  let n: ConnectionsService;
  beforeAll(async () => {
    c = await startTestDatabase();
    await applyMigrations(c.db);
    d = new DiscoveryService(c.db);
    n = new ConnectionsService(c.db);
  });
  afterAll(async () => {
    if (c) await c.stop();
  });
  beforeEach(async () => {
    await c.db.query("TRUNCATE social_profiles CASCADE");
  });
  it("filters incompatible actions and returns minimal pairwise cards", async () => {
    const a = await socialActor(c.db, "hidden-A");
    const b = await socialActor(c.db, "hidden-B");
    await socialActor(c.db, "Football", "OPEN", {
      activityKey: "football",
      activityLabel: "Football",
    });
    const cards = await d.discover(a.token, a.post.publicKey);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.activityLabel === "Chess")).toBe(true);
    expect(forbiddenKeys(cards)).toEqual([]);
    expect(JSON.stringify(cards)).not.toMatch(/hidden-A|hidden-B|North|Moscow/);
    const handle = cards[0]!.handle;
    await expect(n.request(b.token, { handle })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("has separate persisted incognito identities across contexts", async () => {
    const a = await socialActor(c.db, "secret-A");
    const b = await socialActor(c.db, "secret-B");
    const x = await socialActor(c.db, "secret-X");
    const ca = await d.discover(a.token, a.post.publicKey);
    const cx = await d.discover(x.token, x.post.publicKey);
    const rows = await c.db.query<{
      public_handle: string;
      target_post_id: string;
      viewer_profile_id: string;
    }>(
      "SELECT public_handle,target_post_id,viewer_profile_id FROM discovery_handles WHERE target_post_id=(SELECT id FROM seeking_posts WHERE public_key=$1)",
      [b.post.publicKey],
    );
    const ha = rows.rows.find((r) =>
      ca.some((v) => v.handle === r.public_handle),
    )!.public_handle;
    const hx = rows.rows.find((r) =>
      cx.some((v) => v.handle === r.public_handle),
    )!.public_handle;
    expect(ca.find((v) => v.handle === ha)!.identity).not.toEqual(
      cx.find((v) => v.handle === hx)!.identity,
    );
    expect(
      (await d.discover(a.token, a.post.publicKey)).find(
        (v) => v.handle === ha,
      )!.identity,
    ).toEqual(ca.find((v) => v.handle === ha)!.identity);
  });
  it("requests are idempotent and only recipient accepts one mutual match", async () => {
    const a = await socialActor(c.db, "Request-A");
    const b = await socialActor(c.db, "Request-B");
    const outsider = await socialActor(c.db, "Request-X");
    const cards = await d.discover(a.token, a.post.publicKey);
    const row = await c.db.query<{ public_handle: string }>(
      "SELECT public_handle FROM discovery_handles WHERE source_post_id=(SELECT id FROM seeking_posts WHERE public_key=$1) AND target_post_id=(SELECT id FROM seeking_posts WHERE public_key=$2)",
      [a.post.publicKey, b.post.publicKey],
    );
    const handle = row.rows[0]!.public_handle;
    expect(cards.some((v) => v.handle === handle)).toBe(true);
    const request = await n.request(a.token, { handle });
    expect(await n.request(a.token, { handle })).toEqual(request);
    await expect(
      n.respond(a.token, request.publicKey, { action: "accept" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      n.respond(outsider.token, request.publicKey, { action: "accept" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const incoming = await n.list(b.token);
    expect(forbiddenKeys(incoming)).toEqual([]);
    expect(incoming.some((v) => v.publicKey === request.publicKey)).toBe(true);
    const [one, two] = await Promise.all([
      n.respond(b.token, request.publicKey, { action: "accept" }),
      n.respond(b.token, request.publicKey, { action: "accept" }),
    ]);
    expect(one.matchKey).toMatch(/^[\w-]{24}$/);
    expect(two).toEqual(one);
    expect(
      (
        await c.db.query("SELECT id FROM social_matches WHERE public_key=$1", [
          one.matchKey,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it("pass/decline are remembered and stale expiry cannot request or accept", async () => {
    const a = await socialActor(c.db, "Passing-A");
    await socialActor(c.db, "Passing-B");
    const cards = await d.discover(a.token, a.post.publicKey);
    const handle = cards[0]!.handle;
    await d.pass(a.token, handle);
    expect(
      (await d.discover(a.token, a.post.publicKey)).some(
        (v) => v.handle === handle,
      ),
    ).toBe(false);
    await expect(n.request(a.token, { handle })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const b = await socialActor(c.db, "Expiring-B");
    const latest = await d.discover(a.token, a.post.publicKey);
    const row = await c.db.query<{ public_handle: string }>(
      "SELECT public_handle FROM discovery_handles WHERE source_post_id=(SELECT id FROM seeking_posts WHERE public_key=$1) AND target_post_id=(SELECT id FROM seeking_posts WHERE public_key=$2)",
      [a.post.publicKey, b.post.publicKey],
    );
    const h = row.rows[0]!.public_handle;
    expect(latest.some((v) => v.handle === h)).toBe(true);
    const req = await n.request(a.token, { handle: h });
    await c.db.query(
      "UPDATE seeking_posts SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE public_key=$1",
      [b.post.publicKey],
    );
    await expect(
      n.respond(b.token, req.publicKey, { action: "accept" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("bounds new discovery contexts per profile per day to resist city enumeration", async () => {
    const a = await socialActor(c.db, "Daily source");
    for (let i = 0; i < 21; i++)
      await socialActor(c.db, "Daily candidate " + i);
    let seen = 0;
    for (let i = 0; i < 4; i++) {
      const cards = await d.discover(a.token, a.post.publicKey);
      expect(cards).toHaveLength(5);
      seen += cards.length;
      for (const card of cards) await d.pass(a.token, card.handle);
    }
    expect(seen).toBe(20);
    expect(await d.discover(a.token, a.post.publicKey)).toEqual([]);
  });
  it.each(["closed", "expired", "elapsed"])("releases stale pending budgets after %s posts and preserves history", async (kind) => {
    const a = await socialActor(c.db, "Budget source");
    for (let i = 0; i < 10; i++) await socialActor(c.db, "Budget peer " + i);
    const requests = [];
    for (let batch = 0; batch < 2; batch++) {
      const cards = await d.discover(a.token, a.post.publicKey);
      expect(cards).toHaveLength(5);
      for (const card of cards) requests.push(await n.request(a.token, { handle: card.handle }));
    }
    if (kind === "closed") await new SeekingService(c.db).close(a.token, a.post.publicKey);
    else if (kind === "expired") await c.db.query("UPDATE seeking_posts SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE public_key=$1", [a.post.publicKey]);
    else await c.db.query("UPDATE seeking_availability SET start_at=clock_timestamp()-interval '2 hours',end_at=clock_timestamp()-interval '1 hour' WHERE post_id=(SELECT id FROM seeking_posts WHERE public_key=$1)", [a.post.publicKey]);
    const fresh = await new SeekingService(c.db).create(a.token, seekingInput());
    await socialActor(c.db, "Fresh peer");
    const cards = await d.discover(a.token, fresh.publicKey);
    expect(cards.length).toBeGreaterThan(0);
    expect(await n.request(a.token, { handle: cards[0]!.handle })).toMatchObject({ status: "pending" });
    const history = await n.list(a.token);
    for (const old of requests) expect(history.find((r) => r.publicKey === old.publicKey)?.status).toBe("expired");
    expect((await c.db.query("SELECT * FROM social_blocks")).rows).toHaveLength(0);

  });

  it("allows a fresh request after temporal expiry without erasing the expired interaction", async () => {
    const a = await socialActor(c.db, "Renew source");
    const b = await socialActor(c.db, "Renew peer");
    const initial = await n.request(a.token, { handle: (await d.discover(a.token, a.post.publicKey))[0]!.handle });
    await new SeekingService(c.db).close(a.token, a.post.publicKey);
    expect((await n.list(a.token))[0]!.status).toBe("expired");
    const fresh = await new SeekingService(c.db).create(a.token, seekingInput());
    const cards = await d.discover(a.token, fresh.publicKey);
    expect(cards).toHaveLength(1);
    const request = await n.request(a.token, { handle: cards[0]!.handle });
    expect(request.publicKey).not.toBe(initial.publicKey);
    expect(request.status).toBe("pending");
    const accepted = await n.respond(b.token, request.publicKey, { action: "accept" });
    expect(accepted.matchKey).not.toBeNull();
    expect((await n.list(a.token)).find((r) => r.publicKey === initial.publicKey)?.status).toBe("expired");
  });

});
