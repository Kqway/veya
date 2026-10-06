import {
  devices,
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from "../support/browser-test";
import type { Customization, ProfileSpace } from "../../src/features/profile-space/schema";
import type { Card, Connection, OwnPost, PrivacyMode, SeekingInput } from "../../src/features/social/client";
import { fetchAuditedResponse } from "../support/audited-response";

const origin = "http://127.0.0.1:3100";
const worlds = [
  ["minimal", "Минимализм"], ["midnight", "Полночь"], ["glass", "Стекло"],
  ["cozy", "Уют"], ["cyber", "Кибер"], ["manga", "Манга"],
  ["y2k", "Нулевые"], ["monochrome", "Монохром"],
] as const;
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

function safeProjection(value: unknown, self = false) {
  if (typeof value === "string") {
    expect(value).not.toMatch(uuid);
    expect(value).not.toMatch(/^[a-f0-9]{64}$/i);
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    expect(key).not.toMatch(/^(?:id|.*(?:profile|guest|sender|recipient|session|post|pair|conversation)[_-]?id|.*hash|token.*|session.*|email|ip|fingerprint)$/i);
    if (!self) {
      expect(key).not.toMatch(/^(?:customization|intentOptions|activityOptions|rawText|city|area|availability|startAt|endAt|windows|notes|contact.*|ageBand|skill|languages|tags|desiredAgeBands|score|recovery.*)$/i);
    }
    safeProjection(child, self);
  }
}

// Inspect actual context-profile responses before releasing them to the UI.
// The interceptor never substitutes fixtures and never retries a mutation.
async function audit(page: Page, hidden: string[] = []) {
  const errors: string[] = [];
  const pending: Promise<void>[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/social/profiles/**", async route => {
    const work = (async () => {
      const response = await fetchAuditedResponse(route);
      const body: unknown = await response.json();
      safeProjection(body);
      expect(response.headers()["cache-control"]).toContain("no-store");
      for (const value of hidden) expect(JSON.stringify(body)).not.toContain(value);
      await route.fulfill({ response });
    })().catch(async (error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
      await route.abort().catch(() => {});
    });
    pending.push(work);
    await work;
  });
  return async () => {
    await Promise.all(pending);
    expect(errors).toEqual([]);
  };
}

async function peer(browser: Browser, info: TestInfo) {
  const context = await browser.newContext({
    ...(info.project.name === "mobile" ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } }),
    baseURL: origin,
    timezoneId: "Europe/Moscow",
    locale: "ru-RU",
  });
  return { context, page: await context.newPage() };
}

async function api<T>(page: Page, path: string, method = "GET", body?: unknown, status = 200): Promise<T> {
  if (!page.url().startsWith(origin)) await page.goto("/");
  const response = await page.evaluate(async ({ path, method, body }) => {
    const result = await fetch(path, {
      method, credentials: "same-origin", cache: "no-store",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    return { status: result.status, cache: result.headers.get("cache-control"), data: await result.json() };
  }, { path, method, body });
  expect(response.status, `${method} ${path}`).toBe(status);
  expect(response.cache).toContain("no-store");
  return response.data as T;
}

function responseFor(page: Page, path: string, method = "POST") {
  return page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
}

async function createProfile(page: Page, alias: string, mode: PrivacyMode = "OPEN") {
  await page.goto("/discover");
  await page.getByLabel("Псевдоним", { exact: true }).fill(alias);
  await page.getByRole("combobox", { name: "Приватность", exact: true }).selectOption(mode);
  await page.getByLabel("Языки профиля (необязательно)").fill("ru");
  await page.getByLabel("Мне исполнилось 18 лет").check();
  const created = responseFor(page, "/api/social/profile");
  await page.getByRole("button", { name: "Создать профиль", exact: true }).click();
  expect((await created).status()).toBe(201);
  const key = await page.getByLabel("Ключ Veya", { exact: true }).inputValue();
  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await page.getByRole("button", { name: "Ключ сохранён", exact: true }).click();
  await expect(page.getByLabel("Ключ Veya", { exact: true })).toHaveCount(0);
  return key;
}

function fixture(info: TestInfo, mode: PrivacyMode = "OPEN"): SeekingInput {
  const start = Date.now() + 2 * 86_400_000;
  return {
    rawText: "Личные заметки о занятии, не для профиля",
    activityKey: `space-${info.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    activityLabel: "Совместное рисование",
    interactionMode: "online", format: "one_to_one", city: null, area: null,
    availability: [{ startAt: new Date(start).toISOString(), endAt: new Date(start + 3_600_000).toISOString() }],
    skill: "any", languages: ["ru"], tags: [], desiredAgeBands: [], groupSize: null, privacyMode: mode,
  };
}

async function post(page: Page, input: SeekingInput) {
  // Persisted real posts isolate this journey from the shared discovery database.
  // Existing beta journeys separately cover the seeking form itself.
  return api<OwnPost>(page, "/api/social/seeking", "POST", input, 201);
}

async function overflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function settings(page: Page) {
  // Desktop displays both panels; its switch is visually clipped for keyboard
  // access. Playwright isVisible does not account for clip-path, so click only
  // the actual mobile switch, without bypassing native hit testing.
  if (await page.evaluate(() => matchMedia('(max-width: 800px)').matches))
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.locator('.profile-editor-settings')).toBeVisible();
}

async function preview(page: Page) {
  if (await page.evaluate(() => matchMedia('(max-width: 800px)').matches))
    await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
  return page.getByRole("region", { name: "Предпросмотр пространства", exact: true }).locator(".profile-scene");
}

async function save(page: Page) {
  await settings(page);
  const saved = responseFor(page, "/api/social/profile/space", "PATCH");
  await page.getByRole("button", { name: "Сохранить пространство", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Сохранено" })).toBeVisible();
}

async function edit(page: Page) {
  await page.goto("/network/profile");
  await page.getByRole("link", { name: "Настроить профиль", exact: true }).click();
  await expect(page).toHaveURL(/\/profile\/edit$/);
  await expect(page.getByLabel("Статус", { exact: true })).toBeVisible();
}

async function discover(page: Page, source: OwnPost, count = 1) {
  await page.goto("/discover");
  await page.getByLabel("Ваша активная заявка").selectOption(source.publicKey);
  const response = responseFor(page, "/api/social/discover", "GET");
  await page.getByRole("button", { name: "Найти людей", exact: true }).click();
  const cards = (await (await response).json() as { cards: Card[] }).cards;
  expect(cards).toHaveLength(count);
  await expect(page.getByRole("region", { name: "Подходящие люди", exact: true }).getByRole("article")).toHaveCount(count);
  return cards;
}

async function unavailable(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Профиль сейчас недоступен", exact: true })).toBeVisible();
  await expect(page.locator(".profile-scene")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Предложить что-нибудь", exact: true })).toHaveCount(0);
  await overflow(page);
}

async function contrast(scene: Locator) {
  const readings = await scene.evaluate(root => {
    type RGB = [number, number, number, number];
    const color = (value: string): RGB => {
      const values = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
    };
    const composite = (fg: RGB, bg: RGB): RGB => [
      fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]),
      fg[2] * fg[3] + bg[2] * (1 - fg[3]), 1,
    ];
    const luminance = (rgb: RGB) => rgb.slice(0, 3).map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
    return Array.from(root.querySelectorAll<HTMLElement>(".profile-alias,.profile-tagline,.profile-status,.profile-block h3,.profile-interests li,.profile-goals li")).map(element => {
      const style = getComputedStyle(element);
      const ancestors: HTMLElement[] = [];
      for (let current: HTMLElement | null = element; current; current = current.parentElement) ancestors.unshift(current);
      let background: RGB = [255, 255, 255, 1];
      for (const ancestor of ancestors) background = composite(color(getComputedStyle(ancestor).backgroundColor), background);
      const foreground = composite(color(style.color), background);
      const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700);
      return { text: element.textContent, ratio: (lighter! + 0.05) / (darker! + 0.05), minimum: large ? 3 : 4.5 };
    });
  });
  expect(readings.length).toBeGreaterThan(2);
  for (const reading of readings) expect(reading.ratio, `Text contrast: ${reading.text}`).toBeGreaterThanOrEqual(reading.minimum);
}

async function screenshot(scene: Locator, info: TestInfo, name: string) {
  await info.attach(name, { body: await scene.screenshot({ animations: "disabled" }), contentType: "image/png" });
}

test("eight live worlds persist the editor, genuine activity counts, and fit 320px with reduced motion", async ({ page }, info) => {
  test.setTimeout(120_000);
  const check = await audit(page);
  const alias = `Мир ${info.project.name}`;
  await createProfile(page, alias);
  const input = fixture(info);
  const first = await post(page, input);
  await post(page, input);
  await edit(page);
  await page.getByLabel("Статус", { exact: true }).fill("Открываю маленький мир");
  await page.getByLabel("Подпись", { exact: true }).fill("Вместе интереснее исследовать город");
  await page.getByLabel("Интересы — каждый с новой строки", { exact: true }).fill("Рисование\nПрогулки");
  await page.getByLabel("Цели — каждая с новой строки", { exact: true }).fill("Найти компанию для творчества");
  await page.getByLabel("Моя текущая заявка", { exact: true }).selectOption(first.publicKey);
  await page.getByLabel(`Занятие: ${input.activityLabel}`, { exact: true }).check();
  await page.getByRole("button", { name: "Интересы: выше", exact: true }).click();
  for (const [world, label] of worlds) {
    await settings(page);
    await page.getByRole("button", { name: label, exact: true }).click();
    const scene = await preview(page);
    await expect(scene).toHaveAttribute("data-world", world);
    await expect(scene.getByRole("heading", { name: alias, exact: true })).toBeVisible();
    await expect(scene).toContainText("2 заявки");
    await expect(scene).not.toContainText(/посещений|встреч проведено|участников/i);
    await contrast(scene);
    await overflow(page);
    await screenshot(scene, info, `${info.project.name}-${world}`);
  }
  await save(page);
  const saved = (await api<{ space: ProfileSpace }>(page, "/api/social/profile/space")).space;
  expect(saved.presentation.world).toBe("monochrome");
  expect(saved.activities).toEqual([{ activityKey: input.activityKey, activityLabel: input.activityLabel, count: 2 }]);
  expect(saved.blockOrder.indexOf("interests")).toBeLessThan(saved.blockOrder.indexOf("activities"));
  await page.reload();
  await expect(page.getByLabel("Подпись", { exact: true })).toHaveValue("Вместе интереснее исследовать город");
  await page.setViewportSize({ width: 320, height: 780 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [world, label] of worlds) {
    await settings(page);
    await page.getByRole("button", { name: label, exact: true }).click();
    const scene = await preview(page);
    await expect(scene).toHaveAttribute("data-world", world);
    await overflow(page);
    await contrast(scene);
    expect(await scene.evaluate(root => root.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
    await screenshot(scene, info, `320-reduced-motion-${info.project.name}-${world}`);
  }
  await settings(page);
  // Return to the saved world before navigating, exercising a clean editor exit.
  await page.getByRole("button", { name: "Монохром", exact: true }).click();
  await page.getByRole("link", { name: "Посмотреть свой профиль", exact: true }).click();
  await expect(page).toHaveURL(/\/network\/profile$/);
  await expect(page.locator(".profile-scene")).toContainText("2 заявки");
  await overflow(page);
  await check();
});

test("OPEN fields stay explicit from discovery to request and chat; outsider and blocked contexts are unavailable", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const owner = await peer(browser, info), outsider = await peer(browser, info);
  const hiddenStatus = "Секретный статус только для меня";
  const checkViewer = await audit(page, [hiddenStatus]), checkOwner = await audit(owner.page), checkOutsider = await audit(outsider.page);
  try {
    await createProfile(page, "Зритель открытого мира");
    const recoveryKey = await createProfile(owner.page, "Открытый мир автора");
    await createProfile(outsider.page, "Посторонний зритель");
    const input = fixture(info);
    const source = await post(page, input), target = await post(owner.page, input);
    await edit(owner.page);
    await owner.page.getByLabel("Статус", { exact: true }).fill(hiddenStatus);
    await owner.page.getByLabel("Подпись", { exact: true }).fill("Разрешённая подпись открытого мира");
    await owner.page.getByLabel("Интересы — каждый с новой строки", { exact: true }).fill("Акварель");
    await owner.page.getByLabel("Цели — каждая с новой строки", { exact: true }).fill("Цель после знакомства");
    await owner.page.getByLabel("Кому видна подпись", { exact: true }).selectOption("everyone");
    await owner.page.getByLabel("Кому виден блок: Интересы", { exact: true }).selectOption("everyone");
    await owner.page.getByLabel("Кому виден блок: Цели", { exact: true }).selectOption("connection");
    await owner.page.getByLabel("Моя текущая заявка", { exact: true }).selectOption(target.publicKey);
    await owner.page.getByRole("button", { name: "Уют", exact: true }).click();
    await save(owner.page);
    const [card] = await discover(page, source);
    const candidates = page.getByRole("region", { name: "Подходящие люди", exact: true });
    await expect(candidates.getByRole("button", { name: "Хочу присоединиться", exact: true })).toBeVisible();
    const discoveryPath = `/profile/discovery/${card!.handle}`;
    await expect(candidates.getByRole("link", { name: "Посмотреть профиль", exact: true })).toHaveAttribute("href", discoveryPath);
    await candidates.getByRole("link", { name: "Посмотреть профиль", exact: true }).click();
    const scene = page.locator(".profile-scene");
    await expect(scene).toHaveAttribute("data-world", "cozy");
    await expect(scene).toContainText("Разрешённая подпись открытого мира");
    await expect(scene).toContainText("Акварель");
    await expect(scene).not.toContainText(hiddenStatus);
    await expect(scene).not.toContainText("Цель после знакомства");
    const stranger = (await api<{ space: ProfileSpace }>(page, `/api/social/profiles/discovery/${card!.handle}`)).space;
    expect(stranger.audience).toBe("stranger");
    expect(stranger.action).toEqual({ kind: "interest", key: card!.handle });
    const foreign = await api(outsider.page, `/api/social/profiles/discovery/${card!.handle}`, "GET", undefined, 404);
    const invalid = await api(outsider.page, `/api/social/profiles/discovery/${"A".repeat(24)}`, "GET", undefined, 404);
    expect(foreign).toEqual(invalid);
    await unavailable(outsider.page, discoveryPath);
    const requested = responseFor(page, "/api/social/connections");
    await page.getByRole("button", { name: "Предложить что-нибудь", exact: true }).click();
    const request = await (await requested).json() as Connection;
    await expect(page.getByRole("button", { name: "Предложить что-нибудь", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Посмотреть запрос", exact: true })).toBeVisible();
    await page.goto(`/profile/connection/${request.publicKey}`);
    const pending = (await api<{ space: ProfileSpace }>(page, `/api/social/profiles/connection/${request.publicKey}`)).space;
    expect(pending.audience).toBe("stranger");
    expect(pending.goals).toEqual([]);
    expect(pending.action.kind).toBe("connections");
    await expect(page.getByRole("button", { name: "Предложить что-нибудь", exact: true })).toHaveCount(0);
    await api(outsider.page, `/api/social/profiles/connection/${request.publicKey}`, "GET", undefined, 404);
    await owner.page.goto("/network/connections");
    const accepted = responseFor(owner.page, `/api/social/connections/${request.publicKey}/respond`);
    await owner.page.getByRole("region", { name: "Входящие запросы", exact: true }).getByRole("button", { name: "Принять", exact: true }).click();
    const matchKey = ((await (await accepted).json()) as Connection).matchKey!;
    await page.goto(`/profile/match/${matchKey}`);
    const connected = (await api<{ space: ProfileSpace }>(page, `/api/social/profiles/match/${matchKey}`)).space;
    expect(connected.audience).toBe("connection");
    expect(connected.action).toEqual({ kind: "chat", key: matchKey });
    const acceptedRequest = (await api<{ space: ProfileSpace }>(page, `/api/social/profiles/connection/${request.publicKey}`)).space;
    expect(acceptedRequest.action).toEqual({ kind: "chat", key: matchKey });
    await expect(page.locator(".profile-scene")).toContainText("Цель после знакомства");
    await expect(page.locator(".profile-scene")).not.toContainText(hiddenStatus);
    await expect(page.getByRole("link", { name: "Открыть чат", exact: true })).toHaveAttribute("href", `/m/${matchKey}`);
    await api(outsider.page, `/api/social/profiles/match/${matchKey}`, "GET", undefined, 404);
    await unavailable(outsider.page, `/profile/match/${matchKey}`);
    await page.getByRole("link", { name: "Открыть чат", exact: true }).click();
    await expect(page.getByLabel("Сообщение", { exact: true })).toBeVisible();
    await page.getByLabel("Сообщение", { exact: true }).fill("Давайте рисовать вместе");
    await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await expect(page.getByRole("list", { name: "Сообщения чата" })).toContainText("Давайте рисовать вместе");
    // Recovery preserves customization while rotating the one-time key.
    await owner.context.clearCookies();
    await owner.page.goto("/discover");
    await owner.page.getByRole("button", { name: "Восстановить с помощью Ключа Veya", exact: true }).click();
    await owner.page.getByLabel("Ключ восстановления", { exact: true }).fill(recoveryKey);
    await owner.page.getByRole("button", { name: "Восстановить профиль", exact: true }).click();
    await expect(owner.page.getByLabel("Ключ Veya", { exact: true })).toBeVisible();
    await owner.page.getByRole("button", { name: "Ключ сохранён", exact: true }).click();
    await owner.page.goto("/network/profile");
    await expect(owner.page.locator(".profile-scene")).toHaveAttribute("data-world", "cozy");
    await expect(owner.page.locator(".profile-scene")).toContainText(hiddenStatus);
    await page.getByRole("button", { name: "Заблокировать", exact: true }).click();
    const blocked = responseFor(page, "/api/social/block");
    await page.getByRole("button", { name: "Подтвердить блокировку", exact: true }).click();
    expect((await blocked).status()).toBe(200);
    await expect(page.getByText("Этот чат закрыт. Вы можете читать историю сообщений.", { exact: true })).toBeVisible();
    await api(page, `/api/social/profiles/match/${matchKey}`, "GET", undefined, 404);
    await api(owner.page, `/api/social/profiles/match/${matchKey}`, "GET", undefined, 404);
    await unavailable(page, `/profile/match/${matchKey}`);
    await unavailable(page, `/profile/connection/${request.publicKey}`);
    await unavailable(page, discoveryPath);
    // Deletion makes the former viewer's context remain generically unavailable.
    await owner.page.goto("/discover");
    await owner.page.getByRole("button", { name: "Удалить профиль Veya", exact: true }).click();
    await owner.page.getByLabel("Введите DELETE для подтверждения", { exact: true }).fill("DELETE");
    const deleted = responseFor(owner.page, "/api/social/profile", "DELETE");
    await owner.page.getByRole("button", { name: "Удалить профиль навсегда", exact: true }).click();
    expect((await deleted).status()).toBe(200);
    await unavailable(page, `/profile/match/${matchKey}`);
    await Promise.all([checkViewer(), checkOwner(), checkOutsider()]);
  } finally {
    await Promise.all([owner.context.close(), outsider.context.close()]);
  }
});

test("an INCOGNITO post hides an OPEN owner's global world independently for two viewers, including matches", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const first = await peer(browser, info), second = await peer(browser, info);
  const globalText = ["Общий статус для проверки", "Узнаваемая глобальная подпись", "Секретный глобальный интерес", "Глобальная цель автора"];
  const alias = "Глобальный автор скрытой заявки";
  const checkOwner = await audit(page), checkFirst = await audit(first.page, [...globalText, alias]), checkSecond = await audit(second.page, [...globalText, alias]);
  try {
    await createProfile(page, alias, "OPEN");
    const input = fixture(info, "INCOGNITO");
    const target = await post(page, input);
    const own = (await api<{ space: ProfileSpace }>(page, "/api/social/profile/space")).space;
    const customization: Customization = {
      ...own.customization!, world: "cyber", accent: "violet", avatar: "spark",
      status: globalText[0]!, tagline: globalText[1]!, interests: [globalText[2]!], goals: [globalText[3]!],
      selectedActivities: [input.activityKey], intentPostKey: target.publicKey,
      visibility: { status: "everyone", tagline: "everyone", interests: "everyone", goals: "everyone", activities: "everyone", intent: "everyone" },
    };
    await api(page, "/api/social/profile/space", "PATCH", customization);
    const identities: ProfileSpace["identity"][] = [];
    const matchKeys: string[] = [];
    for (const [index, viewer] of [first, second].entries()) {
      await createProfile(viewer.page, `Зритель скрытого мира ${index + 1}`, "OPEN");
      const source = await post(viewer.page, { ...input, privacyMode: "OPEN" });
      const cards = await discover(viewer.page, source, index + 1);
      // The first viewer's OPEN post is also compatible on the second pass.
      // The hidden owner's pair identity differs from that permitted OPEN alias.
      const selected = cards.find(candidate => candidate.identity.alias !== "Зритель скрытого мира 1");
      expect(selected).toBeDefined();
      await viewer.page.locator(`a[href="/profile/discovery/${selected!.handle}"]`).click();
      const stranger = (await api<{ space: ProfileSpace }>(viewer.page, `/api/social/profiles/discovery/${selected!.handle}`)).space;
      identities.push(stranger.identity);
      expect(stranger.identity.alias).not.toBe(alias);
      expect(stranger.status).toBeNull(); expect(stranger.tagline).toBeNull();
      expect(stranger.activities).toEqual([]); expect(stranger.interests).toEqual([]); expect(stranger.goals).toEqual([]);
      expect(stranger.currentIntent?.activityLabel).toBe(input.activityLabel);
      const scene = viewer.page.locator(".profile-scene");
      for (const value of globalText) await expect(scene).not.toContainText(value);
      const requested = responseFor(viewer.page, "/api/social/connections");
      await viewer.page.getByRole("button", { name: "Предложить что-нибудь", exact: true }).click();
      const request = await (await requested).json() as Connection;
      await page.goto("/network/connections");
      const accepted = responseFor(page, `/api/social/connections/${request.publicKey}/respond`);
      await page.getByRole("region", { name: "Входящие запросы", exact: true }).getByRole("button", { name: "Принять", exact: true }).click();
      const matchKey = ((await (await accepted).json()) as Connection).matchKey!;
      matchKeys.push(matchKey);
      await viewer.page.goto(`/profile/match/${matchKey}`);
      const connected = (await api<{ space: ProfileSpace }>(viewer.page, `/api/social/profiles/match/${matchKey}`)).space;
      expect(connected.identity).toEqual(stranger.identity);
      expect(connected.presentation).toEqual(stranger.presentation);
      expect(connected.status).toBeNull(); expect(connected.tagline).toBeNull();
      expect(connected.activities).toEqual([]); expect(connected.interests).toEqual([]); expect(connected.goals).toEqual([]);
      await expect(viewer.page.getByRole("link", { name: "Открыть чат", exact: true })).toBeVisible();
      await overflow(viewer.page);
    }
    expect(identities[0]!.alias).not.toBe(identities[1]!.alias);
    expect(identities[0]!.avatarSeed).not.toBe(identities[1]!.avatarSeed);
    await api(first.page, `/api/social/profiles/match/${matchKeys[1]}`, "GET", undefined, 404);
    await api(second.page, `/api/social/profiles/match/${matchKeys[0]}`, "GET", undefined, 404);
    await first.page.reload();
    expect((await api<{ space: ProfileSpace }>(first.page, `/api/social/profiles/match/${matchKeys[0]}`)).space.identity).toEqual(identities[0]);
    await page.goto("/network/profile");
    for (const value of globalText) await expect(page.locator(".profile-scene")).toContainText(value);
    await Promise.all([checkOwner(), checkFirst(), checkSecond()]);
  } finally {
    await Promise.all([first.context.close(), second.context.close()]);
  }
});
