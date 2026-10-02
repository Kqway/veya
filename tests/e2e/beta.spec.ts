import { devices, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import type { Card, Connection, Match, Message, OwnPost, Profile } from "../../src/features/social/client";

const origin = "http://127.0.0.1:3100";
const idea = "Хочу поиграть в шахматы завтра";

async function actor(browser: Browser, info: TestInfo) {
  const context = await browser.newContext({
    ...(info.project.name === "mobile" ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } }),
    baseURL: origin,
    timezoneId: "Europe/Moscow",
  });
  return { context, page: await context.newPage() };
}

// Reads and rejected bypass attempts use the same authenticated browser transport
// as the UI. Every successful profile/post/request/chat/plan mutation uses controls.
async function api<T>(page: Page, path: string, method = "GET", body?: unknown, status = 200): Promise<T> {
  const result = await page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method, credentials: "same-origin", cache: "no-store",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    return { status: response.status, cache: response.headers.get("cache-control"), data: await response.json() };
  }, { path, method, body });
  expect(result.status, `${method} ${path}`).toBe(status);
  expect(result.cache).toContain("no-store");
  return result.data as T;
}

function responseFor(page: Page, path: string, method = "POST") {
  return page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
}

async function overflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function dateTomorrow(page: Page) {
  return page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
}

async function time(page: Page, date: string) {
  await page.getByText("Choose custom times", { exact: true }).click();
  await page.getByLabel("Date", { exact: true }).fill(date);
  await page.getByLabel("Start time", { exact: true }).fill("18:00");
  await page.getByLabel("End time", { exact: true }).fill("20:00");
  await page.getByRole("button", { name: "Add time", exact: true }).click();
  await expect(page.getByRole("list", { name: "Selected availability" }).getByRole("listitem")).toHaveCount(1);
}

