import { expect, test, type Browser, type Page, type TestInfo } from "../support/browser-test";
import type { Card, Connection, Match, OwnPost, SeekingInput } from "../../src/features/social/client";
const origin = "http://127.0.0.1:3100";
async function api<T>(page: Page, path: string, method = "GET", body?: unknown, status = 200): Promise<T> {
  if (!page.url().startsWith(origin)) await page.goto("/");
  const response = await page.evaluate(async ({path, method, body}) => {
    const result = await fetch(path, { method, credentials: "same-origin", cache: "no-store", ...(body === undefined ? {} : {headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}) });
    return { status: result.status, data: await result.json() };
  }, {path, method, body});
  expect(response.status, `${method} ${path}`).toBe(status);
  return response.data as T;
}
async function profile(page: Page, label: string, language: string) {
  await page.goto("/discover");
  await page.getByLabel("Псевдоним", {exact:true}).fill(label);
  await page.getByLabel("Языки профиля (необязательно)").fill(language);
  await page.getByRole("combobox", {name:"Приватность",exact:true}).selectOption("INCOGNITO");
  await page.getByLabel("Мне исполнилось 18 лет").check();
  await page.getByRole("button", {name:"Создать профиль",exact:true}).click();
  await expect(page.getByLabel("Ключ Veya", {exact:true})).toBeVisible();
  await page.getByRole("button", {name:"Ключ сохранён",exact:true}).click();
}
function input(testInfo: TestInfo, category = "chess"): SeekingInput {
  const start = Date.now()+2*86_400_000;
  return { rawText: `Private launch activity ${testInfo.project.name}`, activityKey:category, activityLabel:category === "chess" ? "Chess" : category, interactionMode:"online", format:"one_to_one", city:null, area:null, availability:[{startAt:new Date(start).toISOString(),endAt:new Date(start+2*3_600_000).toISOString()}], skill:"any", languages:[testInfo.project.name === "desktop" ? "ru" : "en"], tags:[], desiredAgeBands:[], groupSize:null, privacyMode:"INCOGNITO" };
}
async function peer(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({baseURL:origin, viewport:testInfo.project.use.viewport ?? {width:1280,height:900}, timezoneId:"Europe/Moscow"});
  return {context,page:await context.newPage()};
}
async function recordEvents(page: Page) {
  const frames: string[] = [];
  await page.exposeFunction("recordLaunchFrame", (frame: string) => { frames.push(frame); });
  await page.addInitScript(() => {
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        for (const type of ["sync", "invalidate"]) this.addEventListener(type, (event) => {
          const record = Reflect.get(window, "recordLaunchFrame") as (frame: string) => Promise<void>;
          void record(event.data);
        });
      }
    };
  });
  return frames;
}
async function matched(a: Page, b: Page, testInfo: TestInfo) {
  const language = testInfo.project.name === "desktop" ? "ru" : "en";
  await Promise.all([profile(a, "Launch A", language), profile(b, "Launch B", language)]);
  const seeking = input(testInfo, `launch-chess-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
  const [source] = await Promise.all([api<OwnPost>(a,"/api/social/seeking","POST",seeking,201),api<OwnPost>(b,"/api/social/seeking","POST",seeking,201)]);
  await b.goto("/network/connections");
  await expect(b.getByText(/Запросов пока нет/)).toBeVisible();
  await a.goto("/discover");
  await a.getByLabel("Ваша активная заявка").selectOption(source.publicKey);
  await a.getByRole("button",{name:"Найти людей",exact:true}).click();
  const candidates = a.getByRole("region",{name:"Подходящие люди",exact:true});
  await expect(candidates.getByRole("article")).toHaveCount(1);
  const cards = await api<{cards:Card[]}>(a,`/api/social/discover?source=${source.publicKey}`);
  expect(cards.cards[0]!.identity.alias).not.toBe("Launch B");
  await candidates.getByRole("button",{name:"Хочу присоединиться",exact:true}).click();
  // Wait for the persisted action acknowledgement before leaving its page.
  await expect(a.getByRole("status").filter({hasText:"Запрос отправлен."})).toBeVisible();
  await a.goto("/network/connections");
  const incoming = b.getByRole("region",{name:"Входящие запросы",exact:true});
  await expect(incoming.getByRole("button",{name:"Принять",exact:true})).toBeVisible();
  await incoming.getByRole("button",{name:"Принять",exact:true}).click();
  await expect(a.getByRole("link",{name:"Открыть чат",exact:true})).toBeVisible();
  const connections = await api<{requests:Connection[]}>(a,"/api/social/connections");
  const key = connections.requests[0]!.matchKey!;
  expect(key).toMatch(/^[A-Za-z0-9_-]{24}$/);
  await Promise.all([a.getByRole("link",{name:"Открыть чат",exact:true}).click(),b.getByRole("link",{name:"Открыть чат",exact:true}).click()]);
  await Promise.all([expect(a.getByLabel("Сообщение",{exact:true})).toBeVisible(),expect(b.getByLabel("Сообщение",{exact:true})).toBeVisible()]);
  return key;
}
async function send(page: Page, text: string) { await page.getByLabel("Сообщение",{exact:true}).fill(text); await page.getByRole("button",{name:"Отправить сообщение",exact:true}).click(); }

test("two online profiles receive interest, accept, messages, linked plans, inbox and block through live updates",async({page,browser},testInfo)=>{
  test.setTimeout(90_000);
  const b = await peer(browser,testInfo);
  const [aFrames, bFrames] = await Promise.all([recordEvents(page),recordEvents(b.page)]);
  try {
    const key = await matched(page,b.page,testInfo);
    const text = '<img src=x onerror="window.__launchXss=1"> Live chess?';
    await send(page,text);
    const messages = b.page.getByRole("list",{name:"Сообщения чата"});
    await expect(messages).toContainText(text);
    await expect(messages.locator("img,script")).toHaveCount(0);
    expect(await b.page.evaluate(()=>Object.hasOwn(window,"__launchXss"))).toBe(false);
    await send(b.page,"Yes, let's make a plan.");
    await expect(page.getByRole("list",{name:"Сообщения чата"})).toContainText("Yes, let's make a plan.");
    await page.getByRole("button",{name:"Организовать встречу",exact:true}).click();
    await page.getByRole("button",{name:"Создать план",exact:true}).click();
    await expect(b.page.getByRole("link",{name:"Открыть план",exact:true})).toBeVisible();
    const [aMatch,bMatch] = await Promise.all([api<Match>(page,`/api/social/matches/${key}`),api<Match>(b.page,`/api/social/matches/${key}`)]);
    expect(aMatch.planSlug).toBe(bMatch.planSlug);
    const notices = await api<{notifications:{type:string,publicKey:string,href:string}[]}>(b.page,"/api/notifications");
    expect(notices.notifications.map(n=>n.type)).toContain("NEW_MESSAGE");
    const unread = await api<{unreadCount:number}>(b.page,"/api/notifications/unread");
    expect(unread.unreadCount).toBeGreaterThan(0);
    await b.page.goto("/notifications");
    await expect(b.page.getByRole("button",{name:"Отметить как прочитанное",exact:true})).toHaveCount(unread.unreadCount);
    await expect(b.page.getByRole("heading",{name:"Уведомления",exact:true})).toBeVisible();
    await b.page.goto(`/m/${key}`);
    await page.getByRole("button",{name:"Заблокировать",exact:true}).click();
    await page.getByRole("button",{name:"Подтвердить блокировку",exact:true}).click();
    await expect(b.page.getByText("Этот чат закрыт. Вы можете читать историю сообщений.")).toBeVisible();
    await expect(b.page.getByRole("button",{name:"Отправить сообщение",exact:true})).toHaveCount(0);
    for (const member of [page,b.page]) await api(member,`/api/social/matches/${key}/messages`,"POST",{text:"Cannot bypass block"},409);
    const observed = [...aFrames,...bFrames];
    expect(observed.length).toBeGreaterThan(0);
    for (const value of observed) {
      const frame: unknown = JSON.parse(value);
      expect(value).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
      expect(value).not.toContain("Launch A"); expect(value).not.toContain("Launch B"); expect(value).not.toContain("Live chess?");
      expect(Object.keys(frame as object).every(k=>["topic","matchKey"].includes(k))).toBe(true);
    }
  } finally { await b.context.close(); }
});

test("a dropped live stream restores persisted messages after reconnect",async({page,browser},testInfo)=>{
  test.setTimeout(90_000);
  const b = await peer(browser,testInfo);
  try {
    await matched(page,b.page,testInfo);
    await b.context.setOffline(true);
    await b.page.evaluate(()=>window.dispatchEvent(new Event("offline")));
    await expect(b.page.getByText(/Обновления в реальном времени недоступны|Восстанавливаем подключение для обновлений в реальном времени/)).toBeVisible();
    await send(page,"Saved during the network outage");
    await b.context.setOffline(false);
    await b.page.evaluate(()=>window.dispatchEvent(new Event("online")));
    await expect(b.page.getByRole("list",{name:"Сообщения чата"})).toContainText("Saved during the network outage");
  } finally { await b.context.close(); }
});

test("empty activities stay saved and usable at 320px with reduced motion and unsupported push",async({page},testInfo)=>{
  await page.setViewportSize({width:320,height:780});
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.addInitScript(()=>{ Object.defineProperty(window,"PushManager",{value:undefined,configurable:true}); });
  await profile(page,"Cold start",testInfo.project.name==="desktop"?"ru":"en");
  const post = await api<OwnPost>(page,"/api/social/seeking","POST",input(testInfo,`launch-empty-${testInfo.project.name}-${Date.now()}`),201);
  await page.goto("/discover");
  await page.getByLabel("Ваша активная заявка").selectOption(post.publicKey);
  await page.getByRole("button",{name:"Найти людей",exact:true}).click();
  await expect(page.getByText(/Ваша заявка сохранена до истечения срока/)).toContainText("Veya никогда не отправляет запрос «Хочу присоединиться» за вас.");
  await expect(page.getByRole("button",{name:"Хочу присоединиться",exact:true})).toHaveCount(0);
  expect((await api<OwnPost>(page,`/api/social/seeking/${post.publicKey}`)).status).toBe("active");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.goto("/notifications");
  await expect(page.getByRole("heading",{name:"Уведомления",exact:true})).toBeVisible();
  await expect(page.getByText("Уведомления браузера здесь недоступны. Вы можете просматривать уведомления на сайте.")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test("denied browser push leaves profiles, inbox and manual connections functional",async({page},testInfo)=>{
  await page.addInitScript(()=>{
    Object.defineProperty(window.Notification,"permission",{value:"denied",configurable:true});
    window.Notification.requestPermission = async () => { throw new Error("Veya must not prompt automatically"); };
  });
  await profile(page,"Push denied",testInfo.project.name==="desktop"?"ru":"en");
  await page.goto("/notifications");
  await expect(page.getByRole("heading",{name:"Уведомления",exact:true})).toBeVisible();
  const notices = await api<{notifications:unknown[]}>(page,"/api/notifications");
  expect(Array.isArray(notices.notifications)).toBe(true);
  expect(await page.evaluate(()=>Notification.permission)).toBe("denied");
  await page.goto("/network/connections");
  await expect(page.getByRole("button",{name:"Обновить запросы",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Обновить запросы",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Запросы",exact:true})).toBeVisible();
});

test("moderator suspension closes live contact and rejects direct social API bypass",async({page,browser},testInfo)=>{
  test.setTimeout(90_000);
  const b = await peer(browser,testInfo), moderator = await peer(browser,testInfo);
  try {
    const key = await matched(page,b.page,testInfo);
    await page.getByRole("button",{name:"Пожаловаться",exact:true}).click();
    await page.getByLabel("Причина жалобы").selectOption("harassment");
    const details = `Launch moderation ${key}`;
    await page.getByLabel("Подробности жалобы (необязательно)").fill(details);
    await page.getByRole("button",{name:"Отправить жалобу",exact:true}).click();
    await expect(page.getByText("Жалоба получена.")).toBeVisible();
    await api(page,"/api/moderation/reports","GET",undefined,401);
    const secret = process.env.VEYA_TEST_ADMIN_SECRET;
    expect(secret).toBeTruthy();
    await api(moderator.page,"/api/moderation/session","POST",{secret});
    const reports = await api<{reports:{publicKey:string,text:string}[]}>(moderator.page,"/api/moderation/reports");
    const report = reports.reports.find(report=>report.text===details);
    expect(report).toBeDefined();
    await api(moderator.page,`/api/moderation/reports/${report!.publicKey}`,"PATCH",{moderationStatus:"suspended"});
    await expect(page.getByText("Этот чат закрыт. Вы можете читать историю сообщений.")).toBeVisible();
    await api(b.page,"/api/social/seeking","POST",input(testInfo,"forbidden-launch"),403);
    await api(b.page,`/api/social/matches/${key}/messages`,"POST",{text:"Cannot bypass suspension"},403);
    await api(b.page,"/api/social/connections","POST",{handle:"A".repeat(24)},403);
    await api(moderator.page,"/api/moderation/session","DELETE");
    await api(moderator.page,"/api/moderation/reports","GET",undefined,401);
  } finally { await Promise.all([b.context.close(),moderator.context.close()]); }
});
