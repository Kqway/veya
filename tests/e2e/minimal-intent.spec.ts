import {
  devices, expect, test, type Browser, type Page, type TestInfo,
} from "../support/browser-test";
import type { Interpretation, OfferDTO, RoomDTO, SearchDTO } from "../../src/features/intent-product/schema";
import type { NotificationDTO } from "../../src/features/notifications/schema";
import type { SeekingInput } from "../../src/features/social/seeking-schema";
import { fetchAuditedResponse } from "../support/audited-response";

const origin = "http://127.0.0.1:3100";
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const secretField = /^(?:id|.*(?:profile|guest|sender|recipient|session|post|pair|conversation|search|lobby|room|offer|author|member)[_-]?id|.*hash|token.*|session.*|email|ip|fingerprint|score)$/i;
const privateField = /^(?:ownDraft|rawText|city|area|availability|startAt|endAt|windows|notes|contact.*|ageBand|skill|languages|tags|desiredAgeBands|recovery.*)$/i;

function projection(value: unknown, own = false, oneTime = false, path = "") {
  if (typeof value === "string") {
    expect(value, `UUID at ${path}`).not.toMatch(uuid);
    expect(value, `Hash at ${path}`).not.toMatch(/^[a-f0-9]{64}$/i);
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    expect(secretField.test(key), `Internal identity at ${path}.${key}`).toBe(false);
    if (!(oneTime && key === "recoveryKey")) expect(key).not.toMatch(/^recovery/i);
    if (!own) expect(privateField.test(key), `Private field at ${path}.${key}`).toBe(false);
    projection(child, own, oneTime, `${path}.${key}`);
  }
}

// Read real upstream payloads before releasing them to Chromium. No fixture
// response is substituted, and the shared auditor never replays a mutation.
async function audit(page: Page) {
  const errors: string[] = [];
  const pending: Promise<void>[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/\/api\/(?:intavro|notifications)(?:\/|\?|$)/, async route => {
    const work = (async () => {
      const response = await fetchAuditedResponse(route);
      const path = new URL(route.request().url()).pathname;
      const body: unknown = await response.json();
      projection(body, /^\/api\/intavro\/(?:interpret|searches|preferences)(?:\/|$)/.test(path));
      expect(response.headers()["cache-control"]).toContain("no-store");
      await route.fulfill({ response });
    })().catch(async (error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
      await route.abort().catch(() => {});
    });
    pending.push(work);
    await work;
  });
  // Observe the native stream. This delegates to the actual EventSource and
  // records only received frames; it never injects events or replaces transport.
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    const frames: unknown[] = [];
    Object.assign(window, { __intentFrames: frames, __intentStreamOpens: 0 });
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        this.addEventListener("open", () => {
          const telemetry = window as unknown as { __intentStreamOpens: number };
          telemetry.__intentStreamOpens++;
        });
        this.addEventListener("invalidate", event => frames.push(JSON.parse((event as MessageEvent).data)));
      }
    };
  });
  return async () => {
    await Promise.all(pending);
    const frames = await page.evaluate(() => (window as unknown as { __intentFrames: unknown[] }).__intentFrames);
    for (const frame of frames ?? []) {
      projection(frame);
      if (frame && typeof frame === "object" && "topic" in frame && ["intents", "rooms"].includes(String(frame.topic))) {
        expect(Object.keys(frame)).toEqual(["topic"]);
      }
    }
    expect(errors).toEqual([]);
  };
}

async function actor(browser: Browser, info: TestInfo) {
  const context = await browser.newContext({
    ...(info.project.name === "mobile" ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } }),
    baseURL: origin, timezoneId: "Europe/Moscow", locale: "ru-RU",
  });
  return { context, page: await context.newPage() };
}

async function api<T>(page: Page, path: string, method = "GET", body?: unknown, status = 200): Promise<T> {
  if (!page.url().startsWith(origin)) await page.goto("/");
  // Browser fetch preserves the production Secure session cookie on loopback.
  const response = await page.evaluate(async ({ path, method, body }) => {
    const result = await fetch(path, {
      method, credentials: "same-origin", cache: "no-store",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    return { status: result.status, cache: result.headers.get("cache-control"), data: await result.json() };
  }, { path, method, body });
  expect(response.status, `${method} ${path}`).toBe(status);
  expect(response.cache).toContain("no-store");
  projection(response.data,
    /^\/api\/(?:intavro\/(?:interpret|searches|preferences)|social\/(?:profile|seeking))(?:\/|$)/.test(path),
    method === "POST" && path === "/api/social/profile");
  return response.data as T;
}

function responseFor(page: Page, path: string, method = "POST") {
  return page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
}

async function setupProfile(page: Page, alias: string) {
  await api(page, "/api/session", "POST", {}, 201);
  await api(page, "/api/social/profile", "POST", {
    alias, privacyMode: "INCOGNITO", adultConfirmed: true, languages: ["ru"], ageBand: null,
  }, 201);
  await page.reload();
}

async function overflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function live(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __intentStreamOpens: number }).__intentStreamOpens),
  { timeout: 10_000 }).toBeGreaterThan(0);
}

