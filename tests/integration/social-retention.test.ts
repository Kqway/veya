import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "@/lib/db/migrations";
import { cleanupSocial } from "@/lib/db/social-retention";
import { requireProfile, lockProfiles } from "@/features/social/context";
import { ensurePair, opaqueKey } from "@/features/social/pairs";
import { SafetyService } from "@/features/social/safety";
import { startTestDatabase } from "../support/postgres";
import { socialActor } from "../support/social";

describe("explicit bounded social retention", () => {
  let c: Awaited<ReturnType<typeof startTestDatabase>>;
  beforeAll(async () => { c = await startTestDatabase(); await applyMigrations(c.db); });
  afterAll(async () => c?.stop()); beforeEach(async () => { await c.db.query("TRUNCATE social_profiles CASCADE"); });
  async function fixture(status: "declined" | "pending" | "accepted" = "declined") {
    const a = await socialActor(c.db,"Retained A"), b = await socialActor(c.db,"Retained B");
    return c.db.transaction(async (tx) => {
      const own = await requireProfile(tx,a.token), peer = await requireProfile(tx,b.token); await lockProfiles(tx,[own.id,peer.id]); const pair = await ensurePair(tx,own,peer,"INCOGNITO","INCOGNITO");
      const key = opaqueKey(); const request = await tx.query<{id:string}>("INSERT INTO connection_requests(public_key,pair_id,sender_profile_id,recipient_profile_id,source_post_id,target_post_id,pending_slot,status,activity_label,created_at,updated_at) VALUES($1,$2,$3,$4,(SELECT id FROM seeking_posts WHERE public_key=$5),(SELECT id FROM seeking_posts WHERE public_key=$6),1,$7,'Chess',clock_timestamp()-interval '200 days',clock_timestamp()-interval '200 days') RETURNING id",[key,pair.id,own.id,peer.id,a.post.publicKey,b.post.publicKey,status]);
      await tx.query("UPDATE social_pairs SET created_at=clock_timestamp()-interval '200 days' WHERE id=$1",[pair.id]);
      await tx.query("UPDATE seeking_posts SET created_at=clock_timestamp()-interval '101 days',expires_at=clock_timestamp()-interval '100 days' WHERE profile_id=ANY($1::uuid[])",[[own.id,peer.id]]);
      const handle = opaqueKey(); await tx.query("INSERT INTO discovery_handles(public_handle,viewer_profile_id,source_post_id,target_post_id,pair_id,created_at) VALUES($1,$2,(SELECT id FROM seeking_posts WHERE public_key=$3),(SELECT id FROM seeking_posts WHERE public_key=$4),$5,clock_timestamp()-interval '100 days')",[handle,own.id,a.post.publicKey,b.post.publicKey,pair.id]);
      await tx.query("INSERT INTO discovery_passes(viewer_profile_id,target_profile_id,created_at) VALUES($1,$2,clock_timestamp()-interval '100 days')",[own.id,peer.id]);
      return {a,b,own,peer,pair,key,requestId:request.rows[0]!.id,handle};
    });
  }
  it("defaults to a dry run without changing posts, histories or stable identity", async () => {
    const f = await fixture(); const result = await cleanupSocial(c.db);
    expect(result).toEqual({dryRun:true,reports:0,handles:1,passes:1,posts:2,pairs:1});
    expect((await c.db.query("SELECT * FROM seeking_posts")).rows).toHaveLength(2); expect((await c.db.query("SELECT * FROM connection_requests")).rows).toHaveLength(1);
    expect((await c.db.query("SELECT * FROM social_profiles")).rows).toHaveLength(2); expect((await c.db.query("SELECT * FROM social_profile_bindings")).rows).toHaveLength(2);
    expect((await c.db.query("SELECT * FROM social_pairs WHERE id=$1",[f.pair.id])).rows).toHaveLength(1);
  });
  it("applies bounded expired posts and inactive histories while preserving profiles/bindings", async () => {
    await fixture("pending"); expect(await cleanupSocial(c.db,{apply:true})).toEqual({dryRun:false,reports:0,handles:1,passes:1,posts:2,pairs:1});
    for (const table of ["seeking_posts","seeking_availability","seeking_tags","social_pairs","connection_requests","pairwise_identities","discovery_handles","discovery_passes"]) expect((await c.db.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
    expect((await c.db.query("SELECT * FROM social_profiles")).rows).toHaveLength(2); expect((await c.db.query("SELECT * FROM social_profile_bindings")).rows).toHaveLength(2);
  });
  it("preserves report evidence for365 days and only then removes inactive pairs", async () => {
    const f = await fixture(); await new SafetyService(c.db).report(f.a.token,{requestKey:f.key,reason:"unsafe_meeting",text:"retained evidence"});
    await c.db.query("UPDATE social_reports SET created_at=clock_timestamp()-interval '200 days'");
    const recent = await cleanupSocial(c.db,{apply:true}); expect(recent.pairs).toBe(0); expect(recent.reports).toBe(0);
    expect((await c.db.query("SELECT text FROM social_reports")).rows).toEqual([{text:"retained evidence"}]);
    expect((await c.db.query("SELECT source_post_id,target_post_id FROM connection_requests")).rows).toEqual([{source_post_id:null,target_post_id:null}]);
    await c.db.query("UPDATE social_reports SET created_at=clock_timestamp()-interval '366 days'");
    expect(await cleanupSocial(c.db,{apply:true})).toMatchObject({reports:1,pairs:1});
  });
  it("does not delete open matches or an inactive pair while either member has active seeking", async () => {
    const f = await fixture("accepted");
    const m = await c.db.query<{id:string}>("INSERT INTO social_matches(public_key,pair_id,request_id,activity_label,created_at) VALUES($1,$2,$3,'Chess',clock_timestamp()-interval '200 days') RETURNING id",[opaqueKey(),f.pair.id,f.requestId]);
    await c.db.query("INSERT INTO conversations(match_id,created_at) VALUES($1,clock_timestamp()-interval '200 days')",[m.rows[0]!.id]);
    expect((await cleanupSocial(c.db,{apply:true})).pairs).toBe(0);
    await c.db.query("UPDATE social_matches SET status='closed',closed_at=clock_timestamp()-interval '190 days'"); await c.db.query("UPDATE conversations SET status='closed'");
    const postKey = opaqueKey(); await c.db.query("INSERT INTO seeking_posts(public_key,profile_id,active_slot,raw_text,activity_key,activity_label,interaction_mode,format,skill,languages,privacy_mode,expires_at) VALUES($1,$2,1,'Chess','chess','Chess','online','one_to_one','any',ARRAY['ru'],'INCOGNITO',clock_timestamp()+interval '1 day')",[postKey,f.own.id]);
    expect((await cleanupSocial(c.db,{apply:true})).pairs).toBe(0);
    await c.db.query("UPDATE seeking_posts SET status='closed' WHERE public_key=$1",[postKey]);
    expect((await cleanupSocial(c.db,{apply:true})).pairs).toBe(1);
  });
  it("deletes only sufficiently old closed chat and disclosure history with its pair", async () => {
    const f = await fixture("accepted");
    const m = await c.db.query<{id:string}>("INSERT INTO social_matches(public_key,pair_id,request_id,activity_label,status,created_at,closed_at) VALUES($1,$2,$3,'Chess','closed',clock_timestamp()-interval '200 days',clock_timestamp()-interval '190 days') RETURNING id",[opaqueKey(),f.pair.id,f.requestId]);
    const conv = await c.db.query<{id:string}>("INSERT INTO conversations(match_id,status,created_at) VALUES($1,'closed',clock_timestamp()-interval '200 days') RETURNING id",[m.rows[0]!.id]);
    await c.db.query("INSERT INTO messages(public_key,conversation_id,sender_profile_id,text,created_at) VALUES($1,$2,$3,'old message',clock_timestamp()-interval '185 days')",[opaqueKey(),conv.rows[0]!.id,f.own.id]);
    await c.db.query("INSERT INTO match_disclosures(match_id,sender_profile_id,kind,value,created_at) VALUES($1,$2,'first_name','Alice',clock_timestamp()-interval '185 days')",[m.rows[0]!.id,f.own.id]);
    expect((await cleanupSocial(c.db,{apply:true})).pairs).toBe(1);
    for (const table of ["social_matches","conversations","messages","match_disclosures"]) expect((await c.db.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
  });
  it("rechecks pair inactivity after profile-lock waits", async () => {
    const f = await fixture();
    // Remove earlier cleanup categories so the queued lock belongs to pair cleanup.
    await c.db.query("DELETE FROM discovery_handles"); await c.db.query("DELETE FROM discovery_passes");
    await c.db.query("UPDATE connection_requests SET source_post_id=NULL,target_post_id=NULL"); await c.db.query("DELETE FROM seeking_posts");
    let release!: () => void, locked!: () => void; const ready = new Promise<void>((r) => { locked = r; }), hold = new Promise<void>((r) => { release = r; });
    const holder = c.db.transaction(async (tx) => { await lockProfiles(tx,[f.own.id,f.peer.id]); locked(); await hold;
      await tx.query("INSERT INTO seeking_posts(public_key,profile_id,active_slot,raw_text,activity_key,activity_label,interaction_mode,format,skill,languages,privacy_mode,expires_at) VALUES($1,$2,1,'Chess','chess','Chess','online','one_to_one','any',ARRAY['ru'],'INCOGNITO',clock_timestamp()+interval '1 day')",[opaqueKey(),f.own.id]);
    }); await ready;
    const cleanup = cleanupSocial(c.db,{apply:true});
    try { const deadline = Date.now()+3000; while ((await c.db.query<{count:number}>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%veya-social-profile:%'")).rows[0]!.count<1) { if (Date.now()>deadline) throw new Error("Expected queued retention profile lock"); await new Promise((r) => setTimeout(r,10)); } } finally { release(); }
    await holder; expect((await cleanup).pairs).toBe(0);
    expect((await c.db.query("SELECT * FROM social_pairs WHERE id=$1",[f.pair.id])).rows).toHaveLength(1);
  });
  it("skips selected post rows locked by another maintenance transaction", async () => {
    const f = await fixture(); await c.db.query("DELETE FROM discovery_handles"); await c.db.query("DELETE FROM discovery_passes");
    let release!: () => void, locked!: () => void; const ready = new Promise<void>((r) => { locked = r; }), hold = new Promise<void>((r) => { release = r; });
    const holder = c.db.transaction(async (tx) => { await tx.query("SELECT id FROM seeking_posts ORDER BY expires_at,id FOR UPDATE"); locked(); await hold; }); await ready;
    try { const result = await cleanupSocial(c.db,{apply:true}); expect(result.posts).toBe(0); } finally { release(); }
    await holder; expect((await c.db.query("SELECT * FROM seeking_posts WHERE profile_id=ANY($1::uuid[])",[[f.own.id,f.peer.id]])).rows).toHaveLength(2);
  });
  it("preserves recently closed history and bounds every category independently", async () => {
    const f = await fixture(); await c.db.query("UPDATE connection_requests SET updated_at=clock_timestamp()-interval '10 days' WHERE id=$1",[f.requestId]);
    const result = await cleanupSocial(c.db,{apply:true,batchSize:1}); expect(result.posts).toBe(1); expect(result.handles).toBe(1); expect(result.passes).toBe(1); expect(result.pairs).toBe(0);
    expect((await c.db.query("SELECT * FROM seeking_posts")).rows).toHaveLength(1);
    for (const batchSize of [0,501,1.5]) await expect(cleanupSocial(c.db,{apply:true,batchSize})).rejects.toThrow("Batch size");
  });
});
