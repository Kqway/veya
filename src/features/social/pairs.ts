import "server-only";
import { randomBytes } from "node:crypto";
import type { DatabaseExecutor } from "@/lib/db/types";
import type { ProfileRow } from "./context";
import { fail } from "./errors";
import { projectIdentity, type PairIdentity } from "./privacy";
import { strongerMode } from "./seeking-schema";
export type PairRow = {
  id: string;
  low_profile_id: string;
  high_profile_id: string;
  low_privacy: ProfileRow["privacy_mode"];
  high_privacy: ProfileRow["privacy_mode"];
};
export const opaqueKey = () => randomBytes(18).toString("base64url");
export async function readProfile(
  tx: DatabaseExecutor,
  id: string,
): Promise<ProfileRow> {
  const r = await tx.query<ProfileRow>(
    "SELECT id,alias,privacy_mode,avatar_seed,age_band,languages,created_at FROM social_profiles WHERE id=$1",
    [id],
  );
  return r.rows[0] ?? fail("NOT_FOUND");
}
export function peerId(pair: PairRow, own: string) {
  if (pair.low_profile_id === own) return pair.high_profile_id;
  if (pair.high_profile_id === own) return pair.low_profile_id;
  return fail("NOT_FOUND");
}
export async function isBlocked(tx: DatabaseExecutor, a: string, b: string) {
  return (
    (
      await tx.query(
        "SELECT 1 FROM social_blocks WHERE (blocker_profile_id=$1 AND blocked_profile_id=$2) OR (blocker_profile_id=$2 AND blocked_profile_id=$1)",
        [a, b],
      )
    ).rows.length > 0
  );
}
export async function readPair(
  tx: DatabaseExecutor,
  id: string,
): Promise<PairRow> {
  const r = await tx.query<PairRow>("SELECT * FROM social_pairs WHERE id=$1", [
    id,
  ]);
  return r.rows[0] ?? fail("NOT_FOUND");
}
export async function ensurePair(
  tx: DatabaseExecutor,
  a: ProfileRow,
  b: ProfileRow,
  aPrivacy: ProfileRow["privacy_mode"],
  bPrivacy: ProfileRow["privacy_mode"],
) {
  const [low, high] = [a.id, b.id].sort();
  if (!low || !high || low === high) fail("INVALID_INPUT");
  const lowMode = strongerMode(
    (low === a.id ? a : b).privacy_mode,
    low === a.id ? aPrivacy : bPrivacy,
  );
  const highMode = strongerMode(
    (high === a.id ? a : b).privacy_mode,
    high === a.id ? aPrivacy : bPrivacy,
  );
  const r = await tx.query<PairRow>(
    `INSERT INTO social_pairs(low_profile_id,high_profile_id,low_privacy,high_privacy) VALUES($1,$2,$3,$4) ON CONFLICT(low_profile_id,high_profile_id) DO UPDATE SET low_privacy=CASE WHEN social_pairs.low_privacy='INCOGNITO' OR EXCLUDED.low_privacy='INCOGNITO' THEN 'INCOGNITO' WHEN social_pairs.low_privacy='PRIVATE' OR EXCLUDED.low_privacy='PRIVATE' THEN 'PRIVATE' ELSE 'OPEN' END,high_privacy=CASE WHEN social_pairs.high_privacy='INCOGNITO' OR EXCLUDED.high_privacy='INCOGNITO' THEN 'INCOGNITO' WHEN social_pairs.high_privacy='PRIVATE' OR EXCLUDED.high_privacy='PRIVATE' THEN 'PRIVATE' ELSE 'OPEN' END RETURNING *`,
    [low, high, lowMode, highMode],
  );
  const pair = r.rows[0]!;
  for (const side of ["low", "high"])
    await tx.query(
      "INSERT INTO pairwise_identities(pair_id,side,alias,avatar_seed) VALUES($1,$2,$3,$4) ON CONFLICT(pair_id,side) DO NOTHING",
      [
        pair.id,
        side,
        `Quiet ${randomBytes(6).toString("hex")}`,
        randomBytes(16).toString("hex"),
      ],
    );
  return pair;
}
export async function pairIdentity(
  tx: DatabaseExecutor,
  pair: PairRow,
  profile: ProfileRow,
): Promise<PairIdentity> {
  const side =
    pair.low_profile_id === profile.id
      ? "low"
      : pair.high_profile_id === profile.id
        ? "high"
        : fail("NOT_FOUND");
  const row = await tx.query<{ alias: string; avatar_seed: string }>(
    "SELECT alias,avatar_seed FROM pairwise_identities WHERE pair_id=$1 AND side=$2",
    [pair.id, side],
  );
  if (!row.rows[0]) fail("NOT_FOUND");
  return projectIdentity(
    profile,
    { alias: row.rows[0]!.alias, avatarSeed: row.rows[0]!.avatar_seed },
    side === "low" ? pair.low_privacy : pair.high_privacy,
  );
}