async function receivedTopic(page: Page, topic: "intents" | "rooms") {
  await expect.poll(() => page.evaluate(topic =>
    (window as unknown as { __intentFrames: { topic: string }[] }).__intentFrames.some(frame => frame.topic === topic), topic),
  { timeout: 10_000 }).toBe(true);
}

test("a phrase needs Start, a real offer consent fills five seats, and two humans chat and archive", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const b = await actor(browser, info), outsider = await actor(browser, info);
  const checkA = await audit(page), checkB = await audit(b.page), checkOutsider = await audit(outsider.page);
  const createdProfiles: Page[] = [];
  try {
    if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 760 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Что хочешь сделать?", exact: true })).toBeVisible();
    await page.getByLabel("Псевдоним", { exact: true }).fill(`Intent A ${info.project.name}`);
    await page.getByLabel("Мне исполнилось 18 лет", { exact: true }).check();
    await page.getByLabel(/^Я понимаю правила приватности:/).check();
    const profileResponse = responseFor(page, "/api/social/profile");
    await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    expect((await profileResponse).status()).toBe(201);
    createdProfiles.push(page);
    const recoveryKey = await page.getByLabel("Ключ Intavro", { exact: true }).inputValue();
    expect(recoveryKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await page.getByRole("button", { name: "Ключ сохранён", exact: true }).click();
    await expect(page.getByLabel("Ключ Intavro", { exact: true })).toHaveCount(0);

    // Tomorrow keeps the actual server's future-only validation reproducible
    // even when this journey runs after today's evening has already started.
    const phrase = "Нужен пятый в Dota завтра вечером";
    await page.getByRole("textbox", { name: "Что хочешь сделать?", exact: true }).fill(phrase);
    const interpreted = responseFor(page, "/api/intavro/interpret");
    await page.getByRole("button", { name: "Разобрать намерение", exact: true }).click();
    const result = await (await interpreted).json() as { interpretation: Interpretation };
    expect(result.interpretation.kind).toBe("draft");
    if (result.interpretation.kind !== "draft") throw new Error("Expected the complete Dota phrase to produce a draft");
    const draft = result.interpretation.draft;
    expect(draft).toMatchObject({ existingPeople: 4, neededPeople: 1, seeking: { activityKey: "dota2", groupSize: 5 } });
    const preview = page.getByRole("region", { name: "Понятое намерение", exact: true });
    await expect(preview).toContainText("Уже есть 4, ищем ещё 1");
    await expect(preview.locator(".intent-question")).toHaveCount(0);
    expect((await api<{ searches: SearchDTO[] }>(page, "/api/intavro/searches")).searches).toEqual([]);
    expect((await api<{ rooms: RoomDTO[] }>(page, "/api/intavro/rooms")).rooms).toEqual([]);
    await overflow(page);
    await page.screenshot({ path: `test-results/minimal-intent-${info.project.name}-draft.png`, fullPage: true });

    await setupProfile(b.page, `Hidden B ${info.project.name}`); createdProfiles.push(b.page);
    await setupProfile(outsider.page, `Outsider C ${info.project.name}`); createdProfiles.push(outsider.page);
    const candidate: SeekingInput = {
      ...draft.seeking, rawText: `Private fifth player ${info.project.name}`,
      groupSize: null, privacyMode: "INCOGNITO",
    };
    await api(b.page, "/api/social/seeking", "POST", candidate, 201);
    await api(outsider.page, "/api/social/seeking", "POST", {
      ...candidate, rawText: "Incompatible gym intent", activityKey: "gym", activityLabel: "Зал",
    }, 201);
    await live(page); await live(b.page);
    await expect(b.page.getByRole("button", { name: "Я в деле", exact: true })).toHaveCount(0);
    const started = responseFor(page, "/api/intavro/searches");
    await preview.getByRole("button", { name: "Начать", exact: true }).click();
    expect((await started).status()).toBe(201);
    const search = (await (await started).json() as { search: SearchDTO }).search;
    expect(search).toMatchObject({ capacity: 5, joinedCount: 4, acceptedCount: 0, status: "active", roomKey: null });
    // B remains on the already-open page: neither refresh nor polling drives delivery.
    await expect(b.page.getByRole("button", { name: "Я в деле", exact: true })).toBeVisible({ timeout: 15_000 });
    await receivedTopic(b.page, "intents");
    const offered = (await api<{ offers: OfferDTO[] }>(b.page, "/api/intavro/offers")).offers;
    expect(offered).toHaveLength(1);
    const offer = offered[0]!;
    expect(offer).toMatchObject({ status: "pending", roomKey: null, neededPeople: 1 });
    expect((await api<{ rooms: RoomDTO[] }>(b.page, "/api/intavro/rooms")).rooms).toEqual([]);
    expect((await api<{ offers: OfferDTO[] }>(outsider.page, "/api/intavro/offers")).offers).toEqual([]);
    const outsiderNotifications = (await api<{ notifications: NotificationDTO[] }>(outsider.page, "/api/notifications")).notifications;
    expect(outsiderNotifications.some(item => item.type === "OFFER_RECEIVED")).toBe(false);

    // The notification opens the actual scoped offer; consent still needs a click.
    const notifications = (await api<{ notifications: NotificationDTO[] }>(b.page, "/api/notifications")).notifications;
    expect(notifications.filter(item => item.type === "OFFER_RECEIVED")).toEqual([
      expect.objectContaining({ href: `/offer/${offer.publicKey}` }),
    ]);
    await b.page.goto("/notifications");
    await b.page.getByRole("link", { name: "Новое предложение", exact: true }).click();
    await expect(b.page).toHaveURL(`${origin}/offer/${offer.publicKey}`);
    const accepted = responseFor(b.page, `/api/intavro/offers/${offer.publicKey}/respond`);
    await b.page.getByRole("button", { name: "Я в деле", exact: true }).click();
    expect((await accepted).status()).toBe(200);
    const acceptedOffer = (await (await accepted).json() as { offer: OfferDTO }).offer;
    expect(acceptedOffer.status).toBe("accepted"); expect(acceptedOffer.roomKey).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const roomKey = acceptedOffer.roomKey!;
    await expect(page.locator(".intent-search")).toContainText("5 / 5 мест занято", { timeout: 15_000 });
    await expect(page.locator(".intent-search")).toContainText("1 приняли");
    await b.page.getByRole("link", { name: "Открыть комнату", exact: true }).click();
    await page.locator(".intent-search").getByRole("link", { name: "Открыть комнату", exact: true }).click();
    for (const person of [page, b.page]) {
      await expect(person.getByRole("heading", { name: "Компания собралась", exact: true })).toBeVisible();
      await expect(person.locator(".intent-room-overview")).toContainText("5 / 5");
      await expect(person.locator(".intent-room-overview")).toContainText("ещё 3 участников вне Intavro");
      await expect(person.getByRole("list", { name: "Участники комнаты", exact: true }).getByRole("listitem")).toHaveCount(2);
      await expect(person.locator(".intent-product")).not.toContainText(`Hidden B ${info.project.name}`);
      await live(person); await overflow(person);
    }
    const room = (await api<{ room: RoomDTO }>(page, `/api/intavro/rooms/${roomKey}`)).room;
    expect(room).toMatchObject({ joinedCount: 5, capacity: 5, externalCount: 3, status: "ready", isOwner: true });
    expect(room.members).toHaveLength(2);
    expect(room.members.filter(member => member.isMine)).toHaveLength(1);
    await page.screenshot({ path: `test-results/minimal-intent-${info.project.name}-room.png`, fullPage: true });
    await api(outsider.page, `/api/intavro/rooms/${roomKey}`, "GET", undefined, 404);
    await api(outsider.page, `/api/intavro/rooms/${roomKey}/messages`, "GET", undefined, 404);
    await api(outsider.page, `/api/intavro/rooms/${roomKey}/messages`, "POST", { text: "Outsider send" }, 404);
    await api(outsider.page, `/api/intavro/offers/${offer.publicKey}`, "GET", undefined, 404);

    await page.getByRole("button", { name: "Начать дело", exact: true }).click();
    await expect(b.page.getByRole("heading", { name: "В процессе", exact: true })).toBeVisible();
    const plainText = '<img src=x onerror="window.__intentXss=1"><script>window.__intentXss=1</script> Готов играть?';
    await page.getByLabel("Сообщение", { exact: true }).fill(plainText);
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    const messagesB = b.page.getByRole("list", { name: "Сообщения комнаты", exact: true });
    await expect(messagesB).toContainText(plainText, { timeout: 15_000 });
    await receivedTopic(b.page, "rooms");
    await expect(messagesB.locator("img, script")).toHaveCount(0);
    expect(await b.page.evaluate(() => Object.hasOwn(window, "__intentXss"))).toBe(false);
    await b.page.getByLabel("Сообщение", { exact: true }).fill("Да, присоединяюсь к команде.");
    await b.page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByRole("list", { name: "Сообщения комнаты", exact: true })).toContainText("Да, присоединяюсь к команде.", { timeout: 15_000 });
    await receivedTopic(page, "rooms");
    const roomMessages = (await api<{ notifications: NotificationDTO[] }>(page, "/api/notifications")).notifications;
    expect(roomMessages).toContainEqual(expect.objectContaining({ type: "ROOM_MESSAGE", href: `/room/${roomKey}` }));
    await overflow(page); await overflow(b.page);

    await page.getByRole("button", { name: "Завершить дело", exact: true }).click();
    await page.getByRole("button", { name: "Подтвердить завершение", exact: true }).click();
    await expect(b.page.getByRole("heading", { name: "Дело завершено", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "В архив", exact: true }).click();
    await expect(b.page.getByRole("heading", { name: "Комната в архиве", exact: true })).toBeVisible();
    await expect(b.page.getByLabel("Сообщение", { exact: true })).toHaveCount(0);
    await page.goto("/people");
    await expect(page.getByRole("heading", { name: "Пока нет активных комнат", exact: true })).toBeVisible();
    await expect(page.locator(`a[href="/room/${roomKey}"]`)).toHaveCount(0);
    await page.getByRole("button", { name: "Завершённые комнаты", exact: true }).click();
    await expect(page.locator(`a[href="/room/${roomKey}"]`)).toContainText("В архиве");
    await overflow(page);
    await Promise.all([checkA(), checkB(), checkOutsider()]);
  } finally {
    for (const person of createdProfiles) await api(person, "/api/social/profile", "DELETE", { confirmation: "DELETE" }).catch(() => {});
    await Promise.all([b.context.close(), outsider.context.close()]);
  }
});

