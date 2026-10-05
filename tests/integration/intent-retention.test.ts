import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { socialActor, seekingInput } from "../support/social";
import { applyMigrations } from "@/lib/db/migrations";
import { cleanupSocial } from "@/lib/db/social-retention";
import { cleanupIntentData } from "@/lib/db/intent-retention";
import { requireProfile } from "@/features/social/context";
import { opaqueKey } from "@/features/social/pairs";
import { searchDraftSchema } from "@/features/intent-product/schema";
let c: Awaited<ReturnType<typeof startTestDatabase>>;
beforeAll(async () => { c = await startTestDatabase(); await applyMigrations(c.db); });
afterAll(async () => { if (c) await c.stop(); });
beforeEach(async () => { await c.db.query("TRUNCATE social_profiles CASCADE"); });

async function context(options: { old?: boolean; recentMessage?: boolean; roomStatus?: "active" | "completed" | "closed" | "archived" } = {}) {
  const old = options.old ?? true;
  const a = await socialActor(c.db, "Retention owner"), b = await socialActor(c.db, "Retention participant");
  const owner = await c.db.transaction((tx) => requireProfile(tx, a.token)), participant = await c.db.transaction((tx) => requireProfile(tx, b.token));
  const posts = (await c.db.query<{ id: string; profile_id: string }>("SELECT id,profile_id FROM seeking_posts WHERE public_key=ANY($1::text[])", [[a.post.publicKey, b.post.publicKey]])).rows;
  const ownerPost = posts.find((p) => p.profile_id === owner.id)!.id, targetPost = posts.find((p) => p.profile_id === participant.id)!.id;
  const createdAt = new Date(Date.now() - (old ? 400 * 86400000 : 1000)), expiresAt = new Date(createdAt.getTime() + 10 * 86400000);
  if (old) await c.db.query("UPDATE seeking_posts SET status='closed',created_at=$2,expires_at=$3 WHERE profile_id=ANY($1::uuid[])", [[owner.id, participant.id], createdAt, expiresAt]);
  const draft = searchDraftSchema.parse({ seeking: seekingInput({ availability: [{ startAt: new Date(createdAt.getTime() + 86400000).toISOString(), endAt: new Date(createdAt.getTime() + 90000000).toISOString() }] }), neededPeople: 1, existingPeople: 1, attributes: {}, timezone: "UTC" });
  const search = (await c.db.query<{ id: string }>("INSERT INTO social_action_searches(public_key,profile_id,post_id,activity_label,status,draft,needed_people,existing_people,created_at,expires_at) VALUES($1,$2,$3,'Chess',$4,$5,1,1,$6,$7) RETURNING id", [opaqueKey(), owner.id, ownerPost, old ? "filled" : "active", JSON.stringify(draft), createdAt, expiresAt])).rows[0]!.id;
  const lobby = (await c.db.query<{ id: string }>("INSERT INTO social_lobbies(search_id,owner_profile_id,capacity,external_count,created_at) VALUES($1,$2,2,0,$3) RETURNING id", [search, owner.id, createdAt])).rows[0]!.id;
  const offerCreated = createdAt;
  await c.db.query("INSERT INTO social_candidate_offers(public_key,search_id,recipient_profile_id,target_post_id,pending_slot,status,source_revision,created_at,expires_at) VALUES($1,$2,$3,$4,1,'accepted',1,$5,$6)", [opaqueKey(), search, participant.id, targetPost, offerCreated, new Date(offerCreated.getTime() + 3600000)]);
  for (const person of [owner, participant]) await c.db.query("INSERT INTO social_lobby_members(lobby_id,profile_id,public_key,alias,avatar_seed,privacy_mode,created_at) VALUES($1,$2,$3,'Participant',$4,'INCOGNITO',$5)", [lobby, person.id, opaqueKey(), "a".repeat(32), createdAt]);
  await c.db.query("UPDATE social_lobbies SET status='ready' WHERE id=$1", [lobby]);
  const room = (await c.db.query<{ id: string }>("INSERT INTO social_rooms(public_key,lobby_id,created_at) VALUES($1,$2,$3) RETURNING id", [opaqueKey(), lobby, createdAt])).rows[0]!.id;
  await c.db.query("INSERT INTO social_room_messages(public_key,room_id,author_profile_id,text,created_at) VALUES($1,$2,$3,'Retained conversation',$4)", [opaqueKey(), room, owner.id, options.recentMessage ? new Date() : createdAt]);
  await c.db.query("UPDATE social_rooms SET status=$2 WHERE id=$1", [room, options.roomStatus ?? (old ? "completed" : "active")]);
  await c.db.query("UPDATE social_lobbies SET status=$2 WHERE id=$1", [lobby, options.roomStatus ?? (old ? "completed" : "active")]);
  await c.db.query("INSERT INTO social_intent_jobs(search_id,status,available_at,finished_at) VALUES($1,'completed',clock_timestamp()-interval '8 days',clock_timestamp()-interval '8 days')", [search]);
  return { search, lobby, room, owner, participant, a, b };
}
async function report(ctx: Awaited<ReturnType<typeof context>>, status: "open" | "resolved" | "dismissed", days: number, updatedDays = days) {
  return (await c.db.query<{ id: string }>("INSERT INTO social_reports(reporter_profile_id,target_profile_id,room_id,reason,status,created_at,updated_at) VALUES($1,$2,$3,'other',$4,clock_timestamp()-$5::int*interval '1 day',clock_timestamp()-$6::int*interval '1 day') RETURNING id", [ctx.owner.id, ctx.participant.id, ctx.room, status, days, updatedDays])).rows[0]!.id;
}
it("defaults to a bounded preview and cascades old inactive action contexts only on apply", async () => {
  const first = await context(), second = await context();
  expect(await cleanupIntentData(c.db, { batchSize: 1 })).toMatchObject({ dryRun: true, searches: 1, jobs: 1, reports: 0 });
  expect((await c.db.query("SELECT id FROM social_action_searches")).rowCount).toBe(2);
  expect(await cleanupIntentData(c.db, { apply: true, batchSize: 1 })).toMatchObject({ dryRun: false, searches: 1, jobs: 1 });
  expect((await c.db.query("SELECT id FROM social_action_searches WHERE id=ANY($1::uuid[])", [[first.search, second.search]])).rowCount).toBe(1);
  await cleanupIntentData(c.db, { apply: true });
  for (const table of ["social_action_searches", "social_lobbies", "social_lobby_members", "social_candidate_offers", "social_rooms", "social_room_messages", "social_intent_jobs"]) expect((await c.db.query(`SELECT * FROM ${table}`)).rowCount).toBe(0);
  expect((await c.db.query("SELECT id FROM social_profiles")).rowCount).toBe(4);
  expect(await cleanupIntentData(c.db, { apply: true })).toEqual({ dryRun: false, reports: 0, searches: 0, jobs: 0 });
});
it("retains active rooms, current searches, recent chat and any participant's active future seeking", async () => {
  const live = await context({ old: false }), activeRoom = await context({ roomStatus: "active" }), chat = await context({ recentMessage: true }), seeking = await context();
  await c.db.query("UPDATE seeking_posts SET status='active',created_at=clock_timestamp(),expires_at=clock_timestamp()+interval '2 days' WHERE public_key=$1", [seeking.b.post.publicKey]);
  expect((await cleanupIntentData(c.db, { apply: true })).searches).toBe(0);
  expect((await c.db.query("SELECT id FROM social_action_searches WHERE id=ANY($1::uuid[])", [[live.search, activeRoom.search, chat.search, seeking.search]])).rowCount).toBe(4);
});
it("keeps open and recent/resolved evidence, then purges eligible old reports before their entire context", async () => {
  const open = await context(), recent = await context(), recentlyResolved = await context(), resolved = await context();
  await report(open, "open", 400); await report(recent, "resolved", 200); await report(recentlyResolved, "resolved", 400, 1); await report(resolved, "resolved", 400);
  expect(await cleanupIntentData(c.db)).toMatchObject({ dryRun: true, reports: 1, searches: 1 });
  expect((await c.db.query("SELECT id FROM social_reports")).rowCount).toBe(4);
  expect(await cleanupIntentData(c.db, { apply: true })).toMatchObject({ reports: 1, searches: 1 });
  expect((await c.db.query("SELECT id FROM social_reports")).rowCount).toBe(3);
  expect((await c.db.query("SELECT id FROM social_rooms WHERE id=$1", [resolved.room])).rowCount).toBe(0);
  expect((await c.db.query("SELECT id FROM social_rooms")).rowCount).toBe(3);
});
it("does not purge contexts with a valid pending offer to a historical recipient", async () => {
  const old = await context(), third = await socialActor(c.db, "Offer recipient");
  const profile = await c.db.transaction((tx) => requireProfile(tx, third.token));
  await c.db.query("UPDATE seeking_posts SET status='closed' WHERE profile_id=$1", [profile.id]);
  await c.db.query("INSERT INTO social_candidate_offers(public_key,search_id,recipient_profile_id,target_post_id,pending_slot,status,source_revision,expires_at) VALUES($1,$2,$3,(SELECT id FROM seeking_posts WHERE public_key=$4),2,'pending',1,clock_timestamp()+interval '1 hour')", [opaqueKey(), old.search, profile.id, third.post.publicKey]);
  expect((await cleanupIntentData(c.db, { apply: true })).searches).toBe(0);
});
it("deletes only finite old terminal jobs including cancelled jobs without finished_at", async () => {
  const completed = await context({ old: false }), cancelled = await context({ old: false }), pending = await context({ old: false }), processing = await context({ old: false }), recent = await context({ old: false });
  // New seekers re-enqueue earlier active searches; set terminal fixtures after all actors exist.
  await c.db.query("UPDATE social_intent_jobs SET status='completed',available_at=clock_timestamp()-interval '8 days',finished_at=clock_timestamp()-interval '8 days' WHERE search_id=$1", [completed.search]);
  await c.db.query("UPDATE social_intent_jobs SET status='cancelled',finished_at=NULL,available_at=clock_timestamp()-interval '8 days' WHERE search_id=$1", [cancelled.search]);
  await c.db.query("UPDATE social_intent_jobs SET status='pending',finished_at=NULL WHERE search_id=$1", [pending.search]);
  await c.db.query("UPDATE social_intent_jobs SET status='processing',finished_at=NULL,lease_key=$2,lease_until=clock_timestamp()+interval '1 minute' WHERE search_id=$1", [processing.search, opaqueKey()]);
  await c.db.query("UPDATE social_intent_jobs SET finished_at=clock_timestamp() WHERE search_id=$1", [recent.search]);
  expect(await cleanupIntentData(c.db)).toMatchObject({ jobs: 2, searches: 0 });
  expect(await cleanupIntentData(c.db, { apply: true })).toMatchObject({ jobs: 2, searches: 0 });
  expect((await c.db.query("SELECT search_id FROM social_intent_jobs ORDER BY search_id")).rows.map((r) => r.search_id)).toEqual([pending.search, processing.search, recent.search].sort());
  expect((await c.db.query("SELECT id FROM social_action_searches WHERE id=$1", [completed.search])).rowCount).toBe(1);
});
it("concurrent cleanup runs purge each search and job once", async () => {
  await context(); await context();
  const results = await Promise.all([cleanupIntentData(c.db, { apply: true }), cleanupIntentData(c.db, { apply: true })]);
  expect(results.reduce((sum, r) => sum + r.searches, 0)).toBe(2);
  expect(results.reduce((sum, r) => sum + r.jobs, 0)).toBe(2);
  expect((await c.db.query("SELECT id FROM social_action_searches")).rowCount).toBe(0);
});
it("skips a locked search and supports interruption before maintenance", async () => {
  const old = await context();
  let ready!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { ready = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
  const holder = c.db.transaction(async (tx) => { await tx.query("SELECT id FROM social_action_searches WHERE id=$1 FOR UPDATE", [old.search]); ready(); await gate; });
  await entered;
  try { expect((await cleanupIntentData(c.db, { apply: true })).searches).toBe(0); } finally { release(); await holder; }
  const controller = new AbortController(); controller.abort();
  expect(await cleanupIntentData(c.db, { apply: true, signal: controller.signal })).toEqual({ dryRun: false, reports: 0, searches: 0, jobs: 0 });
  expect((await cleanupIntentData(c.db, { apply: true })).searches).toBe(1);
});
it.each([0, 501, -1, 1.5])("rejects invalid batch size %s", async (batchSize) => { await expect(cleanupIntentData(c.db, { batchSize })).rejects.toThrow(/batch/i); });

it("retries with all new recipient profile locks when the snapshot changes while waiting", async () => {
  const old = await context(), third = await socialActor(c.db, "Recipient added while waiting");
  const recipient = await c.db.transaction((tx) => requireProfile(tx, third.token));
  await c.db.query("UPDATE seeking_posts SET status='closed' WHERE profile_id=$1", [recipient.id]);
  await c.db.query("DELETE FROM social_intent_jobs WHERE search_id=$1", [old.search]);
  let ownerTx!: import("@/lib/db/types").DatabaseExecutor;
  let ownerReady!: () => void, ownerRelease!: () => void, recipientReady!: () => void, recipientRelease!: () => void;
  const ownerEntered = new Promise<void>((resolve) => { ownerReady = resolve; }), ownerGate = new Promise<void>((resolve) => { ownerRelease = resolve; });
  const recipientEntered = new Promise<void>((resolve) => { recipientReady = resolve; }), recipientGate = new Promise<void>((resolve) => { recipientRelease = resolve; });
  const ownerHeld = c.db.transaction(async (tx) => {
    ownerTx = tx;
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('veya-social-profile:' || $1,0))", [old.owner.id]);
    ownerReady(); await ownerGate;
  });
  await ownerEntered;
  const cleanup = cleanupIntentData(c.db, { apply: true });
  let completed = false;
  void cleanup.then(() => { completed = true; }, () => { completed = true; });
  let recipientHeld: Promise<void> | undefined;
  try {
    // Observe the real profile lock wait, ensuring the first snapshot has already happened.
    const deadline = Date.now() + 2000;
    for (;;) {
      const waits = await c.db.query("SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE '%veya-social-profile:%'");
      if (waits.rowCount) break;
      if (Date.now() > deadline) throw new Error("Cleanup did not reach its profile lock barrier");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    recipientHeld = c.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('veya-social-profile:' || $1,0))", [recipient.id]);
      recipientReady(); await recipientGate;
    });
    await recipientEntered;
    // Valid SQL fixture state: a terminal offer adds another historical recipient.
    await ownerTx.query("INSERT INTO social_candidate_offers(public_key,search_id,recipient_profile_id,target_post_id,pending_slot,status,source_revision,expires_at) VALUES($1,$2,$3,(SELECT id FROM seeking_posts WHERE public_key=$4),2,'declined',1,clock_timestamp()+interval '1 hour')", [opaqueKey(), old.search, recipient.id, third.post.publicKey]);
    ownerRelease(); await ownerHeld;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(completed).toBe(false);
    expect((await c.db.query("SELECT id FROM social_action_searches WHERE id=$1", [old.search])).rowCount).toBe(1);
  } finally {
    ownerRelease(); recipientRelease();
    await ownerHeld; if (recipientHeld) await recipientHeld;
  }
  expect((await cleanup).searches).toBe(1);
});

it("the full maintenance sequence preserves a recently resolved old room complaint",async()=>{
 const item=await context();const id=await report(item,"resolved",400,1);
 await cleanupIntentData(c.db,{apply:true});await cleanupSocial(c.db,{apply:true});
 expect((await c.db.query("SELECT id FROM social_reports WHERE id=$1",[id])).rowCount).toBe(1);
 expect((await c.db.query("SELECT id FROM social_action_searches WHERE id=$1",[item.search])).rowCount).toBe(1);
});
