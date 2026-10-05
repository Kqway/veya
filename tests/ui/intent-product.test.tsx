// @vitest-environment jsdom
import "../support/history-guard";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NowScreen } from "@/features/intent-product/components/now-screen";
import { PreferencesScreen } from "@/features/intent-product/components/preferences-screen";
import { RoomScreen } from "@/features/intent-product/components/room-screen";
import { RecoveryKeyProvider } from "@/features/social/components/recovery-key-provider";
import type { SearchDraft } from "@/features/intent-product/schema";
const live = vi.hoisted(() => ({ refresh: null as null | (() => Promise<void>), push: vi.fn() }));
vi.mock("@/features/realtime/client", () => ({ useSocialRefresh: (_topics: string[], refresh: () => Promise<void>) => { live.refresh = refresh; return { status: "live", profileActive: true, reconnect: vi.fn() }; } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: live.push }) }));
const key = "abcdefghijklmnopqrstuvwx";
const profile = { alias: "Саша", privacyMode: "PRIVATE", avatarSeed: "own", ageBand: null, languages: ["ru"], hasRecoveryKey: true };
const draft: SearchDraft = { seeking: { rawText: "Нужен пятый в Dota сегодня вечером", activityKey: "dota2", activityLabel: "Dota 2", interactionMode: "online", format: "group", city: null, area: null, availability: [{ startAt: "2026-10-05T18:00:00Z", endAt: "2026-10-05T23:00:00Z" }], skill: "any", languages: ["ru"], tags: [], desiredAgeBands: [], groupSize: 5 }, neededPeople: 1, existingPeople: 4, attributes: { role: "support", rank: "legend" }, timezone: "UTC" };
const search = { publicKey: key, activityLabel: "Dota 2", status: "active", neededPeople: 1, existingPeople: 4, capacity: 5, joinedCount: 4, compatibleCount: 1, offeredCount: 1, acceptedCount: 0, roomKey: null, createdAt: "2026-10-05T10:00:00Z", expiresAt: "2026-10-05T23:00:00Z", timeHint: "Сегодня вечером", ownDraft: draft };
const room = { publicKey: key, activityLabel: "Dota 2", status: "ready", capacity: 5, joinedCount: 5, externalCount: 3, isOwner: true, members: [{ publicKey: "aaaaaaaaaaaaaaaaaaaaaaaa", alias: "Саша", avatarSeed: "a", isMine: true }, { publicKey: "bbbbbbbbbbbbbbbbbbbbbbbb", alias: "Лена", avatarSeed: "b", isMine: false }], planSlug: null };
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
function setupFetch(overrides: (path: string, method: string, body: Record<string, unknown>) => Response | undefined = () => undefined) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    const custom = overrides(url, method, body); if (custom) return custom;
    if (url === "/api/social/profile") return response({ profile });
    if (url === "/api/intavro/searches") return response({ searches: [] });
    if (url === "/api/intavro/offers") return response({ offers: [] });
    if (url === "/api/intavro/rooms") return response({ rooms: [] });
    throw new Error(`Unexpected ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
function renderNow() { return render(<RecoveryKeyProvider><NowScreen /></RecoveryKeyProvider>); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); live.refresh = null; });
describe("minimal intent product", () => {
  it("starts with one composer, fills a suggestion without sending it and keeps unsaved text through refresh", async () => {
    const fetcher = setupFetch(); const user = userEvent.setup(); renderNow();
    await screen.findByRole("button", { name: "Обновить" });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Нужен пятый в Dota сегодня вечером" }));
    expect(screen.getByRole("textbox", { name: "Что хочешь сделать?" })).toHaveValue("Нужен пятый в Dota сегодня вечером");
    expect(fetcher.mock.calls.some(([url]) => url.includes("interpret"))).toBe(false);
    await act(async () => { await live.refresh?.(); });
    expect(screen.getByRole("textbox")).toHaveValue("Нужен пятый в Dota сегодня вечером");
    const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  });
  it("shows a transparent preview and creates only after explicit Start", async () => {
    let created = false;
    const fetcher = setupFetch((path, method) => {
      if (path === "/api/intavro/interpret") return response({ interpretation: { kind: "draft", draft, summary: "Пятый участник в Dota 2 сегодня вечером" } });
      if (path === "/api/intavro/searches" && method === "POST") { created = true; return response({ search }); }
      if (path === "/api/intavro/searches" && created) return response({ searches: [search] });
    });
    const user = userEvent.setup(); renderNow(); await screen.findByRole("button", { name: "Обновить" });
    await user.type(screen.getByRole("textbox"), draft.seeking.rawText);
    await user.click(screen.getByRole("button", { name: "Разобрать намерение" }));
    await screen.findByRole("button", { name: /^Начать$/ });
    expect(created).toBe(false);
    expect(screen.getByText(/Уже есть 4, ищем ещё 1/)).toBeInTheDocument();
    expect(screen.getByText(/Роль: Поддержка · Ранг: Легенда/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Начать$/ }));
    await screen.findByText("Ищем компанию");
    const request = fetcher.mock.calls.find(([path, init]) => path === "/api/intavro/searches" && init?.method === "POST");
    expect(JSON.parse(request![1]!.body as string)).toEqual({ draft, consent: true });
    expect(screen.getByText("1 предложений")).toBeInTheDocument();
    expect(screen.getByText("0 приняли")).toBeInTheDocument();
  });
  it("asks one critical question and sends the incomplete own draft on the answer", async () => {
    const partialDraft = { timezone: "UTC", seeking: { activityKey: "gym", activityLabel: "Тренировки", rawText: "В зал завтра", interactionMode: "in_person", availability: [{ startAt: "2026-10-05T18:00:00Z", endAt: "2026-10-05T22:00:00Z" }] }, existingPeople: 1, neededPeople: 1, attributes: {} };
    let turn = 0;
    const fetcher = setupFetch((path) => path === "/api/intavro/interpret" ? response({ interpretation: ++turn === 1 ? { kind: "clarification", question: { field: "city", text: "В каком городе?", options: [] }, draft: null, partialDraft, summary: "Тренировка завтра вечером" } : { kind: "draft", draft, summary: "Готово" } }) : undefined);
    const user = userEvent.setup(); renderNow();
    await user.type(screen.getByRole("textbox"), "В зал завтра"); await user.click(screen.getByRole("button", { name: "Разобрать намерение" }));
    await screen.findByRole("heading", { name: "В каком городе?" });
    expect(screen.queryByRole("button", { name: /^Начать$/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    await user.type(screen.getByRole("textbox"), "Москва"); await user.click(screen.getByRole("button", { name: "Ответить" }));
    await screen.findByRole("button", { name: /^Начать$/ });
    const calls = fetcher.mock.calls.filter(([path]) => path.includes("interpret"));
    expect(JSON.parse(calls[1]![1]!.body as string)).toMatchObject({ text: "Москва", partialDraft });
    expect(JSON.parse(calls[1]![1]!.body as string)).not.toHaveProperty("draft");
  });
  it("creates a private profile after both attestations and shows the recovery key only in memory", async () => {
    let created = false;
    const fetcher = setupFetch((path, method) => {
      if (path === "/api/session") return response({ authenticated: true });
      if (path === "/api/social/profile" && method === "POST") { created = true; return response({ profile, recoveryKey: "r".repeat(43) }); }
      if (path === "/api/social/profile") return response({ profile: created ? profile : null });
    });
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup(); renderNow();
    await user.type(await screen.findByRole("textbox", { name: "Псевдоним" }), "Саша");
    await user.click(screen.getByRole("checkbox", { name: "Мне исполнилось 18 лет" }));
    await user.click(screen.getByRole("checkbox", { name: /Я понимаю правила приватности/ }));
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    await screen.findByRole("region", { name: "Сохраните ключ восстановления" });
    const request = fetcher.mock.calls.find(([path, init]) => path === "/api/social/profile" && init?.method === "POST");
    expect(JSON.parse(request![1]!.body as string)).toMatchObject({ alias: "Саша", privacyMode: "PRIVATE", adultConfirmed: true });
    expect(storage).not.toHaveBeenCalled(); storage.mockRestore();
  });
  it("keeps a preference proposal unapplied until confirmation", async () => {
    const fetcher = setupFetch((path, method) => {
      if (path === "/api/intavro/interpret") return response({ interpretation: { kind: "preference", preference: { type: "offers", offersEnabled: false }, summary: "Отключить предложения" } });
      if (path === "/api/intavro/preferences") return response({ preferences: { offersEnabled: method !== "PATCH", timezone: "UTC", quietHours: null, activities: [] } });
    });
    const user = userEvent.setup(); renderNow(); await screen.findByRole("button", { name: "Обновить" });
    await user.type(screen.getByRole("textbox"), "Не присылай предложения"); await user.click(screen.getByRole("button", { name: "Разобрать намерение" }));
    await screen.findByRole("button", { name: "Подтвердить правило" });
    expect(fetcher.mock.calls.some(([path]) => path === "/api/intavro/preferences")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Подтвердить правило" }));
    await screen.findByText(/Правило сохранено/);
    const patch = fetcher.mock.calls.find(([path, init]) => path.endsWith("preferences") && init?.method === "PATCH");
    expect(JSON.parse(patch![1]!.body as string).offersEnabled).toBe(false);
  });
  it("edits bounded activity rules, removes quiet hours and saves the visible preferences", async () => {
    const preferences = { offersEnabled: true, timezone: "Europe/Moscow", quietHours: { startHour: 23, endHour: 8 }, activities: [{ activityKey: "dota2", attributes: { role: "support" }, enabled: true }] };
    const fetcher = setupFetch((path, _method, body) => path === "/api/intavro/preferences" ? response({ preferences: Object.keys(body).length ? body : preferences }) : undefined);
    const user = userEvent.setup(); render(<PreferencesScreen />);
    await screen.findByRole("combobox", { name: "Роль" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Роль" }), "carry");
    await user.click(screen.getByRole("button", { name: "Удалить тихие часы" }));
    await act(async () => { await live.refresh?.(); });
    expect(screen.getByRole("combobox", { name: "Роль" })).toHaveValue("carry");
    expect(screen.getByRole("checkbox", { name: "Тихие часы" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Сохранить правила" }));
    await screen.findByText("Настройки сохранены.");
    const patch = fetcher.mock.calls.find(([path, init]) => path.endsWith("preferences") && init?.method === "PATCH");
    expect(JSON.parse(patch![1]!.body as string)).toMatchObject({ timezone: "Europe/Moscow", quietHours: null, activities: [{ attributes: { role: "carry" } }] });
    await user.click(screen.getByRole("button", { name: "Удалить правило Dota 2" }));
    await user.click(screen.getByRole("button", { name: "Сохранить правила" }));
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2));
  });
  it("renders human messages as plain text and completes a room with explicit confirmation", async () => {
    let status = "ready";
    let message = "";
    const fetcher = setupFetch((path, method, body) => {
      if (path === `/api/intavro/rooms/${key}`) return response({ room: { ...room, status } });
      if (path.includes("/messages")) { if (method === "POST") message = String(body.text); return response({ messages: message ? [{ publicKey: key, text: message, isMine: true, createdAt: "2026-10-05T18:00:00Z", identity: profile }] : [], nextBefore: null }); }
      if (path.endsWith("/state")) { status = String(body.status); return response({ room: { ...room, status } }); }
    });
    const user = userEvent.setup(); const view = render(<RoomScreen roomKey={key} />);
    await screen.findByRole("textbox", { name: "Сообщение" });
    expect(screen.getByText(/ещё 3 участников вне Intavro/)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Сообщение" }), '<img src=x onerror=alert(1)>');
    await act(async () => { await live.refresh?.(); });
    expect(screen.getByRole("textbox", { name: "Сообщение" })).toHaveValue('<img src=x onerror=alert(1)>');
    await user.click(screen.getByRole("button", { name: /^Отправить$/ }));
    await screen.findByText('<img src=x onerror=alert(1)>');
    expect(view.container.querySelector("img")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Завершить дело" }));
    expect(fetcher.mock.calls.some(([path]) => path.endsWith("/state"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Подтвердить завершение" }));
    await screen.findByRole("heading", { name: "Дело завершено" });
    expect(screen.queryByRole("textbox", { name: "Сообщение" })).not.toBeInTheDocument();
  });
  it("applies a short followup to the single current search without an Edit click and offers an explicit new intent", async () => {
    const fetcher = setupFetch((path, method, body) => {
      if (path === "/api/intavro/searches") return response({ searches: [search] });
      if (path === "/api/intavro/interpret") return response({ interpretation: { kind: "draft", draft: { ...draft, attributes: { role: "support" } }, summary: "Только саппорт" } });
      if (path === `/api/intavro/searches/${key}` && method === "PATCH") return response({ search: { ...search, ownDraft: body.draft } });
    });
    const user = userEvent.setup(); renderNow();
    await screen.findByText(/Текущий поиск: Dota 2/);
    await user.type(screen.getByRole("textbox"), "Только саппорт");
    await user.click(screen.getByRole("button", { name: "Разобрать намерение" }));
    await screen.findByRole("button", { name: "Сохранить изменения" });
    const interpreted = fetcher.mock.calls.find(([path]) => path.endsWith("interpret"));
    expect(JSON.parse(interpreted![1]!.body as string).draft).toEqual(draft);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    await screen.findByText(/Поиск обновлён/);
    const patched = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patched![0]).toBe(`/api/intavro/searches/${key}`);
    expect(JSON.parse(patched![1]!.body as string)).toMatchObject({ consent: true, draft: { attributes: { role: "support" } } });
    await user.click(screen.getByRole("button", { name: "Новое намерение" }));
    expect(screen.queryByText(/Текущий поиск: Dota 2/)).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "Ещё одно дело");
    await user.click(screen.getByRole("button", { name: "Разобрать намерение" }));
    await screen.findByRole("button", { name: /^Начать$/ });
    const latest = fetcher.mock.calls.filter(([path]) => path.endsWith("interpret"))[1];
    expect(JSON.parse(latest![1]!.body as string)).not.toHaveProperty("draft");
  });
  it("cancels SPA links and Back while the main composer has unsaved text", async () => {
    setupFetch(); const user = userEvent.setup();
    window.history.replaceState({ marker: "main" }, "", "/");
    renderNow(); await screen.findByRole("button", { name: "Обновить" });
    await user.type(screen.getByRole("textbox"), "Не закончил мысль");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = screen.getByRole("link", { name: "Расширенный поиск" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click); expect(click.defaultPrevented).toBe(true);
    window.history.replaceState({ marker: "other" }, "", "/people");
    window.dispatchEvent(new PopStateEvent("popstate", { state: { marker: "other" } }));
    expect(window.location.pathname).toBe("/");
    expect(window.history.state).toEqual({ marker: "main" });
    expect(screen.getByRole("textbox")).toHaveValue("Не закончил мысль");
    expect(confirm).toHaveBeenCalledTimes(2); confirm.mockRestore();
  });
  it("clears stale room controls after a blocked room becomes inaccessible", async () => {
    let blocked = false;
    setupFetch((path) => {
      if (path === `/api/intavro/rooms/${key}`) return blocked ? response({ error: { code: "NOT_FOUND" } }, 404) : response({ room });
      if (path.includes("/messages")) return response({ messages: [], nextBefore: null });
    });
    render(<RoomScreen roomKey={key} />); await screen.findByRole("textbox", { name: "Сообщение" });
    blocked = true; await act(async () => { await live.refresh?.(); });
    expect(screen.queryByRole("textbox", { name: "Сообщение" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/недоступен/);
    expect(screen.getByRole("button", { name: "Попробовать снова" })).toBeInTheDocument();
  });
  it("clears send authority and room content on a deleted-profile refresh", async () => {
    let deleted = false;
    setupFetch((path) => {
      if (path === "/api/social/profile") return deleted ? response({ error: { code: "UNAUTHORIZED" } }, 401) : response({ profile });
      if (path === `/api/intavro/rooms/${key}`) return response({ room });
      if (path.includes("/messages")) return response({ messages: [{ publicKey: key, text: "Привет, Саша", createdAt: "2026-10-05T18:00:00Z", isMine: false, identity: profile }], nextBefore: null });
    });
    render(<RoomScreen roomKey={key} />); await screen.findByText("Привет, Саша");
    deleted = true; fireEvent(window, new Event("veya:social-profile-changed"));
    await screen.findByRole("heading", { name: "Начните со своего намерения" });
    expect(screen.queryByText("Привет, Саша")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Сообщение" })).not.toBeInTheDocument();
  });
});