test("profile browser Back can cancel, then discard an unsaved edit without persisting it", async ({ page }) => {
  test.setTimeout(45_000);
  await setupProfile(page, "Profile Back owner");
  try {
    await page.goto("/profile");
    await page.getByRole("link", { name: "Настроить профиль", exact: true }).click();
    await expect(page).toHaveURL(/\/profile\/edit$/);
    const status = page.getByLabel("Статус", { exact: true });
    const saved = await status.inputValue();
    await status.fill("Несохранённый статус после Back");
    await expect(page.getByText("Есть несохранённые изменения", { exact: true })).toBeVisible();
    // Allow the committed editor render and its passive navigation guard to run
    // before exercising browser history, as a person would after typing.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const cancelled = page.waitForEvent("dialog", { timeout: 5_000 });
    const firstBack = page.evaluate(() => history.back());
    const cancelDialog = await cancelled;
    expect(cancelDialog.type()).toBe("confirm");
    expect(cancelDialog.message()).toContain("несохранённые изменения");
    await cancelDialog.dismiss();
    await firstBack;
    await expect(page).toHaveURL(/\/profile\/edit$/);
    await expect(status).toHaveValue("Несохранённый статус после Back");
    const discarded = page.waitForEvent("dialog", { timeout: 5_000 });
    const secondBack = page.evaluate(() => history.back());
    const discardDialog = await discarded;
    expect(discardDialog.type()).toBe("confirm");
    await discardDialog.accept();
    await secondBack;
    await expect(page).toHaveURL(/\/profile$/);
    await page.getByRole("link", { name: "Настроить профиль", exact: true }).click();
    await expect(page.getByLabel("Статус", { exact: true })).toHaveValue(saved);
  } finally {
    await api(page, "/api/social/profile", "DELETE", { confirmation: "DELETE" }).catch(() => {});
  }
});
