import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "@/lib/db/migrations";
import { createGuestSession, revokeGuestSession } from "@/features/backend/sessions";
import { IdentityService } from "@/features/social/identity";
import { lockProfiles } from "@/features/social/context";
import { VeyaBackend } from "@/features/backend/service";
import { startTestDatabase } from "../support/postgres";
let cluster: Awaited<ReturnType<typeof startTestDatabase>>;
let identity: IdentityService;
const input = { alias: "Orion", privacyMode: "PRIVATE", adultConfirmed: true, ageBand: "25-29", languages: ["en"] };
const digest = (key: string) => createHash("sha256").update(key).digest("hex");
const session = () => createGuestSession(cluster.db);
async function setup() { const guest = await session(); return { guest, created: await identity.create(guest.token, input) }; }
async function profileId(key: string) { return (await cluster.db.query<{ id: string }>("SELECT id FROM social_profiles WHERE recovery_key_hash=$1", [digest(key)])).rows[0]!.id; }
function gate() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
async function until(check: () => Promise<boolean>) { const deadline = Date.now() + 4000; while (!(await check())) { if (Date.now() > deadline) throw new Error("Expected database condition"); await new Promise((r) => setTimeout(r, 10)); } }
beforeAll(async () => { cluster = await startTestDatabase(); await applyMigrations(cluster.db); identity = new IdentityService(cluster.db); });
afterAll(async () => cluster?.stop());
describe("social identity and recovery", () => {
  it("creates an adult profile and returns its one-time cryptographic key without internal fields", async () => {
    const { guest, created } = await setup();
    expect(created.recoveryKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.profile).toEqual({ alias: "Orion", privacyMode: "PRIVATE", avatarSeed: expect.any(String), ageBand: "25-29", languages: ["en"], hasRecoveryKey: true });
    expect(await identity.get(guest.token)).toEqual(created.profile);
    const saved = (await cluster.db.query<{ recovery_key_hash: string }>("SELECT recovery_key_hash FROM social_profiles WHERE recovery_key_hash=$1", [digest(created.recoveryKey)])).rows[0]!;
    expect(saved.recovery_key_hash).not.toBe(created.recoveryKey);
    await expect(identity.create(guest.token, input)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each([{ adultConfirmed: false }, { adultConfirmed: undefined }, { dob: "2000-01-01" }, { ageBand: "under18" }, { alias: " " }, { languages: ["en", "en"] }, { privacyMode: "PUBLIC" }])("rejects invalid or extra creation input %j", async (change) => {
    const guest = await session();
    await expect(identity.create(guest.token, { ...input, ...change })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await identity.get(guest.token)).toBeNull();
  });
  it("strictly updates allowed owner fields and preserves the avatar/key", async () => {
    const { guest, created } = await setup();
    const updated = await identity.update(guest.token, { alias: "Vega", privacyMode: "INCOGNITO", ageBand: null, languages: ["fr"] });
    expect(updated).toEqual({ ...created.profile, alias: "Vega", privacyMode: "INCOGNITO", ageBand: null, languages: ["fr"] });
    await expect(identity.update(guest.token, { id: "not-client-owned" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(identity.update(guest.token, {})).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("recovery rotates the key and detaches social access while preserving original guest plan ownership", async () => {
    const { guest, created } = await setup(); const fresh = await session();
    const backend = new VeyaBackend(cluster.db);
    const plan = await backend.createIntent(guest.token, { rawText: "Chess together" });
    const recovered = await identity.recover(fresh.token, { key: created.recoveryKey });
    expect(recovered.profile).toEqual(created.profile);
    expect(recovered.recoveryKey).not.toBe(created.recoveryKey);
    expect(await identity.get(guest.token)).toBeNull();
    expect(await identity.get(fresh.token)).toEqual(created.profile);
    expect((await backend.getIntent(plan.intent.publicSlug, guest.token)).isCreator).toBe(true);
    const another = await session();
    await expect(identity.recover(another.token, { key: created.recoveryKey })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(identity.recover(fresh.token, { key: recovered.recoveryKey })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(identity.update(guest.token, { alias: "Detached" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rotation and revocation invalidate keys immediately with generic errors", async () => {
    const { guest, created } = await setup(); const fresh = await session();
    const rotated = await identity.rotate(guest.token);
    await expect(identity.recover(fresh.token, { key: created.recoveryKey })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await identity.revokeKey(guest.token)).toEqual({ revoked: true });
    expect((await identity.get(guest.token))?.hasRecoveryKey).toBe(false);
    await expect(identity.recover(fresh.token, { key: rotated.recoveryKey })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(identity.recover(fresh.token, { key: "invalid" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(identity.recover(fresh.token, { key: "x".repeat(43), id: "injected" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("requires active sessions for every read and mutation", async () => {
    const { guest, created } = await setup(); await revokeGuestSession(cluster.db, guest.token);
    for (const call of [() => identity.get(guest.token), () => identity.update(guest.token, { alias: "Revoked" }), () => identity.rotate(guest.token), () => identity.revokeKey(guest.token), () => identity.recover(guest.token, { key: created.recoveryKey })]) await expect(call()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const expired = await session(); await cluster.db.query("UPDATE guest_participant_sessions SET created_at=now()-interval '2 seconds',expires_at=now()-interval '1 second' WHERE token_hash=$1", [digest(expired.token)]);
    await expect(identity.create(expired.token, input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("admits at most one creation and one recovery for concurrent requests", async () => {
    const guest = await session();
    const creates = await Promise.allSettled([identity.create(guest.token, input), identity.create(guest.token, input)]);
    expect(creates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const created = creates.find((r) => r.status === "fulfilled")!; if (created.status !== "fulfilled") throw new Error("No profile");
    const first = await session(), second = await session();
    const recoveries = await Promise.allSettled([identity.recover(first.token, { key: created.value.recoveryKey }), identity.recover(second.token, { key: created.value.recoveryKey })]);
    expect(recoveries.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await identity.get(guest.token)).toBeNull();
  });
  it("rechecks expired sessions after profile lock waits", async () => {
    const { guest, created } = await setup(); const id = await profileId(created.recoveryKey);
    await cluster.db.query("UPDATE guest_participant_sessions SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE token_hash=$1", [digest(guest.token)]);
    const ready = gate(), release = gate();
    const holder = cluster.db.transaction(async (tx) => { await lockProfiles(tx, [id]); ready.resolve(); await release.promise; });
    await ready.promise;
    const pending = identity.update(guest.token, { alias: "Expired" }).then(() => null, (error) => error);
    try {
      await until(async () => (await cluster.db.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'")).rows[0]!.count > 0);
      await until(async () => (await cluster.db.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() AS expired FROM guest_participant_sessions WHERE token_hash=$1", [digest(guest.token)])).rows[0]!.expired);
    } finally { release.resolve(); }
    await holder; expect(await pending).toMatchObject({ code: "UNAUTHORIZED" });
    expect((await cluster.db.query<{ alias: string }>("SELECT alias FROM social_profiles WHERE id=$1", [id])).rows[0]!.alias).toBe("Orion");
  });
  it("rejects an old binding after recovery wins a queued profile lock", async () => {
    const { guest, created } = await setup(); const fresh = await session(); const id = await profileId(created.recoveryKey);
    const ready = gate(), release = gate();
    const holder = cluster.db.transaction(async (tx) => { await lockProfiles(tx, [id]); ready.resolve(); await release.promise; });
    await ready.promise;
    const blocked = async () => (await cluster.db.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%veya-social-profile:%'")).rows[0]!.count;
    const recovery = identity.recover(fresh.token, { key: created.recoveryKey }).then((result) => ({ result, error: null }), (error) => ({ result: null, error }));
    let update: Promise<unknown> | undefined;
    try {
      await until(async () => await blocked() === 1);
      update = identity.update(guest.token, { alias: "Detached attacker" }).then(() => null, (error) => error);
      await until(async () => await blocked() === 2);
    } finally { release.resolve(); }
    await holder; expect((await recovery).error).toBeNull();
    expect(await update).toMatchObject({ code: "NOT_FOUND" });
    expect((await identity.get(fresh.token))?.alias).toBe("Orion");
  });
  it("recovery rechecks guest expiry after waiting for the target lock", async () => {
    const { created } = await setup(); const fresh = await session(); const id = await profileId(created.recoveryKey);
    await cluster.db.query("UPDATE guest_participant_sessions SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE token_hash=$1", [digest(fresh.token)]);
    const ready = gate(), release = gate();
    const holder = cluster.db.transaction(async (tx) => { await lockProfiles(tx, [id]); ready.resolve(); await release.promise; });
    await ready.promise;
    const recovery = identity.recover(fresh.token, { key: created.recoveryKey }).then(() => null, (error) => error);
    try {
      await until(async () => (await cluster.db.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%veya-social-profile:%'")).rows[0]!.count > 0);
      await until(async () => (await cluster.db.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() AS expired FROM guest_participant_sessions WHERE token_hash=$1", [digest(fresh.token)])).rows[0]!.expired);
    } finally { release.resolve(); }
    await holder; expect(await recovery).toMatchObject({ code: "UNAUTHORIZED" });
    expect(await profileId(created.recoveryKey)).toBe(id);
  });
  it("enforces one binding per guest, foreign keys and guest deletion cascade", async () => {
    const { guest, created } = await setup(); const id = await profileId(created.recoveryKey);
    const guestId = (await cluster.db.query<{ guest_id: string }>("SELECT guest_id FROM social_profile_bindings WHERE profile_id=$1", [id])).rows[0]!.guest_id;
    await expect(cluster.db.query("INSERT INTO social_profile_bindings(guest_id,profile_id) VALUES ($1,$2)", [guestId, id])).rejects.toMatchObject({ code: "23505" });
    await expect(cluster.db.query("INSERT INTO social_profile_bindings(guest_id,profile_id) VALUES ('00000000-0000-0000-0000-000000000000',$1)", [id])).rejects.toMatchObject({ code: "23503" });
    await cluster.db.query("DELETE FROM guest_participant_sessions WHERE id=$1", [guestId]);
    expect((await cluster.db.query("SELECT 1 FROM social_profile_bindings WHERE profile_id=$1", [id])).rows).toEqual([]);
    expect((await cluster.db.query("SELECT 1 FROM social_profiles WHERE id=$1", [id])).rows).toHaveLength(1);
    await expect(identity.get(guest.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("enforces database constraints and hides social tables from client roles", async () => {
    const { created } = await setup(); const id = await profileId(created.recoveryKey);
    for (const sql of ["UPDATE social_profiles SET adult_confirmed=false WHERE id=$1", "UPDATE social_profiles SET alias='' WHERE id=$1", "UPDATE social_profiles SET privacy_mode='PUBLIC' WHERE id=$1", "UPDATE social_profiles SET age_band='under18' WHERE id=$1", "UPDATE social_profiles SET languages=ARRAY['en','en'] WHERE id=$1", "UPDATE social_profiles SET recovery_key_hash='plaintext' WHERE id=$1"]) await expect(cluster.db.query(sql, [id])).rejects.toMatchObject({ code: "23514" });
    await cluster.db.transaction(async (tx) => {
      await tx.query("CREATE ROLE social_client NOLOGIN"); await tx.query("GRANT SELECT, INSERT ON social_profiles,social_profile_bindings TO social_client"); await tx.query("SET LOCAL ROLE social_client");
      expect((await tx.query("SELECT * FROM social_profiles")).rows).toEqual([]);
      expect((await tx.query("SELECT * FROM social_profile_bindings")).rows).toEqual([]);
      await expect(tx.query("INSERT INTO social_profiles(alias,privacy_mode,avatar_seed,adult_confirmed) VALUES ('Hacker','OPEN','seed',true)")).rejects.toMatchObject({ code: "42501" });
    });
  });
});
