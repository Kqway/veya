import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "@/lib/db/migrations";
import type { BetaControls } from "@/lib/config/beta-policy";
import { VeyaBackend } from "@/features/backend/service";
import { createBackendHandlers } from "@/features/backend/http";
import { createSocialHandler } from "@/features/social/http";
import { NotificationService } from "@/features/notifications/service";
import { createNotificationHandler } from "@/features/notifications/http";
import { createModerationHandler } from "@/features/moderation/http";
import { createGuestSession } from "@/features/backend/sessions";
import { IdentityService } from "@/features/social/identity";
import { DiscoveryService } from "@/features/social/discovery";
import { ConnectionsService } from "@/features/social/connections";
import { socialActor, seekingInput } from "../support/social";
import { startTestDatabase } from "../support/postgres";

const origin = "https://veya.test";
function request(method: string, token = "", body?: unknown, moderatorCookie?: string) {
  return new Request(`${origin}/api/test`, {
    method, headers: { origin, "content-type": "application/json", cookie: moderatorCookie ?? `veya_guest=${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("closed beta controls with native PostgreSQL", () => {
  let cluster: Awaited<ReturnType<typeof startTestDatabase>>;
  let controls: BetaControls, backend: VeyaBackend;
  let social: ReturnType<typeof createSocialHandler>, core: ReturnType<typeof createBackendHandlers>;
  beforeAll(async () => { cluster = await startTestDatabase(); await applyMigrations(cluster.db); });
  afterAll(async () => cluster?.stop());
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(async () => {
    await cluster.db.query("TRUNCATE guest_participant_sessions,intents,social_profiles,moderation_admin_sessions,moderation_audit CASCADE");
    controls = { signupsEnabled: true, seekingEnabled: true, readOnly: false };
    backend = new VeyaBackend(cluster.db);
    core = createBackendHandlers({ origin, secureCookie: false, backend: () => backend, getBetaControls: () => controls });
    social = createSocialHandler({ origin, db: () => cluster.db, tasks: () => { throw new Error("No provider expected"); }, getBetaControls: () => controls });
  });

  it("keeps guest reads/results available and preserves data while denying coordination writes", async () => {
    const owner = await backend.createSession(), guest = await backend.createSession();
    const view = await backend.createIntent(owner.token, { rawText: "Chess together" }), slug = view.intent.publicSlug;
    const start = Date.now() + 86400000;
    await backend.joinIntent(guest.token, slug, { displayName: "Peer", availability: [{ startAt: new Date(start).toISOString(), endAt: new Date(start + 3 * 3600000).toISOString() }] });
    // Prepare persisted results before maintenance; read-only must preserve them.
    await backend.getResults(slug,guest.token);
    controls.readOnly = true;
    const results = await core.getResults(request("GET", guest.token), slug);
    expect(results.status).toBe(200);
    const projection = await results.json();
    expect(projection.suggestions.length).toBeGreaterThan(0);
    expect((await core.getIntent(request("GET", guest.token), slug)).status).toBe(200);
    const denied = await core.vote(request("POST", guest.token, { suggestionKey: projection.suggestions[0].suggestionKey, revision: projection.revision, value: "yes" }), slug);
    expect(await denied.json()).toMatchObject({ error: { code: "BETA_READ_ONLY" } });
    expect((await cluster.db.query("SELECT count(*)::int AS count FROM votes")).rows[0]!.count).toBe(0);
    expect((await core.revokeSession(request("DELETE", guest.token))).status).toBe(200);
    expect(await backend.getSession(guest.token)).toBeNull();
    expect((await backend.getIntent(slug, owner.token)).ownParticipant).toBeNull();
  });

  it("serves uncached results without persisting proposals or changing revision in read-only mode",async()=>{
    const owner=await backend.createSession(),guest=await backend.createSession();
    const view=await backend.createIntent(owner.token,{rawText:'Read only chess'}),slug=view.intent.publicSlug;
    const start=Date.now()+86400000;
    await backend.joinIntent(guest.token,slug,{displayName:'Peer',availability:[{startAt:new Date(start).toISOString(),endAt:new Date(start+3600000).toISOString()}]});
    const before=(await cluster.db.query('SELECT status,scheduling_revision,suggestions_fingerprint FROM intents WHERE public_slug=$1',[slug])).rows[0];
    controls.readOnly=true;
    const response=await core.getResults(request('GET',guest.token),slug);
    expect(response.status).toBe(200);
    expect((await response.json()).suggestions).toEqual([]);
    expect((await cluster.db.query('SELECT 1 FROM plan_suggestions')).rows).toEqual([]);
    expect((await cluster.db.query('SELECT status,scheduling_revision,suggestions_fingerprint FROM intents WHERE public_slug=$1',[slug])).rows[0]).toEqual(before);
  });
  it("denies stateful discovery GET and reads pending connections without expiry mutations during maintenance",async()=>{
    const a=await socialActor(cluster.db,'Read only A'),b=await socialActor(cluster.db,'Read only B');
    const card=(await new DiscoveryService(cluster.db).discover(a.token,a.post.publicKey))[0]!;
    const connection=await new ConnectionsService(cluster.db).request(a.token,{handle:card.handle});
    await cluster.db.query("UPDATE seeking_posts SET status='closed' WHERE public_key=$1",[a.post.publicKey]);
    controls.readOnly=true;
    const discovery=await social(new Request(`${origin}/api/social/discover?source=${b.post.publicKey}`,{headers:{cookie:`veya_guest=${b.token}`}}),['discover']);
    expect(discovery.status).toBe(503);
    expect(await discovery.json()).toMatchObject({error:{code:'BETA_READ_ONLY'}});
    expect((await social(request('GET',a.token),['connections'])).status).toBe(200);
    expect((await cluster.db.query('SELECT status FROM connection_requests WHERE public_key=$1',[connection.publicKey])).rows[0]!.status).toBe('pending');
  });

  it("pauses new profiles while preserving recovery of an existing profile", async () => {
    const original = await createGuestSession(cluster.db), replacement = await createGuestSession(cluster.db);
    const saved = await new IdentityService(cluster.db).create(original.token, { alias: "Existing", privacyMode: "PRIVATE", adultConfirmed: true });
    controls.signupsEnabled = false;
    const denied = await social(request("POST", replacement.token, { alias: "New", privacyMode: "OPEN", adultConfirmed: true }), ["profile"]);
    expect(denied.status).toBe(503);
    expect(await denied.json()).toMatchObject({ error: { code: "BETA_SIGNUPS_PAUSED" } });
    const recovered = await social(request("POST", replacement.token, { key: saved.recoveryKey }), ["profile", "recover"]);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toHaveProperty("profile.alias", "Existing");
    expect(await new IdentityService(cluster.db).get(original.token)).toBeNull();
    expect((await cluster.db.query("SELECT count(*)::int AS count FROM social_profiles")).rows[0]!.count).toBe(1);
  });

  it("pauses only new seeking creation while retaining existing post reads and closure", async () => {
    const actor = await socialActor(cluster.db, "Existing");
    controls.seekingEnabled = false;
    const denied = await social(request("POST", actor.token, seekingInput()), ["seeking"]);
    expect(denied.status).toBe(503);
    expect(await denied.json()).toMatchObject({ error: { code: "BETA_SEEKING_PAUSED" } });
    expect((await social(request("GET", actor.token), ["seeking", actor.post.publicKey])).status).toBe(200);
    expect((await social(request("DELETE", actor.token), ["seeking", actor.post.publicKey])).status).toBe(200);
    expect((await cluster.db.query("SELECT count(*)::int AS count FROM seeking_posts")).rows[0]!.count).toBe(1);
  });

  it("retains key revocation, notification reads, reporting, blocking and human moderation in maintenance", async () => {
    const a = await socialActor(cluster.db, "Reporter"), b = await socialActor(cluster.db, "Target");
    const card = (await new DiscoveryService(cluster.db).discover(a.token, a.post.publicKey))[0]!;
    const connection = await new ConnectionsService(cluster.db).request(a.token, { handle: card.handle });
    controls.readOnly = true;
    vi.stubEnv("BETA_READ_ONLY", "true");
    const notification = createNotificationHandler({ origin, db: () => cluster.db, getBetaControls: () => controls });
    expect((await notification(request("GET", a.token), [])).status).toBe(200);
    expect((await notification(request("GET", a.token), ["unread"])).status).toBe(200);
    expect((await social(request("DELETE", a.token), ["profile", "key"])).status).toBe(200);
    expect((await social(request("POST", a.token, { requestKey: connection.publicKey, reason: "spam", text: "Safety report" }), ["reports"])).status).toBe(200);
    expect((await social(request("POST", a.token, { requestKey: connection.publicKey }), ["block"])).status).toBe(200);
    expect((await cluster.db.query("SELECT count(*)::int AS count FROM social_blocks")).rows[0]!.count).toBe(1);
    expect((await cluster.db.query("SELECT status FROM connection_requests")).rows[0]!.status).toBe("declined");
    const secret = randomBytes(32).toString("base64url");
    const moderation = createModerationHandler({ origin, db: () => cluster.db, secureCookie: false, adminSecret: () => secret });
    const login = await moderation(request("POST", "", { secret }), ["session"]);
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const queue = await moderation(request("GET", "", undefined, cookie), ["reports"]);
    expect(queue.status).toBe(200);
    const reports = await queue.json();
    const action = await moderation(request("PATCH", "", { moderationStatus: "suspended" }, cookie), ["reports", reports.reports[0].publicKey]);
    expect(action.status).toBe(200);
    expect((await social(request("GET", b.token), ["profile"])).status).toBe(403);
  });

  it("allows owned profile deletion during maintenance with strict confirmation", async () => {
    const actor = await socialActor(cluster.db, "Delete me");
    controls.readOnly = true;
    const rejected = await social(request("DELETE", actor.token, { confirmation: "wrong" }), ["profile"]);
    expect(rejected.status).toBe(400);
    expect(await new IdentityService(cluster.db).get(actor.token)).toHaveProperty("alias", "Delete me");
    const deleted = await social(request("DELETE", actor.token, { confirmation: "DELETE" }), ["profile"]);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
    expect(await new IdentityService(cluster.db).get(actor.token)).toBeNull();
    expect((await cluster.db.query("SELECT alias,recovery_key_hash,deleted_at IS NOT NULL AS deleted FROM social_profiles")).rows).toEqual([{ alias: "Deleted participant", recovery_key_hash: null, deleted: true }]);
    expect(await backend.getSession(actor.token)).not.toBeNull();
  });

  it("allows push opt-out during maintenance without permitting new subscriptions", async () => {
    const actor = await socialActor(cluster.db, "Push owner");
    const push = { publicKey: "a".repeat(87), privateKey: "b".repeat(43), subject: "mailto:beta@veya.test" };
    const subscription = { endpoint: "https://fcm.googleapis.com/veya/beta-test", keys: { p256dh: "c".repeat(87), auth: "d".repeat(22) } };
    await new NotificationService(cluster.db, { origin, push }).subscribe(actor.token, subscription);
    controls.readOnly = true;
    const notification = createNotificationHandler({ origin, db: () => cluster.db, push, getBetaControls: () => controls });
    expect((await notification(request("POST", actor.token, subscription), ["push"])).status).toBe(503);
    expect((await cluster.db.query("SELECT count(*)::int AS count FROM social_push_subscriptions")).rows[0]!.count).toBe(1);
    const removed = await notification(request("DELETE", actor.token, { endpoint: subscription.endpoint }), ["push"]);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ subscribed: false });
    expect((await cluster.db.query("SELECT count(*)::int AS count FROM social_push_subscriptions")).rows[0]!.count).toBe(0);
  });

  it("reads injected controls per request so toggling maintenance immediately stops writes", async () => {
    const guest = await backend.createSession();
    const create = () => core.createIntent(request("POST", guest.token, { rawText: "Coffee" }));
    expect((await create()).status).toBe(201);
    controls.readOnly = true;
    expect((await create()).status).toBe(503);
    controls.readOnly = false;
    expect((await create()).status).toBe(201);
    expect((await cluster.db.query("SELECT count(*)::int AS count FROM intents")).rows[0]!.count).toBe(2);
  });
});
