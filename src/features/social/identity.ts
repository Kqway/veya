import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database, DatabaseExecutor } from "@/lib/db/types";
import { requireSession } from "@/features/backend/sessions";
import { lockProfiles, reauthorize, requireProfile, type ProfileRow } from "./context";
import { fail, SocialError } from "./errors";
import { createProfileSchema, parseSocialInput, recoverySchema, updateProfileSchema } from "./profile-schema";
import { projectOwnProfile, type OwnProfile } from "./privacy";
const hash = (key: string) => createHash("sha256").update(key).digest("hex");
const newKey = () => randomBytes(32).toString("base64url");
async function hasKey(tx: DatabaseExecutor, id: string): Promise<boolean> {
  return (await tx.query<{ present: boolean }>("SELECT recovery_key_hash IS NOT NULL AS present FROM social_profiles WHERE id=$1", [id])).rows[0]?.present ?? false;
}
async function assertUnbound(tx: DatabaseExecutor, guestId: string) {
  if ((await tx.query("SELECT 1 FROM social_profile_bindings WHERE guest_id=$1", [guestId])).rows.length) fail("CONFLICT");
}
async function lockGuest(tx: DatabaseExecutor, guestId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('veya-social-guest:' || $1,0))", [guestId]);
}
export class IdentityService {
  constructor(private readonly db: Database) {}
  async create(token: string, input: unknown): Promise<{ profile: OwnProfile; recoveryKey: string }> {
    const data = parseSocialInput(createProfileSchema, input);
    return this.db.transaction(async (tx) => {
      const guestId = await requireSession(tx, token);
      await lockGuest(tx, guestId);
      await requireSession(tx, token);
      await assertUnbound(tx, guestId);
      const id = randomUUID();
      await lockProfiles(tx, [id]);
      await requireSession(tx, token);
      const recoveryKey = newKey();
      const result = await tx.query<ProfileRow>(
        "INSERT INTO social_profiles(id,alias,privacy_mode,avatar_seed,adult_confirmed,age_band,languages,recovery_key_hash) VALUES ($1,$2,$3,$4,true,$5,$6,$7) RETURNING id,alias,privacy_mode,avatar_seed,age_band,languages,created_at",
        [id, data.alias, data.privacyMode, randomBytes(16).toString("hex"), data.ageBand ?? null, data.languages ?? [], hash(recoveryKey)],
      );
      await tx.query("INSERT INTO social_profile_bindings(guest_id,profile_id) VALUES ($1,$2)", [guestId, id]);
      return { profile: projectOwnProfile(result.rows[0]!, true), recoveryKey };
    });
  }
  async get(token: string): Promise<OwnProfile | null> {
    return this.db.transaction(async (tx) => {
      let row: ProfileRow;
      try { row = await requireProfile(tx, token); }
      catch (error) { if (error instanceof SocialError && error.code === "NOT_FOUND") return null; throw error; }
      await lockProfiles(tx, [row.id]);
      row = await reauthorize(tx, token, row.id);
      return projectOwnProfile(row, await hasKey(tx, row.id));
    });
  }
  async update(token: string, input: unknown): Promise<OwnProfile> {
    const data = parseSocialInput(updateProfileSchema, input);
    return this.db.transaction(async (tx) => {
      const initial = await requireProfile(tx, token);
      await lockProfiles(tx, [initial.id]);
      const row = await reauthorize(tx, token, initial.id);
      const result = await tx.query<ProfileRow>(
        "UPDATE social_profiles SET alias=$2,privacy_mode=$3,age_band=$4,languages=$5,updated_at=now() WHERE id=$1 RETURNING id,alias,privacy_mode,avatar_seed,age_band,languages,created_at",
        [row.id, data.alias ?? row.alias, data.privacyMode ?? row.privacy_mode, data.ageBand === undefined ? row.age_band : data.ageBand, data.languages ?? row.languages],
      );
      return projectOwnProfile(result.rows[0]!, await hasKey(tx, row.id));
    });
  }
  async recover(token: string, input: unknown): Promise<{ profile: OwnProfile; recoveryKey: string }> {
    const parsed = recoverySchema.safeParse(input);
    if (!parsed.success) fail("NOT_FOUND");
    const keyHash = hash(parsed.data.key);
    return this.db.transaction(async (tx) => {
      const guestId = await requireSession(tx, token);
      await lockGuest(tx, guestId);
      await requireSession(tx, token);
      await assertUnbound(tx, guestId);
      const result = await tx.query<ProfileRow>("SELECT id,alias,privacy_mode,avatar_seed,age_band,languages,created_at FROM social_profiles WHERE recovery_key_hash=$1", [keyHash]);
      const initial = result.rows[0] ?? fail("NOT_FOUND");
      await lockProfiles(tx, [initial.id]);
      await requireSession(tx, token);
      await assertUnbound(tx, guestId);
      const rechecked = await tx.query<ProfileRow>("SELECT id,alias,privacy_mode,avatar_seed,age_band,languages,created_at FROM social_profiles WHERE id=$1 AND recovery_key_hash=$2", [initial.id, keyHash]);
      const row = rechecked.rows[0] ?? fail("NOT_FOUND");
      const recoveryKey = newKey();
      await tx.query("UPDATE social_profiles SET recovery_key_hash=$2,updated_at=now() WHERE id=$1", [row.id, hash(recoveryKey)]);
      // Record only server-proven social-linked plan identity before rotating the binding.
      // A later account deletion must still erase names/windows left by a former session.
      await tx.query(`INSERT INTO social_linked_plan_identities(plan_intent_id,profile_id,guest_id,is_creator)
       SELECT DISTINCT i.id,$1::uuid,b.guest_id,i.creator_guest_id=b.guest_id
       FROM social_profile_bindings b JOIN intents i ON i.creator_guest_id=b.guest_id
       OR EXISTS(SELECT 1 FROM participants p WHERE p.intent_id=i.id AND p.guest_id=b.guest_id)
       WHERE b.profile_id=$1 AND (
        EXISTS(SELECT 1 FROM social_matches m JOIN social_pairs pair ON pair.id=m.pair_id WHERE m.plan_intent_id=i.id AND $1 IN(pair.low_profile_id,pair.high_profile_id))
        OR EXISTS(SELECT 1 FROM social_rooms r JOIN social_lobby_members lm ON lm.lobby_id=r.lobby_id WHERE r.plan_intent_id=i.id AND lm.profile_id=$1))
       ON CONFLICT DO NOTHING`,[row.id]);
      await tx.query("DELETE FROM social_profile_bindings WHERE profile_id=$1", [row.id]);
      await tx.query("INSERT INTO social_profile_bindings(guest_id,profile_id) VALUES ($1,$2)", [guestId, row.id]);
      return { profile: projectOwnProfile(row, true), recoveryKey };
    });
  }
  async rotate(token: string): Promise<{ recoveryKey: string }> {
    return this.db.transaction(async (tx) => {
      const row = await requireProfile(tx, token);
      await lockProfiles(tx, [row.id]);
      await reauthorize(tx, token, row.id);
      const recoveryKey = newKey();
      await tx.query("UPDATE social_profiles SET recovery_key_hash=$2,updated_at=now() WHERE id=$1", [row.id, hash(recoveryKey)]);
      return { recoveryKey };
    });
  }
  async revokeKey(token: string): Promise<{ revoked: true }> {
    return this.db.transaction(async (tx) => {
      const row = await requireProfile(tx, token);
      await lockProfiles(tx, [row.id]);
      await reauthorize(tx, token, row.id);
      await tx.query("UPDATE social_profiles SET recovery_key_hash=NULL,updated_at=now() WHERE id=$1", [row.id]);
      return { revoked: true };
    });
  }
}
