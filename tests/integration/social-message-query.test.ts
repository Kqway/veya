import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import type { Database } from "@/lib/db/types";
import { socialActor, forbiddenKeys } from "../support/social";
import { DiscoveryService } from "@/features/social/discovery";
import { ConnectionsService } from "@/features/social/connections";
import { ConversationService } from "@/features/social/conversations";
import { IdentityService } from "@/features/social/identity";
import { opaqueKey } from "@/features/social/pairs";

describe("native bounded message identity hydration", () => {
  let c: Awaited<ReturnType<typeof startTestDatabase>>;
  beforeAll(async () => { c = await startTestDatabase(); await applyMigrations(c.db); });
  afterAll(async () => { if (c) await c.stop(); });
  beforeEach(async () => { await c.db.query("TRUNCATE social_profiles CASCADE"); });
  const measured = (queries: string[]): Database => ({
    query: (sql, values) => c.db.query(sql, values), close: async () => {},
    transaction: (work) => c.db.transaction((tx) => work({ query: async (sql, values) => {
      queries.push(sql); return tx.query(sql, values);
    } })),
  });
  async function setup(mode: "OPEN" | "INCOGNITO" = "INCOGNITO") {
    const a = await socialActor(c.db, "Global Source", mode);
    const b = await socialActor(c.db, "Global Peer", mode);
    const handle = (await new DiscoveryService(c.db).discover(a.token, a.post.publicKey))[0]!.handle;
    const connections = new ConnectionsService(c.db);
    const request = await connections.request(a.token, { handle });
    const accepted = await connections.respond(b.token, request.publicKey, { action: "accept" });
    const row = await c.db.query<{ conversation_id: string; own_id: string; peer_id: string }>(
      "SELECT c.id AS conversation_id,(SELECT profile_id FROM seeking_posts WHERE public_key=$2) AS own_id,(SELECT profile_id FROM seeking_posts WHERE public_key=$3) AS peer_id FROM conversations c JOIN social_matches m ON m.id=c.match_id WHERE m.public_key=$1",
      [accepted.matchKey, a.post.publicKey, b.post.publicKey],
    );
    return { a, b, matchKey: accepted.matchKey!, ...row.rows[0]! };
  }
  const identities = (queries: string[]) => queries.filter((sql) => sql.includes("FROM pairwise_identities")).length;
  it("projects one or fifty same-author messages with one identity query per page", async () => {
    const m = await setup();
    for (let i = 0; i < 51; i++) await c.db.query(
      "INSERT INTO messages(public_key,conversation_id,sender_profile_id,text,created_at) VALUES($1,$2,$3,$4,$5)",
      [opaqueKey(), m.conversation_id, m.own_id, `Message ${i}`, new Date(Date.now() + i * 1000)],
    );
    const smallQueries: string[] = [], largeQueries: string[] = [];
    const small = await new ConversationService(measured(smallQueries)).messages(m.a.token, m.matchKey, { limit: 1 });
    const large = await new ConversationService(measured(largeQueries)).messages(m.a.token, m.matchKey, { limit: 50 });
    expect(small.messages.map((row) => row.text)).toEqual(["Message 50"]);
    expect(large.messages.map((row) => row.text)).toEqual(Array.from({ length: 50 }, (_, i) => `Message ${i + 1}`));
    expect(large.nextBefore).toBe(large.messages[0]!.publicKey);
    expect(large.messages.every((row) => row.isMine && JSON.stringify(row.identity) === JSON.stringify(small.messages[0]!.identity))).toBe(true);
    expect(identities(smallQueries)).toBe(1);
    expect(identities(largeQueries)).toBe(1);
    expect(largeQueries.length).toBe(smallQueries.length);
    expect(forbiddenKeys(large.messages)).toEqual([]);
    expect(JSON.stringify(large.messages)).not.toMatch(/Global Source|Global Peer|profile_id|avatar_seed/);
    const older = await new ConversationService(c.db).messages(m.b.token, m.matchKey, { before: large.nextBefore!, limit: 50 });
    expect(older.messages.map((row) => row.text)).toEqual(["Message 0"]);
    expect(older.nextBefore).toBeNull();
    expect(older.messages[0]!.isMine).toBe(false);
  });
  it("hydrates both authors at most twice and applies current stronger privacy on each new page", async () => {
    const m = await setup("OPEN");
    for (let i = 0; i < 50; i++) await c.db.query(
      "INSERT INTO messages(public_key,conversation_id,sender_profile_id,text,created_at) VALUES($1,$2,$3,$4,$5)",
      [opaqueKey(), m.conversation_id, i % 2 ? m.own_id : m.peer_id, `Both ${i}`, new Date(Date.now() + i * 1000)],
    );
    const queries: string[] = [];
    const service = new ConversationService(measured(queries));
    const open = await service.messages(m.a.token, m.matchKey, { limit: 50 });
    expect(identities(queries)).toBe(2);
    expect(new Set(open.messages.filter((row) => !row.isMine).map((row) => row.identity.alias))).toEqual(new Set(["Global Peer"]));
    await new IdentityService(c.db).update(m.b.token, { alias: "Hidden Now", privacyMode: "INCOGNITO" });
    const privatePage = await service.messages(m.a.token, m.matchKey, { limit: 50 });
    expect(privatePage.messages.filter((row) => !row.isMine)).toHaveLength(25);
    expect(JSON.stringify(privatePage.messages.filter((row) => !row.isMine))).not.toMatch(/Global Peer|Hidden Now/);
    const emptyQueries: string[] = [];
    const empty = await new ConversationService(measured(emptyQueries)).messages(m.a.token, m.matchKey, { before: privatePage.messages[0]!.publicKey });
    expect(empty.messages).toEqual([]);
    expect(identities(emptyQueries)).toBe(0);
    const outsider = await socialActor(c.db, "Outsider");
    await expect(service.messages(outsider.token, m.matchKey)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
