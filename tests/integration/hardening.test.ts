import { createHash } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { VeyaBackend } from "@/features/backend/service";
let database: Awaited<ReturnType<typeof startTestDatabase>>;
let backend: VeyaBackend;
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 3000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Expected database condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}
beforeAll(async () => {
  database = await startTestDatabase();
  await applyMigrations(database.db);
  backend = new VeyaBackend(database.db);
});
afterAll(async () => database?.stop());
afterEach(() => vi.restoreAllMocks());
async function setup() {
  const guest = await backend.createSession();
  const view = await backend.createIntent(guest.token, {
    rawText: "Coffee",
    creatorName: "Artem",
  });
  return { guest, slug: view.intent.publicSlug };
}
describe("release temporal authorization and preserved edits", () => {
  it("bounds members under the intent lock and permits duplicates at capacity", async () => {
    const { guest, slug } = await setup();
    const tokens = [guest.token];
    for (let i = 1; i < 33; i++)
      tokens.push((await backend.createSession()).token);
    for (let i = 0; i < 32; i++)
      await backend.joinIntent(tokens[i]!, slug, {
        displayName: `Friend ${i}`,
      });
    await expect(
      backend.joinIntent(tokens[32]!, slug, { displayName: "Extra" }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
    expect(
      (await backend.joinIntent(tokens[0]!, slug, { displayName: "Duplicate" }))
        .created,
    ).toBe(false);
    expect((await backend.getIntent(slug)).intent.participantCount).toBe(32);
  });
  it("bounds aggregate windows before joins and updates without losing saved data", async () => {
    const { slug } = await setup();
    const windows = Array.from({ length: 28 }, (_, i) => ({
      startAt: new Date(Date.now() + (i + 1) * 3600000).toISOString(),
      endAt: new Date(Date.now() + (i + 1) * 3600000 + 600000).toISOString(),
    }));
    let lastToken = "";
    for (let i = 0; i < 5; i++) {
      const guest = await backend.createSession();
      lastToken = guest.token;
      await backend.joinIntent(lastToken, slug, {
        displayName: `Friend ${i}`,
        availability: windows.slice(0, i === 4 ? 16 : 28),
      });
    }
    const extra = await backend.createSession();
    await expect(
      backend.joinIntent(extra.token, slug, {
        displayName: "Extra",
        availability: [windows[0]],
      }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
    await expect(
      backend.updateParticipant(lastToken, slug, {
        displayName: "Updated",
        availability: windows.slice(0, 17),
      }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
    await expect(backend.updateParticipant(extra.token,slug,{displayName:"Outsider",availability:[windows[0]]})).rejects.toMatchObject({code:"NOT_FOUND"});
    expect(
      (await backend.getIntent(slug, lastToken)).ownParticipant?.availability,
    ).toHaveLength(16);
  });
  it.each(["join", "vote"])(
    "rejects %s queued past invitation expiry",
    async (operation) => {
      const { guest, slug } = await setup();
      const start = new Date(Date.now() + 3600000).toISOString(),
        end = new Date(Date.now() + 7200000).toISOString();
      let selection: { suggestionKey: string; revision: number } | undefined;
      if (operation === "vote") {
        await backend.joinIntent(guest.token, slug, {
          displayName: "Artem",
          availability: [{ startAt: start, endAt: end }],
        });
        const results = await backend.getResults(slug, guest.token);
        selection = {
          suggestionKey: results.suggestions[0]!.suggestionKey,
          revision: results.revision,
        };
      }
      await database.db.query(
        "UPDATE intents SET expires_at=clock_timestamp()+interval '400 milliseconds' WHERE public_slug=$1",
        [slug],
      );
      const ready = gate(),
        release = gate();
      const holder = database.db.transaction(async (tx) => {
        await tx.query(
          "SELECT id FROM intents WHERE public_slug=$1 FOR UPDATE",
          [slug],
        );
        ready.resolve();
        await release.promise;
      });
      await ready.promise;
      const pending = (
        operation === "join"
          ? backend.joinIntent(guest.token, slug, { displayName: "Late" })
          : backend.vote(guest.token, slug, { ...selection, value: "yes" })
      ).then(
        (result) => ({ result, error: null }),
        (error) => ({ result: null, error }),
      );
      try {
        await until(
          async () =>
            (
              await database.db.query<{ count: number }>(
                "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT i.%FROM intents%FOR UPDATE%'",
              )
            ).rows[0]!.count > 0,
        );
        await until(
          async () =>
            (
              await database.db.query<{ expired: boolean }>(
                "SELECT expires_at<=clock_timestamp() AS expired FROM intents WHERE public_slug=$1",
                [slug],
              )
            ).rows[0]!.expired,
        );
      } finally {
        release.resolve();
      }
      await holder;
      const outcome = await pending;
      expect(outcome.error).toMatchObject({ code: "INVITE_EXPIRED" });
      expect((await backend.getIntent(slug)).intent.status).toBe("expired");
    },
  );
  it("rechecks session expiration after waiting for an intent lock", async () => {
    const { guest, slug } = await setup();
    const hash = createHash("sha256").update(guest.token).digest("hex");
    await database.db.query(
      "UPDATE guest_participant_sessions SET expires_at=clock_timestamp()+interval '400 milliseconds' WHERE token_hash=$1",
      [hash],
    );
    const ready = gate(),
      release = gate();
    const holder = database.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM intents WHERE public_slug=$1 FOR UPDATE", [
        slug,
      ]);
      ready.resolve();
      await release.promise;
    });
    await ready.promise;
    const pending = backend
      .joinIntent(guest.token, slug, { displayName: "Expired guest" })
      .then(
        (result) => ({ result, error: null }),
        (error) => ({ result: null, error }),
      );
    try {
      await until(
        async () =>
          (
            await database.db.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT i.%FROM intents%FOR UPDATE%'",
            )
          ).rows[0]!.count > 0,
      );
      await until(
        async () =>
          (
            await database.db.query<{ expired: boolean }>(
              "SELECT expires_at<=clock_timestamp() AS expired FROM guest_participant_sessions WHERE token_hash=$1",
              [hash],
            )
          ).rows[0]!.expired,
      );
    } finally {
      release.resolve();
    }
    await holder;
    expect((await pending).error).toMatchObject({ code: "UNAUTHORIZED" });
    expect((await backend.getIntent(slug)).intent.participantCount).toBe(0);
  });
  it("preserves unchanged elapsed windows on edits but rejects changed/new past windows", async () => {
    const { guest, slug } = await setup(),
      now = Date.now();
    const windows = [
      {
        startAt: new Date(now + 60000).toISOString(),
        endAt: new Date(now + 3600000).toISOString(),
      },
      {
        startAt: new Date(now + 86400000).toISOString(),
        endAt: new Date(now + 90000000).toISOString(),
      },
    ];
    const joined = await backend.joinIntent(guest.token, slug, {
      displayName: "Artem",
      availability: windows,
    });
    vi.spyOn(Date, "now").mockReturnValue(now + 61000);
    const saved = await backend.updateParticipant(guest.token, slug, {
      ...joined.view.ownParticipant,
      displayName: "Updated",
    });
    expect(saved.ownParticipant?.availability).toEqual(windows);
    await expect(
      backend.updateParticipant(guest.token, slug, {
        ...saved.ownParticipant,
        availability: [
          { ...windows[0], startAt: new Date(now + 30000).toISOString() },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const friend = await backend.createSession();
    await expect(
      backend.joinIntent(friend.token, slug, {
        displayName: "Friend",
        availability: [windows[0]],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
