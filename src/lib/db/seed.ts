import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "./types";

export async function seedDemo(db: Database): Promise<{ publicSlug: string; created: boolean }> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(782014222)");
    const existing = await tx.query<{ public_slug: string }>("SELECT public_slug FROM intents WHERE seed_key='phase-2-demo'");
    if (existing.rows[0]) return { publicSlug: existing.rows[0].public_slug, created: false };
    const guestIds: string[] = [];
    for (let index = 0; index < 4; index++) {
      const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
      const session = await tx.query<{ id: string }>("INSERT INTO guest_participant_sessions(token_hash,expires_at) VALUES ($1,now()+interval '30 days') RETURNING id", [hash]);
      guestIds.push(session.rows[0]!.id);
    }
    const slug = randomBytes(18).toString("base64url");
    const result = await tx.query<{ id: string }>(
      "INSERT INTO intents(public_slug,creator_guest_id,creator_display_name,raw_text,title,structured_intent,status,expires_at,seed_key) VALUES ($1,$2,'Artem',$3,$4,$5,'ready',now()+interval '30 days','phase-2-demo') RETURNING id",
      [slug, guestIds[0], "Let's meet for food and games this week.", "Food, friends & a game night", JSON.stringify({ type: "meet", activities: ["food", "games"], location: null })],
    );
    const intentId = result.rows[0]!.id;
    const day = new Date(Date.now() + 2 * 86_400_000);
    const at = (hour: number) => { const date = new Date(day); date.setUTCHours(hour, 0, 0, 0); return date; };
    const people = [{ name: "Artem", start: 18, end: 22 }, { name: "Maya", start: 19, end: 21 }, { name: "Alex", start: 18, end: 21 }, { name: "Sam", start: 20, end: 22 }];
    const participantIds: string[] = [];
    for (const [index, person] of people.entries()) {
      const participant = await tx.query<{ id: string }>(
        "INSERT INTO participants(intent_id,guest_id,display_name,budget_min,budget_max,currency) VALUES ($1,$2,$3,1000,3000,'USD') RETURNING id", [intentId, guestIds[index], person.name],
      );
      const id = participant.rows[0]!.id;
      participantIds.push(id);
      await tx.query("INSERT INTO availability_windows(participant_id,start_at,end_at) VALUES ($1,$2,$3)", [id, at(person.start), at(person.end)]);
      await tx.query("INSERT INTO preferences(participant_id,category,value) VALUES ($1,'activity','food'),($1,'activity','games')", [id]);
    }
    const suggestions = await tx.query<{ id: string }>(
      "INSERT INTO plan_suggestions(intent_id,title,start_at,end_at,score,available_count,explanation,details) VALUES ($1,'Dinner and games',$2,$3,950,4,'A shared hour for all four friends.',$4),($1,'An earlier dinner',$5,$2,650,2,'An earlier option for two friends.',$4) RETURNING id",
      [intentId, at(20), at(21), JSON.stringify({ source: "demo", engineVersion: "seed" }), at(18)],
    );
    await tx.query("INSERT INTO votes(intent_id,participant_id,suggestion_id,value) VALUES ($1,$2,$3,1),($1,$4,$3,0)", [intentId, participantIds[0], suggestions.rows[0]!.id, participantIds[1]]);
    await tx.query("INSERT INTO analytics_events(event_name,surface) VALUES ('intent_created','create')");
    return { publicSlug: slug, created: true };
  });
}
