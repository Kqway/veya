import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
  type TestInfo,
} from "@playwright/test";
import type {
  Card,
  Connection,
  Match,
  OwnPost,
  Profile,
  SeekingInput,
} from "../../src/features/social/client";

const origin = "http://127.0.0.1:3100";
const uuid =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const secretField =
  /^(?:id|.*(?:profile|guest|sender|recipient|session|post|pair|conversation)[_-]?id|.*hash|token.*|session.*|email|ip|fingerprint)$/i;
const privateField =
  /^(?:rawText|city|area|availability|startAt|endAt|windows|notes|ageBand|skill|languages|tags|desiredAgeBands|score|contact.*)$/i;

function projection(value: unknown, own = false, oneTime = false, path = "") {
  if (typeof value === "string") {
    expect(value, `UUID at ${path}`).not.toMatch(uuid);
    expect(value, `Hash at ${path}`).not.toMatch(/^[a-f0-9]{64}$/i);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const next = `${path}.${key}`;
    expect(secretField.test(key), `Server identity/secret field ${next}`).toBe(
      false,
    );
    if (!(oneTime && key === "recoveryKey"))
      expect(/^recovery/i.test(key), `Recovery field ${next}`).toBe(false);
    if (!own)
      expect(privateField.test(key), `Private field ${next}`).toBe(false);
    projection(child, own, oneTime, next);
  }
}

// Inspect real browser responses, including UI requests. Owner input/one-time key
// endpoints have separate allowances; discovery and pair DTOs never get them.
function observe(page: Page, errors: string[]) {
  const payloads: { path: string; method: string; body: unknown }[] = [];
  const pending: Promise<void>[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith("/api/social/")) return;
    const method = response.request().method();
    pending.push(
      (async () => {
        const body: unknown = await response.json();
        const own = /^\/api\/social\/(?:profile|seeking)(?:\/|$)/.test(path);
        const oneTime =
          method === "POST" &&
          /^\/api\/social\/profile(?:\/recover|\/key)?$/.test(path);
        projection(body, own, oneTime);
        expect(response.headers()["cache-control"]).toContain("no-store");
        payloads.push({ path, method, body });
      })().catch((error: unknown) => {
        errors.push(error instanceof Error ? error.message : String(error));
      }),
    );
  });
  return {
    async check(secrets: string[] = [], privateValues: string[] = []) {
      await Promise.all(pending);
      for (const payload of payloads) {
        const json = JSON.stringify(payload.body);
        if (payload.method === "GET") {
          for (const secret of secrets)
            expect(json.includes(secret), "GET leaked a Veya Key").toBe(false);
        }
        if (!/^\/api\/social\/(?:profile|seeking)(?:\/|$)/.test(payload.path)) {
          for (const value of privateValues)
            expect(
              json.includes(value),
              "Pair/discovery payload leaked private input",
            ).toBe(false);
        }
      }
      expect(errors).toEqual([]);
    },
  };
}

async function actor(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({
    ...(testInfo.project.name === "mobile"
      ? devices["Pixel 7"]
      : { viewport: { width: 1280, height: 900 } }),
    baseURL: origin,
    timezoneId: "Europe/Moscow",
  });
  return { context, page: await context.newPage() };
}

