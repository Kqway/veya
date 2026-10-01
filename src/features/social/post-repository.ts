import "server-only";
import type { DatabaseExecutor } from "@/lib/db/types";
import type { SeekingCandidate } from "@/features/discovery/types";
import type { ProfileRow } from "./context";
import { fail } from "./errors";
import { ownPostSchema, strongerMode } from "./seeking-schema";
export type PostRow = {
  id: string;
  public_key: string;
  profile_id: string;
  raw_text: string;
  activity_key: string;
  activity_label: string;
  interaction_mode: "in_person" | "online" | "either";
  format: "one_to_one" | "group" | "either";
  city: string | null;
  area: string | null;
  skill: SeekingCandidate["skill"];
  languages: string[];
  desired_age_bands: string[];
  group_size: number | null;
  privacy_mode: "OPEN" | "PRIVATE" | "INCOGNITO";
  status: "active" | "closed";
  expires_at: Date;
};
export async function readPost(
  tx: DatabaseExecutor,
  key: string,
  owner?: string,
): Promise<PostRow> {
  const r = await tx.query<PostRow>(
    `SELECT * FROM seeking_posts WHERE public_key=$1${owner ? " AND profile_id=$2" : ""}`,
    [key, ...(owner ? [owner] : [])],
  );
  if (!r.rows[0]) fail("NOT_FOUND");
  return r.rows[0]!;
}
export async function candidate(
  tx: DatabaseExecutor,
  row: PostRow,
  profile: ProfileRow,
): Promise<SeekingCandidate> {
  const windows = await tx.query<{ start_at: Date; end_at: Date }>(
    "SELECT start_at,end_at FROM seeking_availability WHERE post_id=$1 ORDER BY start_at",
    [row.id],
  );
  const tags = await tx.query<{ value: string }>(
    "SELECT value FROM seeking_tags WHERE post_id=$1 ORDER BY slot",
    [row.id],
  );
  return {
    id: row.id,
    profileId: row.profile_id,
    activityKey: row.activity_key,
    activityLabel: row.activity_label,
    interactionMode: row.interaction_mode,
    format: row.format,
    city: row.city,
    area: row.area,
    skill: row.skill,
    languages: row.languages,
    tags: tags.rows.map((t) => t.value),
    ageBand: profile.age_band,
    desiredAgeBands: row.desired_age_bands,
    groupSize: row.group_size,
    expiresAt: row.expires_at.toISOString(),
    status: row.status,
    availability: windows.rows.map((w) => ({
      startAt: w.start_at.toISOString(),
      endAt: w.end_at.toISOString(),
    })),
  };
}
export function requireActivePost(row: PostRow) {
  if (row.status !== "active" || row.expires_at.getTime() <= Date.now())
    fail("CONFLICT");
}
export async function projectOwnPost(
  tx: DatabaseExecutor,
  row: PostRow,
  profile: ProfileRow,
) {
  const c = await candidate(tx, row, profile);
  return ownPostSchema.parse({
    publicKey: row.public_key,
    rawText: row.raw_text,
    activityKey: c.activityKey,
    activityLabel: c.activityLabel,
    interactionMode: c.interactionMode,
    format: c.format,
    city: c.city,
    area: c.area,
    availability: c.availability,
    skill: c.skill,
    languages: c.languages,
    tags: c.tags,
    desiredAgeBands: c.desiredAgeBands,
    groupSize: c.groupSize,
    privacyMode: strongerMode(profile.privacy_mode, row.privacy_mode),
    status:
      row.status === "closed"
        ? "closed"
        : row.expires_at.getTime() <= Date.now()
          ? "expired"
          : "active",
    expiresAt: c.expiresAt,
  });
}
