import { devices, expect, test, type Browser, type Page, type TestInfo } from "../support/browser-test";
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
  await page.getByText("Указать другое время", { exact: true }).click();
  await page.getByLabel("Дата", { exact: true }).fill(date);
  await page.getByLabel("Время начала", { exact: true }).fill("18:00");
  await page.getByLabel("Время окончания", { exact: true }).fill("20:00");
  await page.getByRole("button", { name: "Добавить время", exact: true }).click();
  await expect(page.getByRole("list", { name: "Выбранное свободное время" }).getByRole("listitem")).toHaveCount(1);
}

async function createProfile(page: Page, alias: string, copyAndNavigate = false) {
  await page.goto("/plan");
  await page.getByRole("textbox", { name: "Чем хотите заняться?", exact: true }).fill(idea);
  await page.getByRole("button", { name: "Найти людей", exact: true }).click();
  await expect(page).toHaveURL(/\/seek\/new$/);
  await page.getByLabel("Псевдоним", { exact: true }).fill(alias);
  await page.getByRole("combobox", { name: "Приватность", exact: true }).selectOption("INCOGNITO");
  await page.getByLabel("Языки профиля (необязательно)").fill("ru");
  await page.getByLabel("Мне исполнилось 18 лет").check();
  const created = responseFor(page, "/api/social/profile");
  await page.getByRole("button", { name: "Создать профиль", exact: true }).click();
  expect((await created).status()).toBe(201);
  const keyField = page.getByLabel("Ключ Intavro", { exact: true });
  await expect(keyField).toBeVisible();
  const key = await keyField.inputValue();
  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  if (copyAndNavigate) {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await page.getByRole("button", { name: "Скопировать Ключ Intavro", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Ключ скопирован." })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
    // Copying is not acknowledgement; the memory-only banner survives SPA routes.
    await expect(keyField).toHaveValue(key);
    await page.getByRole("navigation", { name: "Навигация Intavro" }).getByRole("link", { name: "Найти людей", exact: true }).click();
    await expect(keyField).toHaveValue(key);
    await overflow(page);
    await page.getByRole("navigation", { name: "Навигация Intavro" }).getByRole("link", { name: "Новое занятие", exact: true }).click();
    await expect(keyField).toHaveValue(key);
  }
  expect(await page.evaluate(key => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(key), key)).toBe(false);
  await page.getByRole("button", { name: "Ключ сохранён", exact: true }).click();
  await expect(keyField).toHaveCount(0);
  await overflow(page);
  return key;
}

async function createPost(page: Page, city: string, date: string, activity = "chess", reviewRussian = false) {
  if (!page.url().endsWith("/seek/new")) await page.goto("/seek/new");
  const raw = page.getByRole("textbox", { name: "Чем хотите заняться?", exact: true });
  await raw.fill(activity === "chess" ? idea : "Хочу поиграть в футбол завтра");
  if (reviewRussian) {
    await expect(page.getByLabel("Код занятия", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Помочь с заполнением", exact: true }).click();
    await expect(page.getByRole("region", { name: "Проверка предложения", exact: true })).toContainText("chess");
    await expect(page.getByLabel("Код занятия", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Применить проверенное предложение", exact: true }).click();
    await expect(page.getByLabel("Код занятия", { exact: true })).toHaveValue("chess");
  }
  await page.getByLabel("Код занятия", { exact: true }).fill(activity);
  await page.getByLabel("Название занятия", { exact: true }).fill(activity === "chess" ? "Шахматы" : "Футбол");
  await page.getByLabel("Город", { exact: true }).fill(city);
  await page.getByLabel("Языки", { exact: true }).fill("ru");
  await time(page, date);
  await overflow(page);
  const saved = responseFor(page, "/api/social/seeking");
  await page.getByRole("button", { name: "Создать заявку на занятие", exact: true }).click();
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
  await page.getByLabel("Ваша активная заявка").selectOption(post.publicKey);
  const response = responseFor(page, "/api/social/discover", "GET");
  await page.getByRole("button", { name: "Найти людей", exact: true }).click();
  const cards = (await (await response).json() as { cards: Card[] }).cards;
  expect(cards).toHaveLength(count);
  await expect(page.getByRole("region", { name: "Подходящие люди", exact: true }).getByRole("article")).toHaveCount(count);
  return cards;
}

async function connect(a: Page, b: Page, post: OwnPost) {
  await b.goto("/connections");
  await expect(b.getByRole("heading", { name: "Запросы", exact: true })).toBeVisible();
  const cards = await discover(a, post, 1);
  const requested = responseFor(a, "/api/social/connections");
  await a.getByRole("region", { name: "Подходящие люди", exact: true }).getByRole("button", { name: "Хочу присоединиться", exact: true }).click();
  const request = await (await requested).json() as Connection;
  await expect(a.getByRole("status").filter({ hasText: "Запрос отправлен." })).toBeVisible();
  await a.getByRole("link", { name: "Посмотреть запросы", exact: true }).click();
  // The recipient remains open throughout Interested, and the sender during Accept.
  const incoming = b.getByRole("region", { name: "Входящие запросы", exact: true });
  await expect(incoming.getByRole("button", { name: "Принять", exact: true })).toBeVisible();
  const accepted = responseFor(b, `/api/social/connections/${request.publicKey}/respond`);
  await incoming.getByRole("button", { name: "Принять", exact: true }).click();
  const matchKey = (await (await accepted).json() as Connection).matchKey!;
  expect(matchKey).toMatch(/^[A-Za-z0-9_-]{24}$/);
  await expect(a.getByRole("link", { name: "Открыть чат", exact: true }).last()).toBeVisible();
  for (const member of [a, b]) {
    await member.locator(`a[href="/m/${matchKey}"]`).click();
    await expect(member.getByLabel("Сообщение", { exact: true })).toBeVisible();
    await overflow(member);
  }
  const match = await api<Match>(a, `/api/social/matches/${matchKey}`);
  expect(match.identity).toEqual(cards[0]!.identity);
  return matchKey;
}

async function send(page: Page, text: string) {
  await page.getByLabel("Сообщение", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
  await expect(page.getByRole("list", { name: "Сообщения чата" })).toContainText(text);
}

async function join(page: Page, creator: boolean, name: string, date: string) {
  await page.getByRole("button", { name: creator ? "Указать свободное время" : "Присоединиться", exact: true }).click();
  await page.getByLabel("Ваше имя", { exact: true }).fill(name);
  await expect(page.getByRole("list", { name: "Выбранное свободное время" }).getByRole("listitem")).toHaveCount(0);
  await time(page, date);
  await page.getByRole("button", { name: "Присоединиться к встрече", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Вы с нами, ${name}.`, exact: true })).toBeVisible();
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
    await expect(b.page.getByRole("list", { name: "Сообщения чата" })).toContainText("Сыграем завтра в общественном месте?");
    await send(b.page, "Да, давай выберем время.");
    await expect(page.getByRole("list", { name: "Сообщения чата" })).toContainText("Да, давай выберем время.");
    const match = await api<Match>(page, matchPath);
    pairProjection(match, ["Скрытый первый", "Скрытый второй", "Несовместимый третий", city, idea]);
    expect(match.disclosures).toEqual([]);
    await page.getByRole("button", { name: "Организовать встречу", exact: true }).click();
    await expect(page.getByRole("button", { name: "Создать план", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Создать план", exact: true }).click();
    await expect(b.page.getByRole("link", { name: "Открыть план", exact: true })).toBeVisible();
    const linked = await api<Match>(page, matchPath);
    expect(linked.planSlug).toBeTruthy();
    expect((await api<Match>(b.page, matchPath)).planSlug).toBe(linked.planSlug);
    const slug = linked.planSlug!;
    const initial = await api<{ isCreator: boolean; ownParticipant: unknown; intent: { participantCount: number } }>(page, `/api/intents/${slug}`);
    expect(initial).toMatchObject({ isCreator: true, ownParticipant: null, intent: { participantCount: 0 } });
    await page.getByRole("link", { name: "Открыть план", exact: true }).click();
    await join(page, true, "Первый игрок", date);
    await b.page.getByRole("link", { name: "Открыть план", exact: true }).click();
    await join(b.page, false, "Второй игрок", date);
    for (const member of [page, b.page]) {
      await member.getByRole("link", { name: "Найти общее время", exact: true }).click();
      const best = member.getByRole("region", { name: "Лучший вариант", exact: true });
      await expect(best).toContainText("2 из 2");
      await expect(best.getByRole("list", { name: "Свободное время участников" })).toContainText("Первый игрок");
      await expect(best.getByRole("list", { name: "Свободное время участников" })).toContainText("Второй игрок");
      await best.getByRole("button", { name: "ДА", exact: true }).click();
      await expect(best.getByRole("button", { name: "ДА", exact: true })).toHaveAttribute("aria-pressed", "true");
      await overflow(member);
    }
    await expect(b.page.getByRole("button", { name: "Выбрать этот план", exact: true })).toHaveCount(0);
    await page.reload();
    const best = page.getByRole("region", { name: "Лучший вариант", exact: true });
    await expect(best.getByLabel("Голоса участников")).toContainText("ДА 2");
    await best.getByRole("button", { name: "Выбрать этот план", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Подтвердить этот вариант для всех?", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Встреча запланирована.", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Подтвердить план", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Встреча запланирована.", exact: true })).toBeVisible();
    await b.page.getByRole("button", { name: "Обновить результаты", exact: true }).click();
    await expect(b.page.getByRole("heading", { name: "Встреча запланирована.", exact: true })).toBeVisible();
    for (const member of [page, b.page]) {
      await overflow(member);
      await member.getByRole("navigation", { name: "Ваш Intavro" }).getByRole("link", { name: /Уведомления/ }).click();
      await expect(member.getByRole("link", { name: "Ваш план готов", exact: true })).toBeVisible();
      await expect(member.getByRole("link", { name: "Новое сообщение", exact: true })).toBeVisible();
      const before = await api<{ unreadCount: number }>(member, "/api/notifications/unread");
      expect(before.unreadCount).toBeGreaterThan(0);
      const readResponse = member.waitForResponse(response => /\/api\/notifications\/[A-Za-z0-9_-]{24}\/read$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
      await member.getByRole("button", { name: "Отметить как прочитанное", exact: true }).first().click();
      expect((await readResponse).status()).toBe(200);
      expect((await api<{ unreadCount: number }>(member, "/api/notifications/unread")).unreadCount).toBe(before.unreadCount - 1);
      await member.getByRole("link", { name: "Ваш план готов", exact: true }).click();
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
    await expect(b.page.getByRole("list", { name: "Сообщения чата" })).toContainText(ownText);
    await send(b.page, peerText);
    await expect(page.getByRole("list", { name: "Сообщения чата" })).toContainText(peerText);
    await page.getByLabel("Сведения для передачи", { exact: true }).fill("Личное имя");
    await page.getByLabel("Я понимаю и даю согласие", { exact: true }).check();
    await page.getByRole("button", { name: "Поделиться сведениями", exact: true }).click();
    await expect(b.page.getByText(/Имя: Личное имя/)).toBeVisible();

    await context.clearCookies();
    await page.goto("/discover");
    await expect(page.getByRole("heading", { name: "Выберите, как вас будут видеть", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Восстановить с помощью Ключа Intavro", exact: true }).click();
    await page.getByLabel("Ключ восстановления", { exact: true }).fill(oldKey);
    const recovered = responseFor(page, "/api/social/profile/recover");
    await page.getByRole("button", { name: "Восстановить профиль", exact: true }).click();
    const response = await recovered;
    expect(response.status()).toBe(200);
    const recovery = await response.json() as { profile: Profile; recoveryKey: string };
    expect(recovery.profile.alias).toBe("Удаляемый профиль");
    expect(recovery.recoveryKey).not.toBe(oldKey);
    await expect(page.getByLabel("Ключ Intavro", { exact: true })).toHaveValue(recovery.recoveryKey);
    await page.getByRole("button", { name: "Ключ сохранён", exact: true }).click();
    await page.goto(`/m/${key}`);
    await expect(page.getByRole("list", { name: "Сообщения чата" })).toContainText(ownText);
    await expect(page.getByRole("list", { name: "Сообщения чата" })).toContainText(peerText);
    await page.goto("/discover");
    await page.getByRole("button", { name: "Удалить профиль Intavro", exact: true }).click();
    const confirm = page.getByRole("button", { name: "Удалить профиль навсегда", exact: true });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Введите DELETE для подтверждения", { exact: true }).fill("delete");
    await expect(confirm).toBeDisabled();
    await page.getByRole("button", { name: "Отменить удаление", exact: true }).click();
    expect((await api<{ profile: Profile }>(page, "/api/social/profile")).profile.alias).toBe("Удаляемый профиль");
    await page.getByRole("button", { name: "Удалить профиль Intavro", exact: true }).click();
    await page.getByLabel("Введите DELETE для подтверждения", { exact: true }).fill("DELETE");
    await expect(confirm).toBeEnabled();
    const deleted = responseFor(page, "/api/social/profile", "DELETE");
    await confirm.click();
    const result = await deleted;
    expect(result.status()).toBe(200);
    expect(await result.json()).toEqual({ deleted: true });
    await expect(page.getByRole("status").filter({ hasText: "Ваш профиль Intavro удалён." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Выберите, как вас будут видеть", exact: true })).toBeVisible();
    await expect(page.getByLabel("Ваша активная заявка")).toHaveCount(0);
    await expect(page.getByLabel("Ключ Intavro", { exact: true })).toHaveCount(0);
    expect((await api<{ profile: Profile | null }>(page, "/api/social/profile")).profile).toBeNull();
    await api(page, "/api/social/seeking", "GET", undefined, 404);
    await api(page, path, "GET", undefined, 404);
    await b.page.reload();
    await expect(b.page.getByText("Этот чат закрыт. Вы можете читать историю сообщений.")).toBeVisible();
    await expect(b.page.getByRole("button", { name: "Отправить сообщение", exact: true })).toHaveCount(0);
    await expect(b.page.getByRole("list", { name: "Сообщения чата" })).toContainText(peerText);
    await expect(b.page.getByRole("list", { name: "Сообщения чата" })).not.toContainText(ownText);
    await expect(b.page.locator(".social-shell")).not.toContainText("Личное имя");
    const retained = await api<Match>(b.page, path);
    expect(retained).toMatchObject({ status: "closed", planSlug: null, disclosures: [] });
    expect(retained.identity.alias).toMatch(/удалён/i);
    expect((await api<{ messages: Message[] }>(b.page, `${path}/messages`)).messages.map(message => message.text)).toEqual([peerText]);
    await api(b.page, `${path}/messages`, "POST", { text: "Bypass deleted contact" }, 409);
    expect((await api<{ profile: Profile }>(b.page, "/api/social/profile")).profile.alias).toBe("Остающийся профиль");
    await probe.page.goto("/discover");
    await probe.page.getByRole("button", { name: "Восстановить с помощью Ключа Intavro", exact: true }).click();
    for (const invalid of [oldKey, recovery.recoveryKey]) {
      await probe.page.getByLabel("Ключ восстановления", { exact: true }).fill(invalid);
      const rejected = responseFor(probe.page, "/api/social/profile/recover");
      await probe.page.getByRole("button", { name: "Восстановить профиль", exact: true }).click();
      expect((await rejected).status()).toBe(404);
      await expect(probe.page.getByRole("alert").filter({ hasText: "Этот Ключ Intavro недействителен или больше не активен." })).toBeVisible();
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
    await expect(c.page.getByRole("list", { name: "Сообщения чата" })).toContainText("Только для пары с В");
    await expect(b.page.getByRole("list", { name: "Сообщения чата" })).not.toContainText("Только для пары с В");
    await api(b.page, `/api/social/matches/${ac}`, "GET", undefined, 404);
    await api(c.page, `/api/social/matches/${ab}/messages`, "GET", undefined, 404);
    await page.goto(`/m/${ab}`);
    await page.reload();
    expect((await api<Match>(page, `/api/social/matches/${ab}`)).ownIdentity).toEqual(firstMatch.ownIdentity);
    await expect(page.getByRole("list", { name: "Сообщения чата" })).not.toContainText("Только для пары с В");
    for (const member of [page, b.page, c.page]) await overflow(member);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([b.context.close(), c.context.close()]);
  }
});
