import "server-only";
import type { Database, DatabaseExecutor } from "@/lib/db/types";
import { validate } from "@/features/backend/validation";
import { rankCompatible } from "@/features/discovery/engine";
import { lockProfiles, reauthorize, requireProfile } from "./context";
import {
  candidate,
  readPost,
  requireActivePost,
  type PostRow,
} from "./post-repository";
import { publicKeySchema } from "./seeking-schema";
import { cardSchema, type DiscoveryCard } from "./network-projections";
import {
  readProfile,
  ensurePair,
  opaqueKey,
  pairIdentity,
  isBlocked,
} from "./pairs";
import { fail } from "./errors";
export type HandleRow = {
  public_handle: string;
  viewer_profile_id: string;
  source_post_id: string;
  target_post_id: string;
  pair_id: string;
};
export async function readHandle(
  tx: DatabaseExecutor,
  handle: string,
  viewer: string,
) {
  const r = await tx.query<HandleRow>(
    "SELECT * FROM discovery_handles WHERE public_handle=$1 AND viewer_profile_id=$2",
    [handle, viewer],
  );
  return r.rows[0] ?? fail("NOT_FOUND");
}
export async function postById(
  tx: DatabaseExecutor,
  id: string,
): Promise<PostRow> {
  const r = await tx.query<PostRow>("SELECT * FROM seeking_posts WHERE id=$1", [
    id,
  ]);
  return r.rows[0] ?? fail("NOT_FOUND");
}
export class DiscoveryService {
  constructor(private readonly db: Database) {}
  async discover(token: string, sourceKey: string): Promise<DiscoveryCard[]> {
    validate(publicKeySchema, sourceKey);
    return this.db.transaction(async (tx) => {
      let actor = await requireProfile(tx, token);
      let source = await readPost(tx, sourceKey, actor.id);
      requireActivePost(source);
      const pool = await tx.query<{ id: string; profile_id: string }>(
        `SELECT s.id,s.profile_id FROM seeking_posts s WHERE s.profile_id<>$1 AND s.activity_key=$2 AND s.status='active' AND s.expires_at>clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_profile_id=$1 AND b.blocked_profile_id=s.profile_id) OR (b.blocked_profile_id=$1 AND b.blocker_profile_id=s.profile_id))
 AND NOT EXISTS(SELECT 1 FROM discovery_passes p WHERE p.viewer_profile_id=$1 AND p.target_profile_id=s.profile_id)
 AND NOT EXISTS(SELECT 1 FROM connection_requests r WHERE r.status<>'expired' AND ((r.sender_profile_id=$1 AND r.recipient_profile_id=s.profile_id) OR (r.recipient_profile_id=$1 AND r.sender_profile_id=s.profile_id))) ORDER BY s.created_at DESC,s.id LIMIT 100`,
        [actor.id, source.activity_key],
      );
      await lockProfiles(tx, [actor.id, ...pool.rows.map((p) => p.profile_id)]);
      actor = await reauthorize(tx, token, actor.id);
      source = await readPost(tx, sourceKey, actor.id);
      requireActivePost(source);
      const candidates = [];
      const rows = new Map<string, PostRow>();
      const profiles = new Map<
        string,
        Awaited<ReturnType<typeof readProfile>>
      >();
      for (const selected of pool.rows) {
        const row = await postById(tx, selected.id);
        if (
          row.status !== "active" ||
          row.expires_at.getTime() <= Date.now() ||
          (await isBlocked(tx, actor.id, row.profile_id))
        )
          continue;
        const hidden = await tx.query(
          `SELECT 1 FROM discovery_passes WHERE viewer_profile_id=$1 AND target_profile_id=$2 UNION ALL SELECT 1 FROM connection_requests WHERE status<>'expired' AND ((sender_profile_id=$1 AND recipient_profile_id=$2) OR (recipient_profile_id=$1 AND sender_profile_id=$2)) LIMIT 1`,
          [actor.id, row.profile_id],
        );
        if (hidden.rows.length) continue;
        const profile = await readProfile(tx, row.profile_id);
        rows.set(row.id, row);
        profiles.set(row.profile_id, profile);
        candidates.push(await candidate(tx, row, profile));
      }
      const ranked = rankCompatible(
        await candidate(tx, source, actor),
        candidates,
        { now: new Date().toISOString(), limit: 5 },
      );
      const issued = await tx.query<{ count: string }>(
        "SELECT count(*) FROM discovery_handles WHERE viewer_profile_id=$1 AND created_at>clock_timestamp()-interval '24 hours'",
        [actor.id],
      );
      let remaining = Math.max(0, 20 - Number(issued.rows[0]!.count));
      const cards: DiscoveryCard[] = [];
      const seen = new Set<string>();
      for (const r of ranked) {
        if (seen.has(r.candidate.profileId)) continue;
        seen.add(r.candidate.profileId);
        const row = rows.get(r.candidate.id)!;
        const profile = profiles.get(row.profile_id)!;
        const existing = await tx.query<{ public_handle: string }>(
          "SELECT public_handle FROM discovery_handles WHERE viewer_profile_id=$1 AND source_post_id=$2 AND target_post_id=$3",
          [actor.id, source.id, row.id],
        );
        if (!existing.rows.length && remaining === 0) continue;
        if (!existing.rows.length) remaining--;
        const pair = await ensurePair(
          tx,
          actor,
          profile,
          source.privacy_mode,
          row.privacy_mode,
        );
        const h = await tx.query<{ public_handle: string }>(
          `INSERT INTO discovery_handles(public_handle,viewer_profile_id,source_post_id,target_post_id,pair_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(viewer_profile_id,source_post_id,target_post_id) DO UPDATE SET pair_id=EXCLUDED.pair_id RETURNING public_handle`,
          [opaqueKey(), actor.id, source.id, row.id, pair.id],
        );
        cards.push(
          cardSchema.parse({
            handle: h.rows[0]!.public_handle,
            identity: await pairIdentity(tx, pair, profile),
            activityLabel: row.activity_label,
            interactionMode: row.interaction_mode,
            format: row.format,
            reasons: r.reasons,
            timeHint: r.timeHint,
          }),
        );
      }
      await reauthorize(tx, token, actor.id);
      requireActivePost(source);
      return cards;
    });
  }
  async pass(token: string, handle: string) {
    validate(publicKeySchema, handle);
    return this.db.transaction(async (tx) => {
      const a = await requireProfile(tx, token);
      const h = await readHandle(tx, handle, a.id);
      const target = await postById(tx, h.target_post_id);
      await lockProfiles(tx, [a.id, target.profile_id]);
      await reauthorize(tx, token, a.id);
      await tx.query(
        "INSERT INTO discovery_passes(viewer_profile_id,target_profile_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [a.id, target.profile_id],
      );
      return { passed: true };
    });
  }
}
