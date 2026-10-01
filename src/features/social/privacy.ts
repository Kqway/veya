import { z } from "zod";
import type { ProfileRow } from "./context";
import { ageBandSchema, aliasSchema, languagesSchema, privacyModeSchema } from "./profile-schema";
export const identitySchema = z.object({ alias: aliasSchema, avatarSeed: z.string().min(1).max(80) }).strict();
export const ownProfileSchema = identitySchema.extend({
  privacyMode: privacyModeSchema, ageBand: ageBandSchema.nullable(), languages: languagesSchema, hasRecoveryKey: z.boolean(),
}).strict();
export type OwnProfile = z.infer<typeof ownProfileSchema>;
export type PairIdentity = z.infer<typeof identitySchema>;
/** Build a DTO field by field; never spread a persisted row into public data. */
export function projectOwnProfile(row: ProfileRow, hasRecoveryKey: boolean): OwnProfile {
  return ownProfileSchema.parse({ alias: row.alias, privacyMode: row.privacy_mode, avatarSeed: row.avatar_seed, ageBand: row.age_band, languages: [...row.languages], hasRecoveryKey });
}
export function projectIdentity(row: ProfileRow, pairIdentity: PairIdentity, effectivePrivacy?: ProfileRow["privacy_mode"]): PairIdentity {
  return identitySchema.parse(row.privacy_mode === "INCOGNITO" || effectivePrivacy === "INCOGNITO"
    ? { alias: pairIdentity.alias, avatarSeed: pairIdentity.avatarSeed }
    : { alias: row.alias, avatarSeed: row.avatar_seed });
}