async function api<T>(
  context: BrowserContext,
  path: string,
  method = "GET",
  body?: unknown,
  status = 200,
): Promise<T> {
  // Chromium treats loopback as trustworthy for Secure cookies; Playwright's
  // separate API transport does not. Exercise the real same-origin browser path.
  const page = context.pages()[0]!;
  if (!page.url().startsWith(origin)) await page.goto("/");
  const response = await page.evaluate(async ({ path, method, body }) => {
    const result = await fetch(path, {
      method,
      credentials: "same-origin",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    return { status: result.status, cache: result.headers.get("cache-control"), data: await result.json() };
  }, { path, method, body });
  expect(response.status, `${method} ${path}`).toBe(status);
  if (path.startsWith("/api/social/")) expect(response.cache).toContain("no-store");
  const data: T = response.data;
  if (path.startsWith("/api/social/")) {
    projection(
      data,
      /^\/api\/social\/(?:profile|seeking)(?:\/|$)/.test(path),
      method === "POST" &&
        /^\/api\/social\/profile(?:\/recover|\/key)?$/.test(path),
    );
  }
  return data;
}

function responseFor(page: Page, path: string, method = "POST") {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path &&
      response.request().method() === method,
  );
}

async function createProfile(page: Page, alias: string, language: string) {
  await page.goto("/discover");
  await expect(
    page.getByRole("heading", { name: "Choose how you appear" }),
  ).toBeVisible();
  await page.getByLabel("Alias", { exact: true }).fill(alias);
  await page
    .getByRole("combobox", { name: "Privacy", exact: true })
    .selectOption("INCOGNITO");
  await page
    .getByRole("combobox", { name: "Age band (optional)", exact: true })
    .selectOption("25-29");
  await page.getByLabel("Profile languages (optional)").fill(language);
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  await expect(page.locator(".social-shell").getByRole("alert")).toContainText(
    "Confirm that you are 18 or older",
  );
  await page.getByLabel("I am 18 or older").check();
  const created = responseFor(page, "/api/social/profile");
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  expect((await created).status()).toBe(201);
  await expect(
    page.getByRole("heading", { name: "Save Veya Key privately" }),
  ).toBeVisible();
  await expect(
    page.getByText("This is shown once.", { exact: false }),
  ).toBeVisible();
  const key = await page.getByLabel("Veya Key", { exact: true }).inputValue();
  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await page
    .getByRole("button", { name: "I saved my key", exact: true })
    .click();
  await expect(page.getByLabel("Veya Key", { exact: true })).toHaveCount(0);
  return key;
}

async function customTime(page: Page, date: string) {
  await page.getByText("Choose custom times", { exact: true }).click();
  await page.getByLabel("Date", { exact: true }).fill(date);
  await page.getByLabel("Start time", { exact: true }).fill("18:00");
  await page.getByLabel("End time", { exact: true }).fill("20:00");
  await page.getByRole("button", { name: "Add time", exact: true }).click();
  await expect(
    page
      .getByRole("list", { name: "Selected availability" })
      .getByRole("listitem"),
  ).toHaveCount(1);
}

async function tomorrow(page: Page) {
  return page.evaluate(() => {
    const day = new Date();
    day.setDate(day.getDate() + 1);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  });
}

async function joinPlan(
  page: Page,
  creator: boolean,
  name: string,
  date: string,
) {
  await page
    .getByRole("button", {
      name: creator ? "Add your availability" : "Add yourself",
      exact: true,
    })
    .click();
  await page.getByLabel("Display name", { exact: true }).fill(name);
  await customTime(page, date);
  await page
    .getByRole("button", { name: "Join the plan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: `You're in, ${name}.`, exact: true }),
  ).toBeVisible();
}

async function overflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

async function json<T>(response: Response): Promise<T> {
  expect(response.ok()).toBe(true);
  return response.json() as Promise<T>;
}

test("A/B/C activity discovery becomes a private match, an ordinary plan, then blocked contact", async ({
  page,
  browser,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const auditA = observe(page, errors);
  const b = await actor(browser, testInfo),
    c = await actor(browser, testInfo),
    anonymous = await actor(browser, testInfo);
  const auditB = observe(b.page, errors),
    auditC = observe(c.page, errors),
    auditAnonymous = observe(anonymous.page, errors);
  // The projects share a DB. Different languages keep the true chess/Moscow
  // fixture isolated without inventing an activity key or mocking discovery.
  const language = testInfo.project.name === "desktop" ? "ru" : "en";
  const aliasA = `Global A ${testInfo.project.name}`,
    aliasB = `Global B ${testInfo.project.name}`,
    aliasC = `Global C ${testInfo.project.name}`;
  try {
    const key = await createProfile(page, aliasA, language);
    await page
      .getByRole("link", { name: "Create a seeking post", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your activity, your terms" }),
    ).toBeVisible();
    const rawText = `Private chess notes ${testInfo.project.name}`;
    await page
      .getByLabel("What do you want to do?", { exact: true })
      .fill(rawText);
    await page.getByLabel("Activity key", { exact: true }).fill("chess");
    await page.getByLabel("Activity label", { exact: true }).fill("Chess");
    await page.getByLabel("City", { exact: true }).fill("Moscow");
    await page.getByLabel("Coarse area (optional)").fill("North");
    await page
      .getByRole("combobox", { name: "Skill", exact: true })
      .selectOption("intermediate");
    await page.getByLabel("Languages", { exact: true }).fill(language);
    const date = await tomorrow(page);
    await customTime(page, date);
    const postResponse = responseFor(page, "/api/social/seeking");
    await page
      .getByRole("button", { name: "Create seeking post", exact: true })
      .click();
    const own = await json<OwnPost>(await postResponse);
    await expect(page).toHaveURL(/\/seek\/[A-Za-z0-9_-]{24}$/);
    await expect(page.getByText(rawText, { exact: true })).toBeVisible();
    expect(own).toMatchObject({
      activityKey: "chess",
      city: "Moscow",
      skill: "intermediate",
      privacyMode: "INCOGNITO",
    });
    expect(own.availability).toEqual([
      { startAt: `${date}T15:00:00.000Z`, endAt: `${date}T17:00:00.000Z` },
    ]);
    const input: SeekingInput = {
      rawText: `Private B chess ${testInfo.project.name}`,
      activityKey: "chess",
      activityLabel: "Chess",
      interactionMode: "in_person",
      format: "one_to_one",
      city: "Moscow",
      area: "North",
      availability: own.availability,
      skill: "intermediate",
      languages: [language],
      tags: [],
      desiredAgeBands: [],
      groupSize: null,
      privacyMode: "INCOGNITO",
    };
    for (const [person, alias] of [
      [b, aliasB],
      [c, aliasC],
    ] as const) {
      await api(person.context, "/api/session", "POST", {}, 201);
      await api(
        person.context,
        "/api/social/profile",
        "POST",
        {
          alias,
          privacyMode: "INCOGNITO",
          adultConfirmed: true,
          ageBand: "25-29",
          languages: [language],
        },
        201,
      );
    }
    const bPost = await api<OwnPost>(
      b.context,
      "/api/social/seeking",
      "POST",
      input,
      201,
    );
    await api(
      c.context,
      "/api/social/seeking",
      "POST",
      {
        ...input,
        rawText: "Private football in another city",
        activityKey: "football",
        activityLabel: "Football",
        city: "Kazan",
      },
      201,
    );
    // A second C post exercises the city hard filter independently of activity.
    await api(
      c.context,
      "/api/social/seeking",
      "POST",
      { ...input, rawText: "Private chess in another city", city: "Kazan" },
      201,
    );

    await page.getByRole("link", { name: "Find people", exact: true }).click();
    const discovery = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/social/discover" &&
        r.request().method() === "GET",
    );
    await page
      .getByRole("button", { name: "Find people", exact: true })
      .click();
    const cards = (await json<{ cards: Card[] }>(await discovery)).cards;
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(Object.keys(card).sort()).toEqual([
      "activityLabel",
      "format",
      "handle",
      "identity",
      "interactionMode",
      "reasons",
      "timeHint",
    ]);
    expect(card.identity.alias).not.toBe(aliasB);
    expect(JSON.stringify(cards)).not.toContain(bPost.publicKey);
    const candidates = page.getByRole("region", {
      name: "Compatible people",
      exact: true,
    });
    await expect(candidates.getByRole("article")).toHaveCount(1);
    await expect(candidates).toContainText(card.identity.alias);
    await expect(candidates).not.toContainText(aliasB);
    await expect(candidates).not.toContainText(aliasC);
    await expect(candidates).not.toContainText("Football");
    // A handle is viewer-bound, and C cannot retrieve B's owner post.
    await api(
      c.context,
      "/api/social/connections",
      "POST",
      { handle: card.handle },
      404,
    );
    await api(
      c.context,
      `/api/social/seeking/${bPost.publicKey}`,
      "GET",
      undefined,
      404,
    );
    const interest = responseFor(page, "/api/social/connections");
    await candidates
      .getByRole("button", { name: "Interested", exact: true })
      .click();
    const request = await json<{ publicKey: string }>(await interest);
    await expect(
      page.getByRole("status").filter({ hasText: "Interest sent." }),
    ).toBeVisible();

    await b.page.goto("/connections");
    const incoming = b.page.getByRole("region", {
      name: "Incoming requests",
      exact: true,
    });
    await expect(incoming.getByRole("article")).toHaveCount(1);
    const incomingData = await api<{ requests: Connection[] }>(
      b.context,
      "/api/social/connections",
    );
    const incomingRequest = incomingData.requests[0]!;
    expect(incomingRequest.identity.alias).not.toBe(aliasA);
    const accept = responseFor(
      b.page,
      `/api/social/connections/${request.publicKey}/respond`,
    );
    await incoming.getByRole("button", { name: "Accept", exact: true }).click();
    const accepted = await json<{ matchKey: string }>(await accept);
    const matchPath = `/api/social/matches/${accepted.matchKey}`;
    await incoming
      .getByRole("link", { name: "View conversation", exact: true })
      .click();
    await expect(
      b.page.getByRole("heading", { name: "Your conversation", exact: true }),
    ).toBeVisible();
    await page.goto("/connections");
    await page
      .getByRole("link", { name: "View conversation", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your conversation", exact: true }),
    ).toBeVisible();
    const aMatch = await api<Match>(context, matchPath),
      bMatch = await api<Match>(b.context, matchPath);
    expect(aMatch.identity).toEqual(card.identity);
    expect(bMatch.ownIdentity).toEqual(card.identity);
    expect(bMatch.identity).toEqual(incomingRequest.identity);
    expect(aMatch.ownIdentity).toEqual(bMatch.identity);
    await expect(page.locator(".social-shell")).not.toContainText(aliasA);
    await expect(page.locator(".social-shell")).not.toContainText(aliasB);
    await api(c.context, matchPath, "GET", undefined, 404);
    await api(c.context, `${matchPath}/messages`, "GET", undefined, 404);
    await api(
      c.context,
      `${matchPath}/messages`,
      "POST",
      { text: "Outsider send" },
      404,
    );

    const xss =
      '<img src=x onerror="window.__socialXss=1"><script>window.__socialXss=1</script> Chess tomorrow?';
    await page.getByLabel("Message", { exact: true }).fill(xss);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByRole("list", { name: "Conversation messages" }),
    ).toContainText(xss);
    await b.page
      .getByRole("button", { name: "Refresh messages", exact: true })
      .click();
    const messagesB = b.page.getByRole("list", {
      name: "Conversation messages",
    });
    await expect(messagesB).toContainText(xss);
    await expect(messagesB.locator("img, script")).toHaveCount(0);
    expect(
      await b.page.evaluate(() => Object.hasOwn(window, "__socialXss")),
    ).toBe(false);
    await b.page
      .getByLabel("Message", { exact: true })
      .fill("Yes, let's play tomorrow.");
    await b.page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(messagesB).toContainText("Yes, let's play tomorrow.");
    await page
      .getByRole("button", { name: "Refresh messages", exact: true })
      .click();
    await expect(
      page.getByRole("list", { name: "Conversation messages" }),
    ).toContainText("Yes, let's play tomorrow.");

    await page.getByLabel("Disclosure value", { exact: true }).fill("Alex");
    await page
      .getByRole("button", { name: "Share disclosure", exact: true })
      .click();
    await expect(
      page.locator(".social-shell").getByRole("alert"),
    ).toContainText("Confirm your consent");
    expect((await api<Match>(b.context, matchPath)).disclosures).toEqual([]);
    await page.getByLabel("I understand and consent", { exact: true }).check();
    await page
      .getByRole("button", { name: "Share disclosure", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Detail shared" }),
    ).toBeVisible();
    await b.page
      .getByRole("button", { name: "Refresh messages", exact: true })
      .click();
    await expect(b.page.getByText(/First name: Alex/)).toBeVisible();
    expect((await api<Match>(b.context, matchPath)).disclosures).toEqual([
      { kind: "first_name", value: "Alex", isMine: false },
    ]);
    expect(
      (await api<{ matches: Match[] }>(c.context, "/api/social/matches"))
        .matches,
    ).toEqual([]);

    await page.getByRole("button", { name: "Plan it", exact: true }).click();
    await page
      .getByRole("button", { name: "Create plan", exact: true })
      .click();
    const open = page.getByRole("link", { name: "Open plan", exact: true });
    await expect(open).toHaveAttribute("href", /^\/i\/[A-Za-z0-9_-]{24}$/);
    const planPath = (await open.getAttribute("href"))!;
    const plan = await api<{
      isCreator: boolean;
      ownParticipant: unknown;
      intent: { rawText: string; participantCount: number };
    }>(context, `/api/intents/${planPath.split("/").pop()}`);
    expect(plan.isCreator).toBe(true);
    expect(plan.ownParticipant).toBeNull();
    expect(plan.intent.participantCount).toBe(0);
    expect(plan.intent.rawText).not.toContain(rawText);
    expect(plan.intent.rawText).not.toContain("Alex");
    await open.click();
    await joinPlan(page, true, "Plan A", date);
    await b.page
      .getByRole("button", { name: "Refresh messages", exact: true })
      .click();
    await b.page.getByRole("link", { name: "Open plan", exact: true }).click();
    await joinPlan(b.page, false, "Plan B", date);
    for (const member of [page, b.page]) {
      await member
        .getByRole("link", { name: "Find a time together", exact: true })
        .click();
      const best = member.getByRole("region", {
        name: "Best match",
        exact: true,
      });
      await expect(best).toContainText("2 of 2");
      await best.getByRole("button", { name: "YES", exact: true }).click();
      await expect(
        best.getByRole("button", { name: "YES", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await page.reload();
    const best = page.getByRole("region", { name: "Best match", exact: true });
    await expect(best.getByLabel("Group votes")).toContainText("YES 2");
    await best
      .getByRole("button", { name: "Choose this plan", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm plan", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "It's a plan.", exact: true }),
    ).toBeVisible();
    await b.page
      .getByRole("button", { name: "Refresh results", exact: true })
      .click();
    await expect(
      b.page.getByRole("heading", { name: "It's a plan.", exact: true }),
    ).toBeVisible();

    await page.goto(`/m/${accepted.matchKey}`);
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Block", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirm block", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Blocked." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toHaveCount(0);
    await b.page.goto(`/m/${accepted.matchKey}`);
    await expect(
      b.page
        .getByRole("status")
        .filter({ hasText: "This conversation is closed" }),
    ).toBeVisible();
    await expect(
      b.page.getByRole("button", { name: "Send message", exact: true }),
    ).toHaveCount(0);
    for (const member of [context, b.context]) {
      await api(
        member,
        `${matchPath}/messages`,
        "POST",
        { text: "Blocked send" },
        409,
      );
      const retained = await api<{ messages: { text: string }[] }>(
        member,
        `${matchPath}/messages`,
      );
      expect(retained.messages.map((m) => m.text)).toContain(xss);
      await api(
        member,
        `${matchPath}/disclosures`,
        "POST",
        { kind: "contact_handle", value: "blocked", consent: true },
        409,
      );
    }
    // Fresh compatible source posts rule out source exhaustion. Pair suppression
    // also applies after requests; block must remain effective for new posts.
    for (const [member, memberPage] of [
      [context, page],
      [b.context, b.page],
    ] as const) {
      const fresh = await api<OwnPost>(
        member,
        "/api/social/seeking",
        "POST",
        input,
        201,
      );
      await memberPage.goto("/discover");
      await memberPage
        .getByRole("combobox", { name: "Your active activity", exact: true })
        .selectOption(fresh.publicKey);
      await memberPage
        .getByRole("button", { name: "Find people", exact: true })
        .click();
      await expect(
        memberPage.getByRole("region", { name: "Compatible people" }),
      ).toContainText("No compatible people found");
      expect(
        (
          await api<{ cards: Card[] }>(
            member,
            `/api/social/discover?source=${fresh.publicKey}`,
          )
        ).cards,
      ).toEqual([]);
      await overflow(memberPage);
    }
    for (const path of [
      "/discover",
      "/seek/new",
      "/connections",
      `/m/${accepted.matchKey}`,
    ]) {
      await anonymous.page.goto(path);
      await expect(
        anonymous.page.locator('meta[name="robots"]'),
      ).toHaveAttribute("content", /noindex/);
      await expect(anonymous.page.locator("body")).not.toContainText(xss);
      await expect(anonymous.page.locator("body")).not.toContainText(
        card.identity.alias,
      );
    }
    for (const path of [
      "/profile",
      "/seeking",
      "/connections",
      "/matches",
      `/matches/${accepted.matchKey}/messages`,
    ])
      await api(anonymous.context, `/api/social${path}`, "GET", undefined, 401);
    await page.goto(`/m/${accepted.matchKey}`);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "This conversation is closed" }),
    ).toBeVisible();
    await overflow(page);
    await page.screenshot({
      path: `test-results/intent-network-${testInfo.project.name}.png`,
      fullPage: true,
    });
    const privateValues = [
      aliasA,
      aliasB,
      aliasC,
      rawText,
      input.rawText,
      "Moscow",
      "North",
      ...own.availability.flatMap((w) => [w.startAt, w.endAt]),
    ];
    await auditA.check([key], privateValues);
    await auditB.check([], privateValues);
    await auditC.check();
    await auditAnonymous.check([key]);
  } finally {
    await Promise.all([
      b.context.close(),
      c.context.close(),
      anonymous.context.close(),
    ]);
  }
});

test("Veya Key recovery rotates secrets, detaches social sessions and preserves coordination identity", async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const originalAudit = observe(page, errors);
  const recovered = await actor(browser, testInfo),
    probe = await actor(browser, testInfo);
  const recoveredAudit = observe(recovered.page, errors),
    probeAudit = observe(probe.page, errors);
  try {
    const language = testInfo.project.name === "desktop" ? "ru" : "en";
    const alias = `Recovery ${testInfo.project.name}`;
    const oldKey = await createProfile(page, alias, language);
    const originalProfile = (
      await api<{ profile: Profile }>(context, "/api/social/profile")
    ).profile;
    await page.goto("/");
    await page
      .getByRole("textbox")
      .fill("Keep my original coordination identity");
    await page
      .getByRole("button", { name: "Make it happen", exact: true })
      .click();
    await page
      .getByLabel("Your name", { exact: true })
      .fill("Original planner");
    await page.getByRole("button", { name: "Coffee", exact: true }).click();
    await page
      .getByRole("button", { name: "Create invite", exact: true })
      .click();
    await expect(page).toHaveURL(/\/i\/[A-Za-z0-9_-]{24}$/);
    const planUrl = page.url(),
      slug = new URL(planUrl).pathname.split("/").pop()!;
    await joinPlan(page, true, "Original planner", await tomorrow(page));
    const before = await api<{ isCreator: boolean; ownParticipant: unknown }>(
      context,
      `/api/intents/${slug}`,
    );
    expect(before.isCreator).toBe(true);
    expect(before.ownParticipant).not.toBeNull();
    const originalCookies = await context.cookies();

    await recovered.page.goto("/discover");
    await recovered.page
      .getByRole("button", { name: "Recover with a Veya Key", exact: true })
      .click();
    await recovered.page
      .getByLabel("Recovery key", { exact: true })
      .fill(oldKey);
    const recoverResponse = responseFor(
      recovered.page,
      "/api/social/profile/recover",
    );
    await recovered.page
      .getByRole("button", { name: "Recover profile", exact: true })
      .click();
    const recovery = await json<{ profile: Profile; recoveryKey: string }>(
      await recoverResponse,
    );
    expect(recovery.profile).toEqual(originalProfile);
    expect(recovery.recoveryKey).not.toBe(oldKey);
    await expect(
      recovered.page.getByLabel("Veya Key", { exact: true }),
    ).toHaveValue(recovery.recoveryKey);
    await recovered.page
      .getByRole("button", { name: "I saved my key", exact: true })
      .click();
    expect(
      (await api<{ profile: Profile | null }>(context, "/api/social/profile"))
        .profile,
    ).toBeNull();
    await api(context, "/api/social/seeking", "GET", undefined, 404);
    await api(context, "/api/social/connections", "GET", undefined, 404);
    expect(await context.cookies()).toEqual(originalCookies);
    const after = await api<{ isCreator: boolean; ownParticipant: unknown }>(
      context,
      `/api/intents/${slug}`,
    );
    expect(after.isCreator).toBe(true);
    expect(after.ownParticipant).toEqual(before.ownParticipant);
    const newcomerPlan = await api<{
      isCreator: boolean;
      ownParticipant: unknown;
    }>(recovered.context, `/api/intents/${slug}`);
    expect(newcomerPlan.isCreator).toBe(false);
    expect(newcomerPlan.ownParticipant).toBeNull();
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "You're in, Original planner.",
        exact: true,
      }),
    ).toBeVisible();

    await probe.page.goto("/discover");
    await probe.page
      .getByRole("button", { name: "Recover with a Veya Key", exact: true })
      .click();
    async function rejectKey(key: string) {
      await probe.page.getByLabel("Recovery key", { exact: true }).fill(key);
      const rejected = responseFor(probe.page, "/api/social/profile/recover");
      await probe.page
        .getByRole("button", { name: "Recover profile", exact: true })
        .click();
      const response = await rejected;
      expect(response.status()).toBe(404);
      const body: unknown = await response.json();
      projection(body);
      await expect(
        probe.page.locator(".social-shell").getByRole("alert"),
      ).toContainText("This item is unavailable to this session.");
      expect(
        (
          await api<{ profile: Profile | null }>(
            probe.context,
            "/api/social/profile",
          )
        ).profile,
      ).toBeNull();
      return body;
    }
    const wrong = await rejectKey("A".repeat(43));
    expect(await rejectKey(oldKey)).toEqual(wrong);
    const rotation = responseFor(recovered.page, "/api/social/profile/key");
    await recovered.page
      .getByRole("button", { name: "Rotate Veya Key", exact: true })
      .click();
    const rotated = await json<{ recoveryKey: string }>(await rotation);
    expect(rotated.recoveryKey).not.toBe(recovery.recoveryKey);
    await expect(
      recovered.page.getByLabel("Veya Key", { exact: true }),
    ).toHaveValue(rotated.recoveryKey);
    await recovered.page
      .getByRole("button", { name: "I saved my key", exact: true })
      .click();
    expect(await rejectKey(recovery.recoveryKey)).toEqual(wrong);
    await recovered.page.reload();
    await expect(
      recovered.page.getByLabel("Veya Key", { exact: true }),
    ).toHaveCount(0);
    await recovered.page
      .getByRole("button", { name: "Revoke Veya Key", exact: true })
      .click();
    const revoke = responseFor(
      recovered.page,
      "/api/social/profile/key",
      "DELETE",
    );
    await recovered.page
      .getByRole("button", { name: "Confirm revoke", exact: true })
      .click();
    expect(await json(await revoke)).toEqual({ revoked: true });
    await expect(
      recovered.page.getByRole("button", {
        name: "Revoke Veya Key",
        exact: true,
      }),
    ).toBeDisabled();
    expect(
      (
        await api<{ profile: Profile }>(
          recovered.context,
          "/api/social/profile",
        )
      ).profile,
    ).toEqual({ ...originalProfile, hasRecoveryKey: false });
    expect(await rejectKey(rotated.recoveryKey)).toEqual(wrong);
    await overflow(recovered.page);
    await overflow(probe.page);
    await recovered.page.screenshot({
      path: `test-results/intent-network-recovery-${testInfo.project.name}.png`,
      fullPage: true,
    });
    const keys = [oldKey, recovery.recoveryKey, rotated.recoveryKey];
    await originalAudit.check(keys);
    await recoveredAudit.check(keys);
    await probeAudit.check(keys);
  } finally {
    await Promise.all([recovered.context.close(), probe.context.close()]);
  }
});
