import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import type { Database, DatabaseExecutor } from "@/lib/db/types";
import type { QueryResultRow } from "pg";
import { socialActor, forbiddenKeys, seekingInput } from "../support/social";
import { DiscoveryService } from "@/features/social/discovery";
import { SeekingService } from "@/features/social/seeking";
import { lockProfiles } from "@/features/social/context";
import { candidateBatch, readPost } from "@/features/social/post-repository";
import { readProfile } from "@/features/social/pairs";

describe("native bounded discovery persistence", () => {
  let c: Awaited<ReturnType<typeof startTestDatabase>>;
  beforeAll(async () => { c = await startTestDatabase(); await applyMigrations(c.db); });
  afterAll(async () => { if (c) await c.stop(); });
  beforeEach(async () => { await c.db.query("TRUNCATE social_profiles CASCADE"); });
  const measured = (queries: string[], beforeLock?: (tx: DatabaseExecutor) => Promise<void>): Database => ({
    query: (sql, values) => c.db.query(sql, values),
    close: async () => {},
    transaction: (work) => c.db.transaction((tx) => work({ query: async (sql, values) => {
      queries.push(sql);
      if (beforeLock && sql.includes("pg_advisory_xact_lock")) {
        const callback = beforeLock; beforeLock = undefined; await callback(tx);
      }
      return tx.query(sql, values);
    } })),
  });
  it("hydrates one or one hundred candidate posts with the same bounded child query workload", async () => {
    const a = await socialActor(c.db, "Source");
    await socialActor(c.db, "First");
    const small: string[] = [];
    expect(await new DiscoveryService(measured(small)).discover(a.token, a.post.publicKey)).toHaveLength(1);
    for (let i = 0; i < 99; i++) await socialActor(c.db, `Candidate ${i}`);
    const large: string[] = [];
    const cards = await new DiscoveryService(measured(large)).discover(a.token, a.post.publicKey);
    expect(cards).toHaveLength(5);
    expect(forbiddenKeys(cards)).toEqual([]);
    const hydration = (sql: string[]) => sql.filter((value) => /FROM seeking_(availability|tags)\b/.test(value)).length;
    expect(hydration(small)).toBe(2);
    expect(hydration(large)).toBe(2);
    // Sorted advisory locking intentionally remains one round trip per unique profile.
    // Only the five card persistence operations may scale independently of hydration.
    const candidateReads = (sql: string[]) => sql.filter((value) => /^SELECT \* FROM seeking_posts WHERE id=/.test(value)).length;
    expect(candidateReads(large)).toBe(0);
  }, 30_000);
  it.each(["closed", "blocked", "passed"])("reloads candidate %s state after the lock boundary", async (kind) => {
    const a = await socialActor(c.db, "Source");
    const b = await socialActor(c.db, "Peer");
    const ids = await c.db.query<{ id: string; profile_id: string }>("SELECT id,profile_id FROM seeking_posts WHERE public_key=$1", [b.post.publicKey]);
    const actor = await c.db.query<{ profile_id: string }>("SELECT profile_id FROM seeking_posts WHERE public_key=$1", [a.post.publicKey]);
    const changed = measured([], async (tx) => {
      if (kind === "closed") await tx.query("UPDATE seeking_posts SET status='closed' WHERE id=$1", [ids.rows[0]!.id]);
      if (kind === "blocked") await tx.query("INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) VALUES($1,$2)", [ids.rows[0]!.profile_id, actor.rows[0]!.profile_id]);
      if (kind === "passed") await tx.query("INSERT INTO discovery_passes(viewer_profile_id,target_profile_id) VALUES($1,$2)", [actor.rows[0]!.profile_id, ids.rows[0]!.profile_id]);
    });
    expect(await new DiscoveryService(changed).discover(a.token, a.post.publicKey)).toEqual([]);
    expect((await c.db.query("SELECT * FROM discovery_handles")).rows).toHaveLength(0);
  });
  it("deduplicates profiles before the five card limit", async () => {
    const a = await socialActor(c.db, "Source");
    const b = await socialActor(c.db, "Multiple posts");
    await new SeekingService(c.db).create(b.token, seekingInput());
    await new SeekingService(c.db).create(b.token, seekingInput());
    for (let i = 0; i < 5; i++) await socialActor(c.db, `Unique ${i}`, "INCOGNITO", { skill: "advanced" });
    expect(await new DiscoveryService(c.db).discover(a.token, a.post.publicKey)).toHaveLength(5);
  });
  it("keeps each post's child fields distinct and rejects oversized batches before querying", async () => {
    const a = await socialActor(c.db, "First", "PRIVATE", { tags: ["first"] });
    const b = await socialActor(c.db, "Second", "PRIVATE", { tags: ["second"] });
    const first = await readPost(c.db, a.post.publicKey);
    const second = await readPost(c.db, b.post.publicKey);
    const profiles = new Map([
      [first.profile_id, await readProfile(c.db, first.profile_id)],
      [second.profile_id, await readProfile(c.db, second.profile_id)],
    ]);
    const batch = await candidateBatch(c.db, [second, first], profiles);
    expect(batch.get(first.id)!.tags).toEqual(["first"]);
    expect(batch.get(second.id)!.tags).toEqual(["second"]);
    expect(batch.get(first.id)!.availability).toEqual(a.post.availability);
    expect(batch.get(second.id)!.availability).toEqual(b.post.availability);
    await expect(candidateBatch(c.db, Array(102).fill(first), profiles)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(candidateBatch(c.db, [first, first], profiles)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(candidateBatch(c.db, [first], new Map())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await candidateBatch(c.db, [], new Map())).toEqual(new Map());
  });
  it.each(["expired-session", "removed-binding"])("reauthorizes %s at the profile lock boundary", async (kind) => {
    const a = await socialActor(c.db, "Source");
    await socialActor(c.db, "Peer");
    const actor = await c.db.query<{ profile_id: string }>("SELECT profile_id FROM seeking_posts WHERE public_key=$1", [a.post.publicKey]);
    const changed = measured([], async (tx) => {
      if (kind === "removed-binding") await tx.query("DELETE FROM social_profile_bindings WHERE profile_id=$1", [actor.rows[0]!.profile_id]);
      else await tx.query("UPDATE guest_participant_sessions SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE id=(SELECT guest_id FROM social_profile_bindings WHERE profile_id=$1)", [actor.rows[0]!.profile_id]);
    });
    await expect(new DiscoveryService(changed).discover(a.token, a.post.publicKey)).rejects.toMatchObject({ code: kind === "removed-binding" ? "NOT_FOUND" : "UNAUTHORIZED" });
    expect((await c.db.query("SELECT * FROM discovery_handles")).rows).toHaveLength(0);
  });
  it.each(["closed", "blocked", "passed", "suspended"])("reloads %s committed while discovery actually waits for sorted locks", async (kind) => {
    const a = await socialActor(c.db, "Source");
    const b = await socialActor(c.db, "Peer");
    const posts = await c.db.query<{ id: string; profile_id: string; public_key: string }>("SELECT id,profile_id,public_key FROM seeking_posts");
    const actor = posts.rows.find((row) => row.public_key === a.post.publicKey)!;
    const peer = posts.rows.find((row) => row.public_key === b.post.publicKey)!;
    let locked!: () => void;
    let queryStarted!: () => void;
    const locksHeld = new Promise<void>((resolve) => { locked = resolve; });
    const lockStarted = new Promise<void>((resolve) => { queryStarted = resolve; });
    const writer = c.db.transaction(async (tx) => {
      await lockProfiles(tx, [actor.profile_id, peer.profile_id]);
      locked();
      await lockStarted;
      if (kind === "closed") await tx.query("UPDATE seeking_posts SET status='closed' WHERE id=$1", [peer.id]);
      if (kind === "blocked") await tx.query("INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) VALUES($1,$2)", [peer.profile_id, actor.profile_id]);
      if (kind === "passed") await tx.query("INSERT INTO discovery_passes(viewer_profile_id,target_profile_id) VALUES($1,$2)", [actor.profile_id, peer.profile_id]);
      if (kind === "suspended") await tx.query("UPDATE social_profiles SET moderation_status='suspended' WHERE id=$1", [peer.profile_id]);
    });
    await locksHeld;
    let signalled = false;
    const observed: Database = {
      query: (sql, values) => c.db.query(sql, values), close: async () => {},
      transaction: (work) => c.db.transaction((tx) => work({ query: <Row extends QueryResultRow>(sql: string, values?: readonly unknown[]) => {
        const pending = tx.query<Row>(sql, values);
        if (!signalled && sql.includes("pg_advisory_xact_lock")) { signalled = true; queryStarted(); }
        return pending;
      } })),
    };
    const discovery = new DiscoveryService(observed).discover(a.token, a.post.publicKey);
    const [cards] = await Promise.all([discovery, writer]);
    expect(signalled).toBe(true);
    expect(cards).toEqual([]);
    expect((await c.db.query("SELECT * FROM discovery_handles")).rows).toHaveLength(0);
  });
  it("uses the activity/recent and directional request indexes with RLS retained", async () => {
    const a = await socialActor(c.db, "Source");
    await socialActor(c.db, "Peer");
    const profile = await c.db.query<{ profile_id: string }>("SELECT profile_id FROM seeking_posts WHERE public_key=$1", [a.post.publicKey]);
    await c.db.transaction(async (tx) => {
      await tx.query("SET LOCAL enable_seqscan=off");
      const activity = await tx.query<{ "QUERY PLAN": string }>("EXPLAIN SELECT id,profile_id FROM seeking_posts WHERE activity_key=$1 AND status='active' AND expires_at>clock_timestamp() ORDER BY created_at DESC,id LIMIT 100", ["chess"]);
      expect(activity.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("seeking_active_activity_recent");
      const request = await tx.query<{ "QUERY PLAN": string }>("EXPLAIN SELECT 1 FROM connection_requests WHERE sender_profile_id=$1 AND recipient_profile_id=$2 AND status<>'expired'", [profile.rows[0]!.profile_id, profile.rows[0]!.profile_id]);
      expect(request.rows.map((row) => row["QUERY PLAN"]).join("\n")).toMatch(/connection_live_(?:reverse_)?direction/);
    });
    const rls = await c.db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname=ANY($1::text[])", [["seeking_posts", "seeking_availability", "seeking_tags", "connection_requests"]]);
    expect(rls.rows).toHaveLength(4);
    expect(rls.rows.every((row) => row.relrowsecurity)).toBe(true);
  });
});