async function createProfile(page: Page, alias: string, copyAndNavigate = false) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "What do you want to do?", exact: true }).fill(idea);
  await page.getByRole("button", { name: "Find compatible people", exact: true }).click();
  await expect(page).toHaveURL(/\/seek\/new$/);
  await page.getByLabel("Alias", { exact: true }).fill(alias);
  await page.getByRole("combobox", { name: "Privacy", exact: true }).selectOption("INCOGNITO");
  await page.getByLabel("Profile languages (optional)").fill("ru");
  await page.getByLabel("I am 18 or older").check();
  const created = responseFor(page, "/api/social/profile");
  await page.getByRole("button", { name: "Create profile", exact: true }).click();
  expect((await created).status()).toBe(201);
  const keyField = page.getByLabel("Veya Key", { exact: true });
  await expect(keyField).toBeVisible();
  const key = await keyField.inputValue();
  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  if (copyAndNavigate) {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await page.getByRole("button", { name: "Copy Veya Key", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Key copied." })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
    // Copying is not acknowledgement; the memory-only banner survives SPA routes.
    await expect(keyField).toHaveValue(key);
    await page.getByRole("navigation", { name: "Social navigation" }).getByRole("link", { name: "Discover", exact: true }).click();
    await expect(keyField).toHaveValue(key);
    await overflow(page);
    await page.getByRole("navigation", { name: "Social navigation" }).getByRole("link", { name: "New activity", exact: true }).click();
    await expect(keyField).toHaveValue(key);
  }
  expect(await page.evaluate(key => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(key), key)).toBe(false);
  await page.getByRole("button", { name: "I saved my key", exact: true }).click();
  await expect(keyField).toHaveCount(0);
  await overflow(page);
  return key;
}

async function createPost(page: Page, city: string, date: string, activity = "chess", reviewRussian = false) {
  if (!page.url().endsWith("/seek/new")) await page.goto("/seek/new");
  const raw = page.getByRole("textbox", { name: "What do you want to do?", exact: true });
  await raw.fill(activity === "chess" ? idea : "Хочу поиграть в футбол завтра");
  if (reviewRussian) {
    await expect(page.getByLabel("Activity key", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Help structure", exact: true }).click();
    await expect(page.getByRole("region", { name: "Review suggestion", exact: true })).toContainText("chess");
    await expect(page.getByLabel("Activity key", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Apply reviewed suggestion", exact: true }).click();
    await expect(page.getByLabel("Activity key", { exact: true })).toHaveValue("chess");
  }
  await page.getByLabel("Activity key", { exact: true }).fill(activity);
  await page.getByLabel("Activity label", { exact: true }).fill(activity === "chess" ? "Шахматы" : "Футбол");
  await page.getByLabel("City", { exact: true }).fill(city);
  await page.getByLabel("Languages", { exact: true }).fill("ru");
  await time(page, date);
  await overflow(page);
  const saved = responseFor(page, "/api/social/seeking");
  await page.getByRole("button", { name: "Create seeking post", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const post = await response.json() as OwnPost;
  await expect(page).toHaveURL(new RegExp(`/seek/${post.publicKey}$`));
  expect(post).toMatchObject({ activityKey: activity, privacyMode: "INCOGNITO", languages: ["ru"], city });
  expect(post.availability).toEqual([{ startAt: `${date}T15:00:00.000Z`, endAt: `${date}T17:00:00.000Z` }]);
  return post;
}

async function discover(page: Page, post: OwnPost, count: number) {
  await page.goto("/discover");
  await page.getByLabel("Your active activity").selectOption(post.publicKey);
  const response = responseFor(page, "/api/social/discover", "GET");
  await page.getByRole("button", { name: "Find people", exact: true }).click();
  const cards = (await (await response).json() as { cards: Card[] }).cards;
  expect(cards).toHaveLength(count);
  await expect(page.getByRole("region", { name: "Compatible people", exact: true }).getByRole("article")).toHaveCount(count);
  return cards;
}

async function connect(a: Page, b: Page, post: OwnPost) {
  await b.goto("/connections");
  await expect(b.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  const cards = await discover(a, post, 1);
  const requested = responseFor(a, "/api/social/connections");
  await a.getByRole("region", { name: "Compatible people", exact: true }).getByRole("button", { name: "Interested", exact: true }).click();
  const request = await (await requested).json() as Connection;
  await expect(a.getByRole("status").filter({ hasText: "Interest sent." })).toBeVisible();
  await a.getByRole("link", { name: "View connections", exact: true }).click();
  // The recipient remains open throughout Interested, and the sender during Accept.
  const incoming = b.getByRole("region", { name: "Incoming requests", exact: true });
  await expect(incoming.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
  const accepted = responseFor(b, `/api/social/connections/${request.publicKey}/respond`);
  await incoming.getByRole("button", { name: "Accept", exact: true }).click();
  const matchKey = (await (await accepted).json() as Connection).matchKey!;
  expect(matchKey).toMatch(/^[A-Za-z0-9_-]{24}$/);
  await expect(a.getByRole("link", { name: "View conversation", exact: true }).last()).toBeVisible();
  for (const member of [a, b]) {
    await member.locator(`a[href="/m/${matchKey}"]`).click();
    await expect(member.getByLabel("Message", { exact: true })).toBeVisible();
    await overflow(member);
  }
  const match = await api<Match>(a, `/api/social/matches/${matchKey}`);
  expect(match.identity).toEqual(cards[0]!.identity);
  return matchKey;
}

async function send(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("list", { name: "Conversation messages" })).toContainText(text);
}

async function join(page: Page, creator: boolean, name: string, date: string) {
  await page.getByRole("button", { name: creator ? "Add your availability" : "Add yourself", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill(name);
  await expect(page.getByRole("list", { name: "Selected availability" }).getByRole("listitem")).toHaveCount(0);
  await time(page, date);
  await page.getByRole("button", { name: "Join the plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: `You're in, ${name}.`, exact: true })).toBeVisible();
}

function pairProjection(value: unknown, forbiddenValues: string[]) {
  const json = JSON.stringify(value);
  expect(json).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  for (const forbidden of forbiddenValues) expect(json).not.toContain(forbidden);
  function walk(item: unknown) {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      expect(key).not.toMatch(/^(?:id|.*(?:profile|guest|sender|recipient|session|post|pair|conversation)[_-]?id|.*hash|token.*|recovery.*|rawText|city|area|availability|startAt|endAt|windows|notes|contact.*|ageBand|skill|languages|tags|desiredAgeBands|score|email|ip|fingerprint)$/i);
      walk(child);
    }
  }
  walk(value);
}

test("two people create Russian chess posts through the UI, meet live and confirm a voted plan, including 320px mobile", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const b = await actor(browser, info), incompatible = await actor(browser, info);
  const errors: string[] = [];
  for (const member of [page, b.page, incompatible.page]) member.on("pageerror", error => errors.push(error.message));
  if (info.project.name === "mobile") {
    for (const member of [page, b.page, incompatible.page]) {
      await member.setViewportSize({ width: 320, height: 780 });
      await member.emulateMedia({ reducedMotion: "reduce" });
    }
  }
  const city = `Beta chess ${info.project.name} ${Date.now()}`;
  try {
    await createProfile(page, "Скрытый первый", true);
    const date = await dateTomorrow(page);
    const post = await createPost(page, city, date, "chess", true);
    await createProfile(b.page, "Скрытый второй");
    await createPost(b.page, city, date);
    await createProfile(incompatible.page, "Несовместимый третий");
    await createPost(incompatible.page, city, date, "football");
    await createPost(incompatible.page, `${city} elsewhere`, date);
    const key = await connect(page, b.page, post);
    const matchPath = `/api/social/matches/${key}`;
    await send(page, "Сыграем завтра в общественном месте?");
    await expect(b.page.getByRole("list", { name: "Conversation messages" })).toContainText("Сыграем завтра в общественном месте?");
    await send(b.page, "Да, давай выберем время.");
    await expect(page.getByRole("list", { name: "Conversation messages" })).toContainText("Да, давай выберем время.");
    const match = await api<Match>(page, matchPath);
    pairProjection(match, ["Скрытый первый", "Скрытый второй", "Несовместимый третий", city, idea]);
    expect(match.disclosures).toEqual([]);
    await page.getByRole("button", { name: "Plan it", exact: true }).click();
    await expect(page.getByRole("button", { name: "Create plan", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create plan", exact: true }).click();
    await expect(b.page.getByRole("link", { name: "Open plan", exact: true })).toBeVisible();
    const linked = await api<Match>(page, matchPath);
    expect(linked.planSlug).toBeTruthy();
    expect((await api<Match>(b.page, matchPath)).planSlug).toBe(linked.planSlug);
    const slug = linked.planSlug!;
    const initial = await api<{ isCreator: boolean; ownParticipant: unknown; intent: { participantCount: number } }>(page, `/api/intents/${slug}`);
    expect(initial).toMatchObject({ isCreator: true, ownParticipant: null, intent: { participantCount: 0 } });
    await page.getByRole("link", { name: "Open plan", exact: true }).click();
    await join(page, true, "Первый игрок", date);
    await b.page.getByRole("link", { name: "Open plan", exact: true }).click();
    await join(b.page, false, "Второй игрок", date);
    for (const member of [page, b.page]) {
      await member.getByRole("link", { name: "Find a time together", exact: true }).click();
      const best = member.getByRole("region", { name: "Best match", exact: true });
      await expect(best).toContainText("2 of 2");
      await expect(best.getByRole("list", { name: "Group availability" })).toContainText("Первый игрок");
      await expect(best.getByRole("list", { name: "Group availability" })).toContainText("Второй игрок");
      await best.getByRole("button", { name: "YES", exact: true }).click();
      await expect(best.getByRole("button", { name: "YES", exact: true })).toHaveAttribute("aria-pressed", "true");
      await overflow(member);
    }
    await expect(b.page.getByRole("button", { name: "Choose this plan", exact: true })).toHaveCount(0);
    await page.reload();
    const best = page.getByRole("region", { name: "Best match", exact: true });
    await expect(best.getByLabel("Group votes")).toContainText("YES 2");
    await best.getByRole("button", { name: "Choose this plan", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Make this the group plan?", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "It's a plan.", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Confirm plan", exact: true }).click();
    await expect(page.getByRole("heading", { name: "It's a plan.", exact: true })).toBeVisible();
    await b.page.getByRole("button", { name: "Refresh results", exact: true }).click();
    await expect(b.page.getByRole("heading", { name: "It's a plan.", exact: true })).toBeVisible();
    for (const member of [page, b.page]) {
      await overflow(member);
      await member.getByRole("navigation", { name: "Your Veya" }).getByRole("link", { name: /Notifications/ }).click();
      await expect(member.getByRole("link", { name: "Your plan is ready", exact: true })).toBeVisible();
      await expect(member.getByRole("link", { name: "New message", exact: true })).toBeVisible();
      const before = await api<{ unreadCount: number }>(member, "/api/notifications/unread");
      expect(before.unreadCount).toBeGreaterThan(0);
      const readResponse = member.waitForResponse(response => /\/api\/notifications\/[A-Za-z0-9_-]{24}\/read$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
      await member.getByRole("button", { name: "Mark as read", exact: true }).first().click();
      expect((await readResponse).status()).toBe(200);
      expect((await api<{ unreadCount: number }>(member, "/api/notifications/unread")).unreadCount).toBe(before.unreadCount - 1);
      await member.getByRole("link", { name: "Your plan is ready", exact: true }).click();
      await expect(member).toHaveURL(new RegExp(`/m/${key}$`));
      await overflow(member);
    }
    await page.screenshot({ path: info.outputPath("beta-chat.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([b.context.close(), incompatible.context.close()]);
  }
});

test("cookie loss recovers the real conversation, then typed profile deletion erases own content and disables keys", async ({ page, context, browser }, info) => {
  test.setTimeout(120_000);
  const b = await actor(browser, info), probe = await actor(browser, info);
  const errors: string[] = [];
  for (const member of [page, b.page, probe.page]) member.on("pageerror", error => errors.push(error.message));
  const city = `Beta deletion ${info.project.name} ${Date.now()}`;
  try {
    const oldKey = await createProfile(page, "Удаляемый профиль");
    const date = await dateTomorrow(page);
    const post = await createPost(page, city, date);
    await createProfile(b.page, "Остающийся профиль");
    await createPost(b.page, city, date);
    const key = await connect(page, b.page, post);
    const path = `/api/social/matches/${key}`;
    const ownText = "Удалить моё личное сообщение";
    const peerText = "Моя собственная история остаётся";
    await send(page, ownText);
    await expect(b.page.getByRole("list", { name: "Conversation messages" })).toContainText(ownText);
    await send(b.page, peerText);
    await expect(page.getByRole("list", { name: "Conversation messages" })).toContainText(peerText);
    await page.getByLabel("Disclosure value", { exact: true }).fill("Личное имя");
    await page.getByLabel("I understand and consent", { exact: true }).check();
    await page.getByRole("button", { name: "Share disclosure", exact: true }).click();
    await expect(b.page.getByText(/First name: Личное имя/)).toBeVisible();

    await context.clearCookies();
    await page.goto("/discover");
    await expect(page.getByRole("heading", { name: "Choose how you appear", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Recover with a Veya Key", exact: true }).click();
    await page.getByLabel("Recovery key", { exact: true }).fill(oldKey);
    const recovered = responseFor(page, "/api/social/profile/recover");
    await page.getByRole("button", { name: "Recover profile", exact: true }).click();
    const response = await recovered;
    expect(response.status()).toBe(200);
    const recovery = await response.json() as { profile: Profile; recoveryKey: string };
    expect(recovery.profile.alias).toBe("Удаляемый профиль");
    expect(recovery.recoveryKey).not.toBe(oldKey);
    await expect(page.getByLabel("Veya Key", { exact: true })).toHaveValue(recovery.recoveryKey);
    await page.getByRole("button", { name: "I saved my key", exact: true }).click();
    await page.goto(`/m/${key}`);
    await expect(page.getByRole("list", { name: "Conversation messages" })).toContainText(ownText);
    await expect(page.getByRole("list", { name: "Conversation messages" })).toContainText(peerText);
    await page.goto("/discover");
    await page.getByRole("button", { name: "Delete Veya profile", exact: true }).click();
    const confirm = page.getByRole("button", { name: "Permanently delete profile", exact: true });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Type DELETE to confirm", { exact: true }).fill("delete");
    await expect(confirm).toBeDisabled();
    await page.getByRole("button", { name: "Cancel deletion", exact: true }).click();
    expect((await api<{ profile: Profile }>(page, "/api/social/profile")).profile.alias).toBe("Удаляемый профиль");
    await page.getByRole("button", { name: "Delete Veya profile", exact: true }).click();
    await page.getByLabel("Type DELETE to confirm", { exact: true }).fill("DELETE");
    await expect(confirm).toBeEnabled();
    const deleted = responseFor(page, "/api/social/profile", "DELETE");
    await confirm.click();
    const result = await deleted;
    expect(result.status()).toBe(200);
    expect(await result.json()).toEqual({ deleted: true });
    await expect(page.getByRole("status").filter({ hasText: "Your social profile was deleted." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose how you appear", exact: true })).toBeVisible();
    await expect(page.getByLabel("Your active activity")).toHaveCount(0);
    await expect(page.getByLabel("Veya Key", { exact: true })).toHaveCount(0);
    expect((await api<{ profile: Profile | null }>(page, "/api/social/profile")).profile).toBeNull();
    await api(page, "/api/social/seeking", "GET", undefined, 404);
    await api(page, path, "GET", undefined, 404);
    await b.page.reload();
    await expect(b.page.getByText("This conversation is closed. You can read its history.")).toBeVisible();
    await expect(b.page.getByRole("button", { name: "Send message", exact: true })).toHaveCount(0);
    await expect(b.page.getByRole("list", { name: "Conversation messages" })).toContainText(peerText);
    await expect(b.page.getByRole("list", { name: "Conversation messages" })).not.toContainText(ownText);
    await expect(b.page.locator(".social-shell")).not.toContainText("Личное имя");
    const retained = await api<Match>(b.page, path);
    expect(retained).toMatchObject({ status: "closed", planSlug: null, disclosures: [] });
    expect(retained.identity.alias).toMatch(/deleted/i);
    expect((await api<{ messages: Message[] }>(b.page, `${path}/messages`)).messages.map(message => message.text)).toEqual([peerText]);
    await api(b.page, `${path}/messages`, "POST", { text: "Bypass deleted contact" }, 409);
    expect((await api<{ profile: Profile }>(b.page, "/api/social/profile")).profile.alias).toBe("Остающийся профиль");
    await probe.page.goto("/discover");
    await probe.page.getByRole("button", { name: "Recover with a Veya Key", exact: true }).click();
    for (const invalid of [oldKey, recovery.recoveryKey]) {
      await probe.page.getByLabel("Recovery key", { exact: true }).fill(invalid);
      const rejected = responseFor(probe.page, "/api/social/profile/recover");
      await probe.page.getByRole("button", { name: "Recover profile", exact: true }).click();
      expect((await rejected).status()).toBe(404);
      await expect(probe.page.getByRole("alert").filter({ hasText: "This Veya Key is invalid or no longer active." })).toBeVisible();
    }
    expect((await api<{ profile: Profile | null }>(probe.page, "/api/social/profile")).profile).toBeNull();
    await overflow(page);
    await overflow(b.page);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([b.context.close(), probe.context.close()]);
  }
});

test("one incognito profile has independent persistent identities in two UI-created pairs", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const b = await actor(browser, info), c = await actor(browser, info);
  const errors: string[] = [];
  for (const member of [page, b.page, c.page]) member.on("pageerror", error => errors.push(error.message));
  const city = `Beta pairs ${info.project.name} ${Date.now()}`;
  const aliases = ["Скрытый общий профиль", "Скрытый собеседник Б", "Скрытый собеседник В"];
  try {
    await createProfile(page, aliases[0]!);
    const date = await dateTomorrow(page);
    const post = await createPost(page, city, date);
    await createProfile(b.page, aliases[1]!);
    const bPost = await createPost(b.page, city, date);
    const first = await discover(page, post, 1);
    const repeat = await discover(page, post, 1);
    expect(repeat).toEqual(first);
    const ab = await connect(page, b.page, post);
    const firstMatch = await api<Match>(page, `/api/social/matches/${ab}`);
    const bMatch = await api<Match>(b.page, `/api/social/matches/${ab}`);
    expect(firstMatch.ownIdentity).toEqual(bMatch.identity);
    expect(firstMatch.identity).toEqual(bMatch.ownIdentity);
    await createProfile(c.page, aliases[2]!);
    const cPost = await createPost(c.page, city, date);
    const ac = await connect(page, c.page, post);
    expect(ac).not.toBe(ab);
    const secondMatch = await api<Match>(page, `/api/social/matches/${ac}`);
    const cMatch = await api<Match>(c.page, `/api/social/matches/${ac}`);
    expect(secondMatch.ownIdentity).toEqual(cMatch.identity);
    expect(secondMatch.identity).toEqual(cMatch.ownIdentity);
    expect(firstMatch.ownIdentity.alias).not.toBe(secondMatch.ownIdentity.alias);
    expect(firstMatch.ownIdentity.avatarSeed).not.toBe(secondMatch.ownIdentity.avatarSeed);
    for (const value of [first, firstMatch, bMatch, secondMatch, cMatch]) pairProjection(value, [...aliases, city, idea, post.publicKey, bPost.publicKey, cPost.publicKey]);
    await send(page, "Только для пары с В");
    await expect(c.page.getByRole("list", { name: "Conversation messages" })).toContainText("Только для пары с В");
    await expect(b.page.getByRole("list", { name: "Conversation messages" })).not.toContainText("Только для пары с В");
    await api(b.page, `/api/social/matches/${ac}`, "GET", undefined, 404);
    await api(c.page, `/api/social/matches/${ab}/messages`, "GET", undefined, 404);
    await page.goto(`/m/${ab}`);
    await page.reload();
    expect((await api<Match>(page, `/api/social/matches/${ab}`)).ownIdentity).toEqual(firstMatch.ownIdentity);
    await expect(page.getByRole("list", { name: "Conversation messages" })).not.toContainText("Только для пары с В");
    for (const member of [page, b.page, c.page]) await overflow(member);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([b.context.close(), c.context.close()]);
  }
});
