import { describe, expect, it } from "vitest";
import { ownProfileSchema, projectIdentity, projectOwnProfile } from "@/features/social/privacy";
import type { ProfileRow } from "@/features/social/context";

const row: ProfileRow & Record<string, unknown> = {
  id: "internal-profile", alias: "Orion", privacy_mode: "PRIVATE", avatar_seed: "stable-seed",
  age_band: "25-29", languages: ["en"], created_at: new Date(),
  recovery_key_hash: "secret-hash", guest_id: "private-guest", token: "secret-token",
  contactHandle: "private-contact", exactLocation: "private-location",
};
function forbiddenKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(/(^id$|_id$|hash|token|contact|exactLocation|created_at)/i.test(key) ? [key] : []),
    ...forbiddenKeys(item),
  ]);
}
describe("social privacy projections", () => {
  it("whitelists the owner's explicit profile fields without secrets or UUIDs", () => {
    const profile = projectOwnProfile(row, true);
    expect(profile).toEqual({ alias: "Orion", privacyMode: "PRIVATE", avatarSeed: "stable-seed", ageBand: "25-29", languages: ["en"], hasRecoveryKey: true });
    expect(forbiddenKeys(profile)).toEqual([]);
    expect(ownProfileSchema.safeParse({ ...profile, id: row.id }).success).toBe(false);
  });
  it.each(["OPEN", "PRIVATE"] as const)("projects only stable identity in %s mode", (privacy_mode) => {
    const identity = projectIdentity({ ...row, privacy_mode }, { alias: "Pair Fox", avatarSeed: "pair-seed" });
    expect(identity).toEqual({ alias: "Orion", avatarSeed: "stable-seed" });
    expect(forbiddenKeys({ nested: [identity] })).toEqual([]);
  });
  it("always selects persisted pair identity for effective INCOGNITO mode", () => {
    const pair = { alias: "Pair Fox", avatarSeed: "pair-seed" };
    expect(projectIdentity({ ...row, privacy_mode: "INCOGNITO" }, pair)).toEqual(pair);
    expect(projectIdentity(row, pair, "INCOGNITO")).toEqual(pair);
    expect(projectIdentity({ ...row, privacy_mode: "INCOGNITO" }, pair, "OPEN")).toEqual(pair);
  });
});
