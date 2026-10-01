import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "@/lib/db/migrations";
import { requireProfile, lockProfiles } from "@/features/social/context";
import { ensurePair, opaqueKey } from "@/features/social/pairs";
import { SafetyService } from "@/features/social/safety";
import { ConnectionsService } from "@/features/social/connections";
import { ConversationService } from "@/features/social/conversations";
import { DiscoveryService } from "@/features/social/discovery";
import { startTestDatabase } from "../support/postgres";
import { socialActor, forbiddenKeys } from "../support/social";

describe("interaction-scoped social safety", () => {
  let c: Awaited<ReturnType<typeof startTestDatabase>>; let safety: SafetyService;
  beforeAll(async () => { c = await startTestDatabase(); await applyMigrations(c.db); safety = new SafetyService(c.db); });
  afterAll(async () => c?.stop());
  beforeEach(async () => { await c.db.query("TRUNCATE social_profiles CASCADE"); });
  async function interaction(accepted = true) {
    const a = await socialActor(c.db, "A"), b = await socialActor(c.db, "B");
    return c.db.transaction(async (tx) => {
      const own = await requireProfile(tx, a.token), peer = await requireProfile(tx, b.token);
      await lockProfiles(tx, [own.id, peer.id]); const pair = await ensurePair(tx, own, peer, "INCOGNITO", "INCOGNITO");
      const requestKey = opaqueKey();
      const request = await tx.query<{ id: string }>("INSERT INTO connection_requests(public_key,pair_id,sender_profile_id,recipient_profile_id,source_post_id,target_post_id,pending_slot,status,activity_label) VALUES($1,$2,$3,$4,(SELECT id FROM seeking_posts WHERE public_key=$5),(SELECT id FROM seeking_posts WHERE public_key=$6),1,$7,'Chess') RETURNING id", [requestKey, pair.id, own.id, peer.id, a.post.publicKey, b.post.publicKey, accepted ? "accepted" : "pending"]);
      const matchKey = opaqueKey(); let matchId: string | null = null;
      if (accepted) { const match = await tx.query<{ id: string }>("INSERT INTO social_matches(public_key,pair_id,request_id,activity_label) VALUES($1,$2,$3,'Chess') RETURNING id", [matchKey,pair.id,request.rows[0]!.id]); matchId = match.rows[0]!.id; await tx.query("INSERT INTO conversations(match_id) VALUES($1)", [matchId]); }
      return { a,b,own,peer,pair,requestKey,requestId: request.rows[0]!.id,matchKey,matchId };
    });
  }
  it("blocks both directions, closes conversation generically and retains history", async () => {
    const m = await interaction(); const chat = new ConversationService(c.db);
    await chat.send(m.a.token,m.matchKey,{text:"retained history"});
    expect(await safety.block(m.a.token,{matchKey:m.matchKey})).toEqual({blocked:true});
    expect(await safety.block(m.a.token,{matchKey:m.matchKey})).toEqual({blocked:true});
    expect((await c.db.query("SELECT * FROM social_blocks")).rows).toHaveLength(1);
    for (const actor of [m.a,m.b]) {
      const view = await chat.get(actor.token,m.matchKey); expect(view.status).toBe("closed"); expect(forbiddenKeys(view)).toEqual([]);
      expect((await chat.messages(actor.token,m.matchKey)).messages[0]!.text).toBe("retained history");
      await expect(chat.send(actor.token,m.matchKey,{text:"blocked"})).rejects.toMatchObject({code:"CONFLICT"});
      await expect(chat.disclose(actor.token,m.matchKey,{kind:"first_name",value:"A",consent:true})).rejects.toMatchObject({code:"CONFLICT"});
      expect(await new ConnectionsService(c.db).list(actor.token)).toEqual([]);
      expect(await new DiscoveryService(c.db).discover(actor.token,actor.post.publicKey)).toEqual([]);
    }
    expect((await c.db.query("SELECT status FROM conversations WHERE match_id=$1",[m.matchId])).rows).toEqual([{status:"closed"}]);
  });
  it("blocks an authorized pending request and prevents acceptance", async () => {
    const m = await interaction(false);
    expect(await safety.block(m.b.token,{requestKey:m.requestKey})).toEqual({blocked:true});
    expect((await c.db.query("SELECT status FROM connection_requests WHERE id=$1",[m.requestId])).rows[0]!.status).toBe("declined");
    await expect(new ConnectionsService(c.db).respond(m.b.token,m.requestKey,{action:"accept"})).rejects.toMatchObject({code:"NOT_FOUND"});
    expect(await safety.block(m.a.token,{requestKey:m.requestKey})).toEqual({blocked:true});
  });
  it("rejects outsiders, extra fields and ambiguous interaction contexts", async () => {
    const m = await interaction(); const x = await socialActor(c.db,"X");
    for (const input of [{matchKey:m.matchKey,requestKey:m.requestKey},{profileId:m.peer.id},{matchKey:m.matchKey,extra:true},{}]) await expect(safety.block(m.a.token,input)).rejects.toMatchObject({code:"INVALID_INPUT"});
    await expect(safety.block(x.token,{matchKey:m.matchKey})).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(safety.report(x.token,{requestKey:m.requestKey,reason:"spam"})).rejects.toMatchObject({code:"NOT_FOUND"});
    expect((await c.db.query("SELECT * FROM social_blocks")).rows).toEqual([]);
  });
  it("stores bounded idempotent reports against concrete authorized history after blocking", async () => {
    const m = await interaction(); await safety.block(m.a.token,{matchKey:m.matchKey});
    const report = {matchKey:m.matchKey,reason:"harassment",text:"bounded evidence"};
    expect(await safety.report(m.a.token,report)).toEqual({reported:true});
    expect(await safety.report(m.a.token,{...report,text:"duplicate cannot rewrite evidence"})).toEqual({reported:true});
    expect(await safety.report(m.b.token,{requestKey:m.requestKey,reason:"unsafe_meeting"})).toEqual({reported:true});
    const rows = (await c.db.query("SELECT reason,text,reporter_profile_id,target_profile_id FROM social_reports ORDER BY created_at")).rows;
    expect(rows).toHaveLength(2); expect(rows[0]!.text).toBe("bounded evidence"); expect(rows[0]!.reporter_profile_id).toBe(m.own.id); expect(rows[0]!.target_profile_id).toBe(m.peer.id);
    for (const patch of [{reason:"unknown"},{text:"x".repeat(1001)},{reporterProfileId:m.peer.id},{requestKey:m.requestKey}]) await expect(safety.report(m.a.token,{...report,...patch})).rejects.toMatchObject({code:"INVALID_INPUT"});
  });
  it("enforces report membership, context and limits in PostgreSQL and client RLS", async () => {
    const m = await interaction(), x = await socialActor(c.db,"X"); const outsider = await c.db.transaction((tx) => requireProfile(tx,x.token));
    const sql = "INSERT INTO social_reports(reporter_profile_id,target_profile_id,request_id,match_id,reason,text) VALUES($1,$2,$3,$4,$5,$6)";
    for (const values of [[outsider.id,m.peer.id,m.requestId,null,"spam",null],[m.own.id,m.own.id,m.requestId,null,"spam",null],[m.own.id,m.peer.id,m.requestId,m.matchId,"spam",null],[m.own.id,m.peer.id,null,null,"spam",null],[m.own.id,m.peer.id,m.requestId,null,"other","x".repeat(1001)]]) await expect(c.db.query(sql,values)).rejects.toMatchObject({code:"23514"});
    await safety.report(m.a.token,{requestKey:m.requestKey,reason:"spam"});
    await c.db.transaction(async (tx) => { await tx.query("CREATE ROLE safety_client NOLOGIN"); await tx.query("GRANT SELECT ON social_reports TO safety_client"); await tx.query("SET LOCAL ROLE safety_client"); expect((await tx.query("SELECT * FROM social_reports")).rows).toEqual([]); });
    expect((await c.db.query("SELECT * FROM pg_policies WHERE tablename='social_reports'")).rows).toEqual([]);
  });
  it("serializes a queued block before acceptance under the shared profile locks", async () => {
    const m = await interaction(false);
    let release!: () => void, locked!: () => void; const ready = new Promise<void>((r) => { locked = r; }), hold = new Promise<void>((r) => { release = r; });
    const holder = c.db.transaction(async (tx) => { await lockProfiles(tx,[m.own.id,m.peer.id]); locked(); await hold; }); await ready;
    async function waitFor(count: number) { const deadline = Date.now()+3000; while ((await c.db.query<{count:number}>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%veya-social-profile:%'")).rows[0]!.count<count) { if (Date.now()>deadline) throw new Error("Expected queued profile lock"); await new Promise((r) => setTimeout(r,10)); } }
    const blocked = safety.block(m.a.token,{requestKey:m.requestKey}); let accepting: Promise<unknown> | undefined;
    try { await waitFor(1); accepting = new ConnectionsService(c.db).respond(m.b.token,m.requestKey,{action:"accept"}).then(() => null,(error) => error); await waitFor(2); } finally { release(); }
    await holder; expect(await blocked).toEqual({blocked:true}); expect(await accepting).toMatchObject({code:"NOT_FOUND"});
    expect((await c.db.query("SELECT * FROM social_matches")).rows).toEqual([]);
  });
  it("reauthorizes session expiry after waiting for profile locks", async () => {
    const m = await interaction(); await c.db.query("UPDATE guest_participant_sessions SET expires_at=clock_timestamp()+interval '400 milliseconds' WHERE token_hash=$1",[createHash("sha256").update(m.a.token).digest("hex")]);
    let release!: () => void, locked!: () => void; const ready = new Promise<void>((r) => { locked = r; }), hold = new Promise<void>((r) => { release = r; });
    const blocker = c.db.transaction(async (tx) => { await lockProfiles(tx,[m.own.id,m.peer.id]); locked(); await hold; }); await ready;
    const blocked = safety.block(m.a.token,{matchKey:m.matchKey}).then(() => null,(error) => error);
    const report = safety.report(m.a.token,{requestKey:m.requestKey,reason:"spam"}).then(() => null,(error) => error);
    try { await new Promise((r) => setTimeout(r,500)); } finally { release(); }
    await blocker; expect(await blocked).toMatchObject({code:"UNAUTHORIZED"}); expect(await report).toMatchObject({code:"UNAUTHORIZED"});
    expect((await c.db.query("SELECT * FROM social_blocks")).rows).toEqual([]); expect((await c.db.query("SELECT * FROM social_reports")).rows).toEqual([]);
  });
});
