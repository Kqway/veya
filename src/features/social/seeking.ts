import "server-only";
import { randomBytes } from "node:crypto";
import type { Database } from "@/lib/db/types";
import {
  validate,
  validateWindows,
  participantSchema,
} from "@/features/backend/validation";
import { lockProfiles, requireProfile, reauthorize, requireCapability } from "./context";
import { fail } from "./errors";
import { seekingSchema, publicKeySchema, strongerMode } from "./seeking-schema";
import { readPost, projectOwnPost, type PostRow } from "./post-repository";
export class SeekingService {
  constructor(private readonly db: Database) {}
  async create(token: string, input: unknown) {
    const data = validate(seekingSchema, input);
    const expiry = data.expiresAt
      ? new Date(data.expiresAt)
      : new Date(Date.now() + 7 * 86400000);
    if (
      expiry.getTime() <= Date.now() ||
      expiry.getTime() > Date.now() + 30 * 86400000
    )
      fail("INVALID_INPUT");
    validateWindows(
      participantSchema.parse({
        displayName: "Seeking",
        availability: data.availability,
      }),
      expiry,
    );
    return this.db.transaction(async (tx) => {
      let profile = await requireProfile(tx, token);
      await lockProfiles(tx, [profile.id]);
      profile = await reauthorize(tx, token, profile.id);
      await requireCapability(tx,profile.id,'seek');
      if (
        data.privacyMode &&
        strongerMode(profile.privacy_mode, data.privacyMode) !==
          data.privacyMode
      )
        fail("INVALID_INPUT");
      await tx.query(
        "UPDATE seeking_posts SET status='closed' WHERE profile_id=$1 AND status='active' AND expires_at<=clock_timestamp()",
        [profile.id],
      );
      const taken = await tx.query<{ active_slot: number }>(
        "SELECT active_slot FROM seeking_posts WHERE profile_id=$1 AND status='active'",
        [profile.id],
      );
      const slot = [1, 2, 3].find(
        (n) => !taken.rows.some((r) => r.active_slot === n),
      );
      if (!slot) fail("CONFLICT");
      validateWindows(
        participantSchema.parse({
          displayName: "Seeking",
          availability: data.availability,
        }),
        expiry,
      );
      const result = await tx.query<PostRow>(
        `INSERT INTO seeking_posts(public_key,profile_id,active_slot,raw_text,activity_key,activity_label,interaction_mode,format,city,area,skill,languages,desired_age_bands,group_size,privacy_mode,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [
          randomBytes(18).toString("base64url"),
          profile.id,
          slot,
          data.rawText,
          data.activityKey,
          data.activityLabel,
          data.interactionMode,
          data.format,
          data.city,
          data.area,
          data.skill,
          data.languages,
          data.desiredAgeBands,
          data.groupSize,
          data.privacyMode ?? profile.privacy_mode,
          expiry,
        ],
      );
      const row = result.rows[0]!;
      for (const [i, w] of data.availability.entries())
        await tx.query(
          "INSERT INTO seeking_availability(post_id,slot,start_at,end_at) VALUES($1,$2,$3,$4)",
          [row.id, i + 1, w.startAt, w.endAt],
        );
      for (const [i, t] of data.tags.entries())
        await tx.query(
          "INSERT INTO seeking_tags(post_id,slot,value) VALUES($1,$2,$3)",
          [row.id, i + 1, t],
        );
      return projectOwnPost(tx, row, profile);
    });
  }
  async list(token: string) {
    return this.db.transaction(async (tx) => {
      let p = await requireProfile(tx, token);
      await lockProfiles(tx, [p.id]);
      p = await reauthorize(tx, token, p.id);
      const rows = await tx.query<PostRow>(
        "SELECT * FROM seeking_posts WHERE profile_id=$1 ORDER BY created_at DESC LIMIT 20",
        [p.id],
      );
      return Promise.all(rows.rows.map((r) => projectOwnPost(tx, r, p)));
    });
  }
  async get(token: string, key: string) {
    validate(publicKeySchema, key);
    return this.db.transaction(async (tx) => {
      let p = await requireProfile(tx, token);
      await lockProfiles(tx, [p.id]);
      p = await reauthorize(tx, token, p.id);
      return projectOwnPost(tx, await readPost(tx, key, p.id), p);
    });
  }
  async close(token: string, key: string) {
    validate(publicKeySchema, key);
    return this.db.transaction(async (tx) => {
      const p = await requireProfile(tx, token);
      await lockProfiles(tx, [p.id]);
      await reauthorize(tx, token, p.id);
      const row = await readPost(tx, key, p.id);
      await tx.query("UPDATE seeking_posts SET status='closed' WHERE id=$1", [
        row.id,
      ]);
      return { closed: true };
    });
  }
}
