import "server-only";
import type { DatabaseExecutor } from "@/lib/db/types";
import { requireSession } from "@/features/backend/sessions";
import { fail } from "./errors";
export interface ProfileRow {
  id: string;
  alias: string;
  privacy_mode: "OPEN" | "PRIVATE" | "INCOGNITO";
  avatar_seed: string;
  age_band: string | null;
  languages: string[];
  created_at: Date;
}
/** Lookup only. Callers lock all involved profiles, then reauthorize after waits. */
export async function requireProfile(tx: DatabaseExecutor, token: string): Promise<ProfileRow> {
  const guestId = await requireSession(tx, token);
  const result = await tx.query<ProfileRow>(
    "SELECT p.id,p.alias,p.privacy_mode,p.avatar_seed,p.age_band,p.languages,p.created_at FROM social_profiles p JOIN social_profile_bindings b ON b.profile_id=p.id WHERE b.guest_id=$1", [guestId],
  );
  return result.rows[0] ?? fail("NOT_FOUND");
}
export async function reauthorize(tx: DatabaseExecutor, token: string, profileId: string): Promise<ProfileRow> {
  const profile = await requireProfile(tx, token);
  if (profile.id !== profileId) fail("NOT_FOUND");
  return profile;
}
export async function lockProfiles(tx: DatabaseExecutor, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('veya-social-profile:' || $1,0))", [id]);
  }
}
