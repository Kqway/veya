import type { Database } from "@/lib/db/types";
import { createGuestSession } from "@/features/backend/sessions";
import { IdentityService } from "@/features/social/identity";
import { SeekingService } from "@/features/social/seeking";
export const seekingInput = (patch: Record<string, unknown> = {}) => ({
  rawText: "Play chess in Moscow",
  activityKey: "chess",
  activityLabel: "Chess",
  interactionMode: "in_person",
  format: "one_to_one",
  city: "Moscow",
  area: "North",
  availability: [
    {
      startAt: new Date(Date.now() + 86400000).toISOString(),
      endAt: new Date(Date.now() + 90000000).toISOString(),
    },
  ],
  skill: "intermediate",
  languages: ["ru"],
  ...patch,
});
export async function socialActor(
  db: Database,
  alias: string,
  mode: "OPEN" | "PRIVATE" | "INCOGNITO" = "INCOGNITO",
  patch: Record<string, unknown> = {},
) {
  const { token } = await createGuestSession(db);
  const identity = await new IdentityService(db).create(token, {
    alias,
    privacyMode: mode,
    adultConfirmed: true,
    ageBand: "25-29",
    languages: ["ru"],
  });
  const post = await new SeekingService(db).create(token, seekingInput(patch));
  return { token, profile: identity.profile, key: identity.recoveryKey, post };
}
export function forbiddenKeys(value: unknown, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => {
    const next = path ? `${path}.${k}` : k;
    return [
      ...(/^(?:id|profile_?id|guest_?id|sender_?id|session.*|token.*|recovery.*|email|ip|city|area|availability|notes|contact.*|rawText|ageBand|score|fingerprint)$/i.test(
        k,
      )
        ? [next]
        : []),
      ...forbiddenKeys(v, next),
    ];
  });
}
