// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MatchScreen } from "@/features/social/components/match-screen";
import { ConnectionsScreen } from "@/features/social/components/connections-screen";
import { DiscoverScreen } from "@/features/social/components/discover-screen";
import type { Match } from "@/features/social/client";
import { RecoveryKeyProvider } from "@/features/social/components/recovery-key-provider";
const live = vi.hoisted(() => ({ reload: undefined as (() => Promise<void>) | undefined, status: "live", reconnect: vi.fn() }));
vi.mock("@/features/realtime/client", () => ({
  useSocialRefresh: (_topics: string[], callback: () => Promise<void>) => { live.reload = callback; return { status: live.status, reconnect: live.reconnect }; },
}));
vi.mock("@/features/notifications/components", () => ({ NotificationBadge: () => null }));
const json = (value: unknown) => new Response(JSON.stringify(value));
const match: Match = { publicKey: "match", status: "active", identity: { alias: "Birch", avatarSeed: "seed" }, ownIdentity: { alias: "Maple", avatarSeed: "other" }, activityLabel: "Chess", disclosures: [], planSlug: null };
const message = (publicKey: string, text: string, day: number) => ({ publicKey, text, createdAt: `2026-10-0${day}T12:00:00Z`, isMine: false, identity: match.identity });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); live.reload = undefined; live.status = "live"; live.reconnect.mockClear(); });
it("refreshes a conversation automatically without hiding already loaded older history or duplicating messages", async () => {
  let latest = false;
  vi.stubGlobal("fetch", vi.fn((path: string) => Promise.resolve(json(path.includes("before=") ? { messages: [message("old", "Older history", 1)], nextBefore: null } : path.includes("/messages?") ? { messages: latest ? [message("recent", "Recent message", 2), message("new", "New live message", 3)] : [message("recent", "Recent message", 2)], nextBefore: "cursor" } : match))));
  render(<MatchScreen matchKey="match" />);
  await screen.findByText("Recent message");
  await userEvent.setup().click(screen.getByRole("button", { name: "Загрузить предыдущие" }));
  await screen.findByText("Older history");
  latest = true;
  expect(live.reload).toBeDefined();
  await act(async () => { await live.reload!(); });
  expect(screen.getByText("Older history")).toBeVisible();
  expect(screen.getAllByText("Recent message")).toHaveLength(1);
  expect(screen.getByText("New live message")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Загрузить предыдущие" })).not.toBeInTheDocument();
});
it("reloads incoming requests and provides a finite live retry alongside manual refresh", async () => {
  let incoming = false;
  live.status = "offline";
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ requests: incoming ? [{ publicKey: "request", direction: "incoming", status: "pending", identity: match.identity, activityLabel: "Chess", matchKey: null }] : [] }))));
  render(<ConnectionsScreen />);
  await screen.findByText(/Запросов пока нет/);
  expect(screen.getByText(/Обновления в реальном времени недоступны/)).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Восстановить обновления" }));
  expect(live.reconnect).toHaveBeenCalledTimes(1);
  incoming = true;
  await act(async () => { await live.reload!(); });
  expect(screen.getByRole("button", { name: "Принять" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Обновить запросы" })).toBeVisible();
});
it("keeps an empty saved activity honest and refreshes new candidates without sending interest", async () => {
  let found = false;
  const fetcher = vi.fn((path: string) => Promise.resolve(json(path.endsWith("/profile") ? { profile: { alias: "Maple", privacyMode: "PRIVATE", avatarSeed: "seed", ageBand: null, languages: [], hasRecoveryKey: true } } : path.endsWith("/seeking") ? { posts: [{ publicKey: "source", activityLabel: "Chess", status: "active" }] } : { cards: found ? [{ handle: "candidate", identity: match.identity, activityLabel: "Chess", interactionMode: "online", format: "one_to_one", reasons: [], timeHint: "Compatible soon" }] : [] })));
  vi.stubGlobal("fetch", fetcher);
  render(<RecoveryKeyProvider><DiscoverScreen /></RecoveryKeyProvider>);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Найти людей" }));
  expect(await screen.findByText(/Ваша заявка сохранена до истечения срока действия/)).toHaveTextContent("Veya никогда не отправляет запрос «Хочу присоединиться» за вас.");
  found = true;
  await act(async () => { await live.reload!(); });
  expect(screen.getByRole("button", { name: "Хочу присоединиться" })).toBeVisible();
  expect(screen.getByText("Подходит в ближайшее время")).toBeVisible();
  await waitFor(() => expect(fetcher.mock.calls.every(([path]) => !path.endsWith("/connections"))).toBe(true));
});
it("reflects peer disclosures, linked plans and closure from the persistent match API", async () => {
  let current: Match = {...match,disclosures:[],planSlug:null};
  vi.stubGlobal("fetch", vi.fn((path: string) => Promise.resolve(json(path.includes("/messages?") ? {messages:[],nextBefore:null} : current))));
  render(<MatchScreen matchKey="match" />);
  await screen.findByRole("button", {name:"Отправить сообщение"});
  current = {...current,disclosures:[{kind:"first_name",value:"<script>peer disclosure</script>",isMine:false}],planSlug:"public-plan"};
  await act(async () => { await live.reload!(); });
  expect(screen.getByText(/Имя: <script>peer disclosure<\/script>/)).toBeVisible();
  expect(screen.getByRole("link",{name:"Открыть план"})).toHaveAttribute("href","/i/public-plan");
  expect(document.querySelector("script")).toBeNull();
  current = {...current,status:"closed",planSlug:null};
  await act(async () => { await live.reload!(); });
  expect(screen.getByText("Этот чат закрыт. Вы можете читать историю сообщений.")).toBeVisible();
  expect(screen.queryByRole("button",{name:"Отправить сообщение"})).not.toBeInTheDocument();
  expect(screen.queryByRole("link",{name:"Открыть план"})).not.toBeInTheDocument();
});

it("restores history pagination after a reconnect gap larger than the latest page",async()=>{
 let phase=0;
 vi.stubGlobal("fetch",vi.fn((path:string)=>Promise.resolve(json(path.includes("before=gap")?{messages:[message("middle","Previously missed middle message",3)],nextBefore:"older"}:path.includes("before=")?{messages:[message("old","Old history",1)],nextBefore:null}:path.includes("/messages?")?phase?{messages:Array.from({length:30},(_,i)=>message(`new${i}`,`Latest ${i}`,4)),nextBefore:"gap"}:{messages:[message("recent","Recent history",2)],nextBefore:"older"}:match))));
 render(<MatchScreen matchKey="match"/>);await screen.findByText("Recent history");
 await userEvent.setup().click(screen.getByRole("button",{name:"Загрузить предыдущие"}));await screen.findByText("Old history");
 phase=1;await act(async()=>{await live.reload!();});
 await userEvent.setup().click(screen.getByRole("button",{name:"Загрузить предыдущие"}));
 expect(await screen.findByText("Previously missed middle message")).toBeVisible();
});
