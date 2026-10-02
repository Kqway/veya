import { enqueueNotification } from '@/features/notifications/service';
import { trackFunnel } from '@/lib/analytics/funnel';
import { publishSocialEvent } from '@/features/realtime/events';
import "server-only";
import { z } from "zod";
import type { Database, DatabaseExecutor } from "@/lib/db/types";
import { validate } from "@/features/backend/validation";
import { rankCompatible } from "@/features/discovery/engine";
import { lockProfiles, reauthorize, requireProfile, requireCapability } from "./context";
import { readHandle, postById } from "./discovery";
import { candidate, requireActivePost } from "./post-repository";
import { publicKeySchema } from "./seeking-schema";
import {
  readPair,
  readProfile,
  peerId,
  isBlocked,
  opaqueKey,
  pairIdentity,
} from "./pairs";
import {
  incomingRequestSchema,
  requestResultSchema,
  type RequestDTO,
} from "./network-projections";
import { retireOutgoing, retireRequests } from "./request-lifecycle";
import { fail } from "./errors";
export type RequestRow = {
  id: string;
  public_key: string;
  pair_id: string;
  sender_profile_id: string;
  recipient_profile_id: string;
  source_post_id: string | null;
  target_post_id: string | null;
  pending_slot: number;
  status: "pending" | "accepted" | "declined" | "expired";
  activity_label: string;
};
export async function requestByKey(
  tx: DatabaseExecutor,
  key: string,
  actor: string,
): Promise<RequestRow> {
  const r = await tx.query<RequestRow>(
    "SELECT * FROM connection_requests WHERE public_key=$1 AND (sender_profile_id=$2 OR recipient_profile_id=$2)",
    [key, actor],
  );
  return r.rows[0] ?? fail("NOT_FOUND");
}
async function result(tx: DatabaseExecutor, r: RequestRow) {
  const m = await tx.query<{ public_key: string }>(
    "SELECT public_key FROM social_matches WHERE request_id=$1",
    [r.id],
  );
  return requestResultSchema.parse({
    publicKey: r.public_key,
    status: r.status,
    matchKey: m.rows[0]?.public_key ?? null,
  });
}
async function compatible(tx: DatabaseExecutor, r: RequestRow) {
  if (!r.source_post_id || !r.target_post_id) fail("CONFLICT");
  const source = await postById(tx, r.source_post_id!);
  const target = await postById(tx, r.target_post_id!);
  requireActivePost(source);
  requireActivePost(target);
  if (
    !rankCompatible(
      await candidate(tx, source, await readProfile(tx, source.profile_id)),
      [await candidate(tx, target, await readProfile(tx, target.profile_id))],
      { now: new Date().toISOString() },
    ).length
  )
    fail("CONFLICT");
  return { source, target };
}
export class ConnectionsService {
  constructor(private readonly db: Database, private readonly options: {analyticsEnabled?: boolean;readOnly?:boolean} = {}) {}
  async request(token: string, input: unknown) {
    const data = validate(
      z.object({ handle: publicKeySchema }).strict(),
      input,
    );
    return this.db.transaction(async (tx) => {
      const a = await requireProfile(tx, token);
      const h = await readHandle(tx, data.handle, a.id);
      const initial = await postById(tx, h.target_post_id);
      if (a.id === initial.profile_id) fail("INVALID_INPUT");
      await lockProfiles(tx, [a.id, initial.profile_id]);
      await reauthorize(tx, token, a.id);
      const source = await postById(tx, h.source_post_id);
      const target = await postById(tx, h.target_post_id);
      await requireCapability(tx,a.id,'connect');
      await requireCapability(tx,target.profile_id,'connect');
      if (
        source.profile_id !== a.id ||
        (await isBlocked(tx, a.id, target.profile_id))
      )
        fail("NOT_FOUND");
      if (
        (
          await tx.query(
            "SELECT 1 FROM discovery_passes WHERE viewer_profile_id=$1 AND target_profile_id=$2",
            [a.id, target.profile_id],
          )
        ).rows.length
      )
        fail("NOT_FOUND");
      requireActivePost(source);
      requireActivePost(target);
      await retireOutgoing(tx, a.id);
      const existing = await tx.query<RequestRow>(
        "SELECT * FROM connection_requests WHERE pair_id=$1 AND status<>'expired'",
        [h.pair_id],
      );
      if (existing.rows[0]) return result(tx, existing.rows[0]);
      const proposal: RequestRow = {
        id: "",
        public_key: "",
        pair_id: h.pair_id,
        sender_profile_id: a.id,
        recipient_profile_id: target.profile_id,
        source_post_id: source.id,
        target_post_id: target.id,
        pending_slot: 1,
        status: "pending",
        activity_label: source.activity_label,
      };
      await compatible(tx, proposal);
      const slots = await tx.query<{ pending_slot: number }>(
        "SELECT pending_slot FROM connection_requests WHERE sender_profile_id=$1 AND status='pending'",
        [a.id],
      );
      const slot = Array.from({ length: 10 }, (_, i) => i + 1).find(
        (s) => !slots.rows.some((r) => r.pending_slot === s),
      );
      if (!slot) fail("CONFLICT");
      await reauthorize(tx, token, a.id);
      requireActivePost(source);
      requireActivePost(target);
      const inserted = await tx.query<RequestRow>(
        `INSERT INTO connection_requests(public_key,pair_id,sender_profile_id,recipient_profile_id,source_post_id,target_post_id,pending_slot,activity_label) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          opaqueKey(),
          h.pair_id,
          a.id,
          target.profile_id,
          source.id,
          target.id,
          slot,
          source.activity_label,
        ],
      );
      await enqueueNotification(tx,{recipientProfileId:target.profile_id,peerProfileId:a.id,type:'INTEREST_RECEIVED',requestKey:inserted.rows[0]!.public_key,dedupeKey:'interest:'+inserted.rows[0]!.id});
      await trackFunnel(tx,'interest_sent',this.options.analyticsEnabled ?? false);
      await trackFunnel(tx,'interest_received',this.options.analyticsEnabled ?? false);
      await publishSocialEvent(tx, [a.id, target.profile_id], {topic:'connections'});
      return result(tx, inserted.rows[0]!);
    });
  }
  async list(token: string): Promise<RequestDTO[]> {
    return this.db.transaction(async (tx) => {
      let a = await requireProfile(tx, token);
      const selected = await tx.query<RequestRow>(
        "SELECT * FROM connection_requests WHERE sender_profile_id=$1 OR recipient_profile_id=$1 ORDER BY created_at DESC LIMIT 30",
        [a.id],
      );
      await lockProfiles(tx, [
        a.id,
        ...selected.rows.flatMap((r) => [
          r.sender_profile_id,
          r.recipient_profile_id,
        ]),
      ]);
      a = await reauthorize(tx, token, a.id);
      if (!this.options.readOnly) {
        await retireOutgoing(tx, a.id);
        await retireRequests(tx, selected.rows.filter((r) => r.status === "pending"));
      }
      const out: RequestDTO[] = [];
      for (const initial of selected.rows) {
        const r = await requestByKey(tx, initial.public_key, a.id);
        const pair = await readPair(tx, r.pair_id);
        const peer = peerId(pair, a.id);
        if (await isBlocked(tx, a.id, peer)) continue;
        out.push(
          incomingRequestSchema.parse({
            ...(await result(tx, r)),
            direction:
              r.recipient_profile_id === a.id ? "incoming" : "outgoing",
            identity: await pairIdentity(tx, pair, await readProfile(tx, peer)),
            activityLabel: r.activity_label,
          }),
        );
      }
      return out;
    });
  }
  async respond(token: string, key: string, input: unknown) {
    validate(publicKeySchema, key);
    const data = validate(
      z.object({ action: z.enum(["accept", "decline"]) }).strict(),
      input,
    );
    return this.db.transaction(async (tx) => {
      const a = await requireProfile(tx, token);
      let r = await requestByKey(tx, key, a.id);
      if (r.recipient_profile_id !== a.id) fail("NOT_FOUND");
      await lockProfiles(tx, [r.sender_profile_id, r.recipient_profile_id]);
      await reauthorize(tx, token, a.id);
      r = await requestByKey(tx, key, a.id);
      if (await isBlocked(tx, r.sender_profile_id, r.recipient_profile_id))
        fail("NOT_FOUND");
      if (r.status !== "pending") {
        if (
          (r.status === "accepted" && data.action === "accept") ||
          (r.status === "declined" && data.action === "decline")
        )
          return result(tx, r);
        fail("CONFLICT");
      }
      if (data.action === "decline") {
        await tx.query(
          "UPDATE connection_requests SET status='declined',updated_at=clock_timestamp() WHERE id=$1",
          [r.id],
        );
        r.status = "declined";
        await publishSocialEvent(tx, [r.sender_profile_id,r.recipient_profile_id], {topic:'connections'});
        return result(tx, r);
      }
      await requireCapability(tx,r.sender_profile_id,'connect');
      await requireCapability(tx,r.recipient_profile_id,'connect');
      const { source, target } = await compatible(tx, r);
      await reauthorize(tx, token, a.id);
      requireActivePost(source);
      requireActivePost(target);
      await tx.query(
        "UPDATE connection_requests SET status='accepted',updated_at=clock_timestamp() WHERE id=$1",
        [r.id],
      );
      r.status = "accepted";
      const match = await tx.query<{ id: string }>(
        `INSERT INTO social_matches(public_key,pair_id,request_id,activity_label) VALUES($1,$2,$3,$4) RETURNING id`,
        [opaqueKey(), r.pair_id, r.id, r.activity_label],
      );
      await tx.query("INSERT INTO conversations(match_id) VALUES($1)", [
        match.rows[0]!.id,
      ]);
      await trackFunnel(tx,'match_created',this.options.analyticsEnabled ?? false);
      const outcome = await result(tx,r);
      await enqueueNotification(tx,{recipientProfileId:r.sender_profile_id,peerProfileId:r.recipient_profile_id,type:'INTEREST_ACCEPTED',matchKey:outcome.matchKey!,dedupeKey:'accepted:'+r.id});
      await publishSocialEvent(tx,[r.sender_profile_id,r.recipient_profile_id],{topic:'connections'});
      await publishSocialEvent(tx,[r.sender_profile_id,r.recipient_profile_id],{topic:'match',matchKey:outcome.matchKey!});
      return outcome;
    });
  }
}
