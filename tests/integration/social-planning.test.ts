import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { socialActor } from "../support/social";
import { DiscoveryService } from "@/features/social/discovery";
import { ConnectionsService } from "@/features/social/connections";
import { ConversationService } from "@/features/social/conversations";
import { PlanningService } from "@/features/social/planning";
import { VeyaBackend } from "@/features/backend/service";
import { IdentityService } from "@/features/social/identity";
import { createGuestSession } from "@/features/backend/sessions";
describe("mutual match to ordinary coordination plan", () => {
  let c: Awaited<ReturnType<typeof startTestDatabase>>;
  beforeAll(async () => {
    c = await startTestDatabase();
    await applyMigrations(c.db);
  });
  afterAll(async () => {
    if (c) await c.stop();
  });
  it("atomically creates one ordinary plan with only pair alias and activity, preserving scheduler", async () => {
    const a = await socialActor(c.db, "Global secret A");
    const b = await socialActor(c.db, "Global secret B");
    await new DiscoveryService(c.db).discover(a.token, a.post.publicKey);
    const h = await c.db.query<{ public_handle: string }>(
      "SELECT public_handle FROM discovery_handles WHERE source_post_id=(SELECT id FROM seeking_posts WHERE public_key=$1) AND target_post_id=(SELECT id FROM seeking_posts WHERE public_key=$2)",
      [a.post.publicKey, b.post.publicKey],
    );
    const network = new ConnectionsService(c.db);
    const req = await network.request(a.token, {
      handle: h.rows[0]!.public_handle,
    });
    const match = (
      await network.respond(b.token, req.publicKey, { action: "accept" })
    ).matchKey!;
    await new ConversationService(c.db).disclose(a.token, match, {
      kind: "contact_handle",
      value: "PRIVATE-CONTACT",
      consent: true,
    });
    const bridge = new PlanningService(c.db);
    const [one, two] = await Promise.all([
      bridge.plan(a.token, match),
      bridge.plan(b.token, match),
    ]);
    expect(one).toEqual(two);
    expect(one.publicSlug).toMatch(/^[\w-]{24}$/);
    const backend = new VeyaBackend(c.db,{analyticsEnabled:true});
    const view = await backend.getIntent(one.publicSlug, a.token);
    expect(JSON.stringify(view)).not.toMatch(
      /Global secret|PRIVATE-CONTACT|North|Moscow|Play chess in Moscow/,
    );
    expect(view.intent.rawText).toBe("Chess — вместе");
    expect(view.intent.creatorName).toMatch(/^Тихий /);
    expect(view.ownParticipant).toBe(null);
    const input = {
      displayName: "Pair guest",
      availability: a.post.availability,
    };
    await backend.joinIntent(a.token, one.publicSlug, input);
    await backend.joinIntent(b.token, one.publicSlug, {
      ...input,
      displayName: "Second guest",
    });
    const results = await backend.getResults(one.publicSlug, a.token);
    expect(results.suggestions[0]!.availableCount).toBe(2);
    const selection={suggestionKey:results.suggestions[0]!.suggestionKey,revision:results.revision};
    await backend.decide(view.isCreator?a.token:b.token,one.publicSlug,selection);
    await backend.decide(view.isCreator?a.token:b.token,one.publicSlug,selection);
    expect((await c.db.query("SELECT * FROM analytics_events WHERE event_name='plan_confirmed'")).rows).toHaveLength(1);
    const before = await c.db.query<{ id: string }>(
      "SELECT id FROM social_matches WHERE public_key=$1",
      [match],
    );
    expect(before.rows).toHaveLength(1);
    await c.db.query(
      "INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) SELECT low_profile_id,high_profile_id FROM social_pairs p JOIN social_matches m ON m.pair_id=p.id WHERE m.public_key=$1",
      [match],
    );
    await expect(bridge.plan(a.token, match)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      (await new ConversationService(c.db).get(a.token, match)).planSlug,
    ).toBe(null);
  });
  it("rejects outsider and retains social access after key recovery without transferring old plan ownership", async () => {
    const a = await socialActor(c.db, "Recovery planner");
    const b = await socialActor(c.db, "Planner B");
    await new DiscoveryService(c.db).discover(a.token, a.post.publicKey);
    const h = await c.db.query<{ public_handle: string }>(
      "SELECT public_handle FROM discovery_handles WHERE source_post_id=(SELECT id FROM seeking_posts WHERE public_key=$1) AND target_post_id=(SELECT id FROM seeking_posts WHERE public_key=$2)",
      [a.post.publicKey, b.post.publicKey],
    );
    const network = new ConnectionsService(c.db);
    const req = await network.request(a.token, {
      handle: h.rows[0]!.public_handle,
    });
    const match = (
      await network.respond(b.token, req.publicKey, { action: "accept" })
    ).matchKey!;
    const outsider = await socialActor(c.db, "Outsider");
    const bridge = new PlanningService(c.db);
    await expect(bridge.plan(outsider.token, match)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const own = await bridge.plan(a.token, match);
    const fresh = (await createGuestSession(c.db)).token;
    await new IdentityService(c.db).recover(fresh, { key: a.key });
    expect(await bridge.plan(fresh, match)).toEqual(own);
    expect(
      (await new VeyaBackend(c.db).getIntent(own.publicSlug, fresh)).isCreator,
    ).toBe(false);
    await expect(bridge.plan(a.token, match)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
