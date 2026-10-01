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
  return (await candidateBatch(tx, [row], new Map([[profile.id, profile]]))).get(row.id)!;
}

/** One source plus at most 100 candidates; constant two-query child hydration. */
export async function candidateBatch(
  tx: DatabaseExecutor,
  rows: readonly PostRow[],
  profiles: ReadonlyMap<string, ProfileRow>,
): Promise<Map<string, SeekingCandidate>> {
  if (rows.length > 101 || new Set(rows.map((row) => row.id)).size !== rows.length)
    fail("INVALID_INPUT");
  for (const row of rows) if (!profiles.has(row.profile_id)) fail("NOT_FOUND");
  if (!rows.length) return new Map();
  const ids = rows.map((row) => row.id);
  const windows = await tx.query<{ post_id: string; start_at: Date; end_at: Date }>(
    "SELECT post_id,start_at,end_at FROM seeking_availability WHERE post_id=ANY($1::uuid[]) ORDER BY post_id,start_at,slot",
    [ids],
  );
  const tags = await tx.query<{ post_id: string; value: string }>(
    "SELECT post_id,value FROM seeking_tags WHERE post_id=ANY($1::uuid[]) ORDER BY post_id,slot",
    [ids],
  );
  const windowsByPost = new Map<string, { startAt: string; endAt: string }[]>();
  const tagsByPost = new Map<string, string[]>();
  for (const window of windows.rows) {
    const values = windowsByPost.get(window.post_id) ?? [];
    values.push({ startAt: window.start_at.toISOString(), endAt: window.end_at.toISOString() });
    windowsByPost.set(window.post_id, values);
  }
  for (const tag of tags.rows) {
    const values = tagsByPost.get(tag.post_id) ?? [];
    values.push(tag.value);
    tagsByPost.set(tag.post_id, values);
  }
  return new Map(rows.map((row) => [row.id, {
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
    tags: tagsByPost.get(row.id) ?? [],
    ageBand: profiles.get(row.profile_id)!.age_band,
    desiredAgeBands: row.desired_age_bands,
    groupSize: row.group_size,
    expiresAt: row.expires_at.toISOString(),
    status: row.status,
    availability: windowsByPost.get(row.id) ?? [],
  }]));
}

/** Call only after sorted profile locks and current-session reauthorization.
 * Reloads all candidate state, including exclusions, after a possible lock wait.
 */
export async function loadCandidateBatch(
  tx: DatabaseExecutor,
  viewerProfileId: string,
  postIds: readonly string[],
  source?: { row: PostRow; profile: ProfileRow },
) {
  if (postIds.length > 100) fail("INVALID_INPUT");
  type JoinedRow = PostRow & {
    alias: string; avatar_seed: string; age_band: string | null;
    profile_privacy_mode: ProfileRow["privacy_mode"];
    profile_languages: string[]; profile_created_at: Date;
  };
  const result = await tx.query<JoinedRow>(
    `SELECT s.*,p.alias,p.avatar_seed,p.age_band,p.privacy_mode AS profile_privacy_mode,p.languages AS profile_languages,p.created_at AS profile_created_at
 FROM seeking_posts s JOIN social_profiles p ON p.id=s.profile_id
 WHERE s.id=ANY($2::uuid[]) AND s.profile_id<>$1 AND s.status='active' AND s.expires_at>clock_timestamp() AND p.moderation_status='active'
 AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE b.blocker_profile_id=$1 AND b.blocked_profile_id=s.profile_id)
 AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE b.blocked_profile_id=$1 AND b.blocker_profile_id=s.profile_id)
 AND NOT EXISTS(SELECT 1 FROM discovery_passes d WHERE d.viewer_profile_id=$1 AND d.target_profile_id=s.profile_id)
 AND NOT EXISTS(SELECT 1 FROM connection_requests r WHERE r.status<>'expired' AND r.sender_profile_id=$1 AND r.recipient_profile_id=s.profile_id)
 AND NOT EXISTS(SELECT 1 FROM connection_requests r WHERE r.status<>'expired' AND r.recipient_profile_id=$1 AND r.sender_profile_id=s.profile_id)
 ORDER BY s.created_at DESC,s.id`,
    [viewerProfileId, postIds],
  );
  const rows = new Map<string, PostRow>();
  const profiles = new Map<string, ProfileRow>();
  for (const row of result.rows) {
    rows.set(row.id, row);
    profiles.set(row.profile_id, {
      id: row.profile_id, alias: row.alias, privacy_mode: row.profile_privacy_mode,
      avatar_seed: row.avatar_seed, age_band: row.age_band,
      languages: row.profile_languages, created_at: row.profile_created_at,
    });
  }
  if (source) { rows.set(source.row.id, source.row); profiles.set(source.profile.id, source.profile); }
  const candidates = await candidateBatch(tx, [...rows.values()], profiles);
  return { rows, profiles, candidates };
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
