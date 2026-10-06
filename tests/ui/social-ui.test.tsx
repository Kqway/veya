// @vitest-environment jsdom
import { act, cleanup, render as baseRender, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { RecoveryKeyProvider, useRecoveryKey } from "@/features/social/components/recovery-key-provider";
const render = (ui: ReactNode) => baseRender(<RecoveryKeyProvider>{ui}</RecoveryKeyProvider>);
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProfilePanel } from "@/features/social/components/profile-panel";
import { SeekingForm } from "@/features/social/components/seeking-form";
import { MatchScreen } from "@/features/social/components/match-screen";
import { IntentComposer } from "@/features/intents/components/intent-composer";
import type { Profile } from "@/features/social/client";
const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: { reload: undefined as undefined | (() => Promise<void>) } }));
vi.mock("@/features/realtime/client", () => ({ useSocialRefresh: (_topics: unknown, reload: () => Promise<void>) => { refresh.reload = reload; return {status: "inactive", reconnect: vi.fn()}; } }));
vi.mock("@/features/notifications/components", () => ({ NotificationBadge: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const profile = {
  alias: "Maple",
  privacyMode: "INCOGNITO" as const,
  avatarSeed: "randomseed",
  ageBand: null,
  languages: ["en"],
  hasRecoveryKey: true,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  push.mockClear();
  refresh.reload = undefined;
});
it.each([429, 503])("keeps failed activity loading distinct from an empty list and retries explicitly (%s)", async (status) => {
  const { DiscoverScreen } = await import("@/features/social/components/discover-screen");
  const post = { publicKey: "p".repeat(24), status: "active", activityLabel: "Chess" };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(json({ profile }))
    .mockResolvedValueOnce(json({ error: { code: status === 429 ? "RATE_LIMITED" : "SERVICE_UNAVAILABLE" } }, status))
    .mockResolvedValueOnce(json({ profile }))
    .mockResolvedValueOnce(json({ posts: [post] }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<DiscoverScreen />);
  await screen.findByRole("alert");
  expect(screen.queryByText(/Активных заявок на занятие пока нет/)).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Ваша активная заявка" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Загрузить занятия снова" }));
  expect(await screen.findByRole("combobox", { name: "Ваша активная заявка" })).toHaveValue(post.publicKey);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it.each(["profile", "posts", "created"])("ignores a late %s response after profile deletion", async (phase) => {
  const { DiscoverScreen } = await import("@/features/social/components/discover-screen");
  let release!: (response: Response) => void;
  const deferred = new Promise<Response>(resolve => { release = resolve; });
  let profileReads = 0, postReads = 0;
  const fetcher = vi.fn((path: string, options?: RequestInit): Promise<Response> => {
    if (options?.method === "DELETE") return Promise.resolve(json({ deleted: true }));
    if (path === "/api/session") return Promise.resolve(json({ authenticated: true }));
    if (path === "/api/social/profile" && options?.method === "POST") return Promise.resolve(json({ profile, recoveryKey: "Q".repeat(43) }));
    if (path === "/api/social/profile") {
      profileReads++;
      return phase === "profile" && profileReads === 2 ? deferred : Promise.resolve(json({ profile: phase === "created" ? null : profile }));
    }
    postReads++;
    if (phase !== "created" && postReads === 1) return Promise.resolve(json({ error: { code: "RATE_LIMITED" } }, 429));
    if (phase !== "profile") return deferred;
    return Promise.resolve(json({ posts: [{ publicKey: "p".repeat(24), status: "active", activityLabel: "Old activity" }] }));
  });
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<DiscoverScreen />);
  if (phase === "created") {
    await user.type(await screen.findByLabelText("Псевдоним"), "Maple");
    await user.click(screen.getByLabelText("Мне исполнилось 18 лет"));
    await user.click(screen.getByRole("button", { name: "Создать профиль" }));
    await user.click(await screen.findByRole("button", { name: "Ключ сохранён" }));
    await waitFor(() => expect(postReads).toBe(1));
  } else {
    await user.click(await screen.findByRole("button", { name: "Загрузить занятия снова" }));
    await waitFor(() => expect(profileReads).toBe(2));
    if (phase === "posts") await waitFor(() => expect(postReads).toBe(2));
  }
  await user.click(screen.getByRole("button", { name: "Удалить профиль Veya" }));
  await user.type(screen.getByLabelText("Введите DELETE для подтверждения"), "DELETE");
  await user.click(screen.getByRole("button", { name: "Удалить профиль навсегда" }));
  expect(await screen.findByRole("button", { name: "Создать профиль" })).toBeVisible();
  await act(async () => {
    release(json(phase === "profile" ? { profile } : { posts: [{ publicKey: "p".repeat(24), status: "active", activityLabel: "Old activity" }] }));
  });
  expect(screen.getByRole("button", { name: "Создать профиль" })).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "Ваша активная заявка" })).not.toBeInTheDocument();
  expect(screen.queryByText("Old activity")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(postReads).toBe(phase === "posts" ? 2 : 1);
});
it("requires explicit adult consent and shows a selectable one-time key without storing it", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ authenticated: true }))
    .mockResolvedValueOnce(json({ profile, recoveryKey: "K".repeat(43) }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<ProfilePanel profile={null} onProfile={() => {}} />);
  expect(screen.getByLabelText("Языки профиля (необязательно)")).toHaveValue("ru");
  expect(screen.getByRole("option", { name: "Открытый" })).toHaveValue("OPEN");
  expect(screen.getByRole("option", { name: "Приватный" })).toHaveValue("PRIVATE");
  expect(screen.getByRole("option", { name: "Инкогнито" })).toHaveValue("INCOGNITO");
  await user.type(screen.getByLabelText("Псевдоним"), "Maple");
  await user.click(screen.getByRole("button", { name: "Создать профиль" }));
  expect(screen.getByRole("alert")).toHaveTextContent("18 лет");
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText("Мне исполнилось 18 лет"));
  await user.click(screen.getByRole("button", { name: "Создать профиль" }));
  expect(await screen.findByLabelText("Ключ Veya")).toHaveValue("K".repeat(43));
  expect(screen.getByLabelText("Ключ Veya")).toHaveAttribute("readonly");
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "Ключ сохранён" }));
  expect(screen.queryByLabelText("Ключ Veya")).not.toBeInTheDocument();
});
it("previews AI fields before reviewed apply and leaves manual availability required", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      json({
        data: {
          activityKey: "chess",
          activityLabel: "Chess",
          interactionMode: "online",
          format: "one_to_one",
          city: null,
          area: null,
          skill: "casual",
          languages: ["en"],
          tags: [],
          timeHint: "Tomorrow",
        },
        source: "mock",
      }),
    ),
  );
  const user = userEvent.setup();
  render(<SeekingForm profile={profile} />);
  await user.type(
    screen.getByLabelText("Чем хотите заняться?"),
    "Play chess",
  );
  await user.type(
    screen.getByLabelText("Название занятия"),
    "My manual activity",
  );
  await user.click(screen.getByRole("button", { name: "Помочь с заполнением" }));
  expect(
    await screen.findByRole("heading", { name: "Предложенные сведения" }),
  ).toBeInTheDocument();
  const preview = screen.getByRole("region", { name: "Проверка предложения" });
  expect(within(preview).getByText("Код занятия")).toBeVisible();
  expect(within(preview).getByText("Онлайн")).toBeVisible();
  expect(within(preview).getByText("Вдвоём")).toBeVisible();
  expect(within(preview).getByText("Любитель")).toBeVisible();
  const aiBody = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
  expect(aiBody.referenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(screen.getByLabelText("Название занятия")).toHaveValue(
    "My manual activity",
  );
  await user.click(
    screen.getByRole("button", { name: "Применить проверенное предложение" }),
  );
  expect(screen.getByLabelText("Название занятия")).toHaveValue("Chess");
  await user.click(screen.getByRole("button", { name: "Создать заявку на занятие" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Выберите хотя бы один подходящий промежуток времени",
  );
});
it("renders chat as plain text and requires match-only disclosure consent", async () => {
  const fetcher = vi.fn<
    (path: string, options: RequestInit) => Promise<Response>
  >((path: string) =>
    Promise.resolve(
      json(
        path.endsWith("/messages?limit=30")
          ? {
              messages: [
                {
                  publicKey: "msg",
                  text: '<img src=x onerror="alert(1)">',
                  createdAt: new Date().toISOString(),
                  isMine: false,
                  identity: { alias: "Birch", avatarSeed: "seed" },
                },
              ],
              nextBefore: null,
            }
          : {
              publicKey: "match",
              status: "active",
              identity: { alias: "Birch", avatarSeed: "seed" },
              ownIdentity: { alias: "Maple", avatarSeed: "seed2" },
              activityLabel: "Chess",
              disclosures: [],
              planSlug: null,
            },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  const { container } = render(<MatchScreen matchKey="match" />);
  expect(
    await screen.findByText('<img src=x onerror="alert(1)">'),
  ).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
  await user.type(screen.getByLabelText("Сведения для передачи"), "Sam");
  await user.click(screen.getByRole("button", { name: "Поделиться сведениями" }));
  expect(screen.getByRole("alert")).toHaveTextContent("согласие");
  expect(
    fetcher.mock.calls.some(([path]) => path.endsWith("/disclosures")),
  ).toBe(false);
  await user.click(screen.getByLabelText("Я понимаю и даю согласие"));
  await user.click(screen.getByRole("button", { name: "Поделиться сведениями" }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([path]) => path.endsWith("/disclosures")),
    ).toBe(true),
  );
});
it("keeps the social draft out of the URL and preserves coordination action", async () => {
  const user = userEvent.setup();
  render(<IntentComposer />);
  await user.type(
    screen.getByLabelText("Чем хотите заняться?"),
    "Chess near me",
  );
  await user.click(
    screen.getByRole("button", { name: "Найти людей" }),
  );
  expect(push).toHaveBeenCalledWith("/seek/new");
  expect(sessionStorage.getItem("veya.social.draft")).toBe("Chess near me");
  expect(
    screen.getByRole("button", { name: "Создать план" }),
  ).toBeInTheDocument();
});

it.each([["chess", "Chess"], ["pottery", "Pottery"]])("submits a complete manual %s seeking form with selected local times", async (activityKey, activityLabel) => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(json({ publicKey: "P".repeat(24) }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<SeekingForm profile={profile} />);
  expect(screen.getByLabelText("Языки")).toHaveValue("ru");
  await user.type(
    screen.getByLabelText("Чем хотите заняться?"),
    "Play chess online",
  );
  await user.type(screen.getByLabelText("Код занятия"), activityKey);
  await user.type(screen.getByLabelText("Название занятия"), activityLabel);
  await user.selectOptions(screen.getByLabelText("Способ встречи"), "online");
  await user.click(screen.getAllByRole("button", { name: /^Вечер / })[1]!);
  await user.click(screen.getByRole("button", { name: "Создать заявку на занятие" }));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith(`/seek/${"P".repeat(24)}`),
  );
  const body = JSON.parse(fetcher.mock.calls[0]![1].body);
  expect(body).toMatchObject({
    rawText: "Play chess online",
    activityKey,
    interactionMode: "online",
    city: null,
    privacyMode: "INCOGNITO",
    languages: ["ru"],
  });
  expect(body.availability).toHaveLength(1);
  expect(
    Math.abs(Date.parse(body.expiresAt) - Date.now() - 7 * 86_400_000),
  ).toBeLessThan(15_000);
  expect(Date.parse(body.availability[0].endAt)).toBeGreaterThan(
    Date.parse(body.availability[0].startAt),
  );
});

it("uses discovery handles and readable compatibility reasons to send interest", async () => {
  const { DiscoverScreen } = await import(
    "@/features/social/components/discover-screen"
  );
  const post = {
    publicKey: "P".repeat(24),
    activityLabel: "Chess",
    status: "active",
  };
  const fetcher = vi.fn<
    (path: string, options: RequestInit) => Promise<Response>
  >((path: string) =>
    Promise.resolve(
      json(
        path.endsWith("/profile")
          ? { profile }
          : path.endsWith("/seeking")
            ? { posts: [post] }
            : path.includes("/discover?")
              ? {
                  cards: [
                    {
                      handle: "H".repeat(24),
                      identity: { alias: "Pine", avatarSeed: "random" },
                      activityLabel: "Chess",
                      interactionMode: "online",
                      format: "one_to_one",
                      reasons: [
                        "SAME_ACTIVITY",
                        "TIME_OVERLAP",
                        "SECRET_SCORE_999",
                      ],
                      timeHint: "Compatible tomorrow",
                    },
                  ],
                }
              : { publicKey: "request", status: "pending", matchKey: null },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<DiscoverScreen />);
  await user.click(await screen.findByRole("button", { name: "Найти людей" }));
  expect(
    await screen.findByText("Вы хотите заниматься одним и тем же"),
  ).toBeInTheDocument();
  expect(screen.queryByText("SECRET_SCORE_999")).not.toBeInTheDocument();
  expect(screen.getByText("Подходит завтра")).toBeVisible();
  expect(screen.queryByText("Compatible tomorrow")).not.toBeInTheDocument();
  expect(screen.getByText("Pine")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Хочу присоединиться" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Запрос отправлен");
  expect(
    screen.queryByRole("button", { name: "Хочу присоединиться" }),
  ).not.toBeInTheDocument();
  const interest = fetcher.mock.calls.find(([path]) =>
    path.endsWith("/connections"),
  );
  expect(JSON.parse(interest![1].body as string)).toEqual({
    handle: "H".repeat(24),
  });
});

it("keeps interest actionable during background discovery and ignores stale candidate results", async () => {
  const { DiscoverScreen } = await import("@/features/social/components/discover-screen");
  const post = { publicKey: "P".repeat(24), activityLabel: "Chess", status: "active" };
  const card = { handle: "H".repeat(24), identity: { alias: "Pine", avatarSeed: "random" }, activityLabel: "Chess", interactionMode: "online", format: "one_to_one", reasons: ["SAME_ACTIVITY"], timeHint: "Compatible tomorrow" };
  let release!: (response: Response) => void;
  const deferred = new Promise<Response>(resolve => { release = resolve; });
  let reads = 0;
  const fetcher = vi.fn((path: string): Promise<Response> => {
    if (path.endsWith("/profile")) return Promise.resolve(json({ profile }));
    if (path.endsWith("/seeking")) return Promise.resolve(json({ posts: [post] }));
    if (path.includes("/discover?")) return ++reads === 1 ? Promise.resolve(json({ cards: [card] })) : deferred;
    return Promise.resolve(json({ publicKey: "request", status: "pending", matchKey: null }));
  });
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<DiscoverScreen />);
  await user.click(await screen.findByRole("button", { name: "Найти людей" }));
  await screen.findByRole("button", { name: "Хочу присоединиться" });
  let background!: Promise<void>;
  await act(async () => { background = refresh.reload!(); });
  expect(reads).toBe(2);
  expect(screen.getByRole("button", { name: "Хочу присоединиться" })).toBeEnabled();
  expect(screen.queryByText("Выполняем…")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Хочу присоединиться" }));
  await screen.findByText(/Запрос отправлен\./);
  await act(async () => { release(json({ cards: [card] })); await background; });
  expect(screen.queryByRole("button", { name: "Хочу присоединиться" })).not.toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith("/connections"))).toHaveLength(1);
});

it("accepts during a background connection read and cannot regress to pending", async () => {
  const { ConnectionsScreen } = await import("@/features/social/components/connections-screen");
  const request = { publicKey: "R".repeat(24), direction: "incoming", status: "pending", identity: { alias: "Pine", avatarSeed: "random" }, activityLabel: "Chess", matchKey: null };
  let release!: (response: Response) => void;
  const deferred = new Promise<Response>(resolve => { release = resolve; });
  let reads = 0;
  const fetcher = vi.fn((path: string, options?: RequestInit): Promise<Response> => {
    if (options?.method === "POST") return Promise.resolve(json({ publicKey: request.publicKey, status: "accepted", matchKey: "M".repeat(24) }));
    return ++reads === 1 ? Promise.resolve(json({ requests: [request] })) : deferred;
  });
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<ConnectionsScreen />);
  await screen.findByRole("button", { name: "Принять" });
  let background!: Promise<void>;
  await act(async () => { background = refresh.reload!(); });
  expect(reads).toBe(2);
  expect(screen.getByRole("button", { name: "Принять" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Принять" }));
  expect(await screen.findByRole("link", { name: "Открыть чат" })).toHaveAttribute("href", `/m/${"M".repeat(24)}`);
  await act(async () => { release(json({ requests: [request] })); await background; });
  expect(screen.queryByRole("button", { name: "Принять" })).not.toBeInTheDocument();
  expect(screen.getByText("Статус: Принят")).toBeVisible();
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
});
it("sends during a background conversation read without losing the message to stale history", async () => {
  const match = { publicKey: "M".repeat(24), status: "active", identity: { alias: "Pine", avatarSeed: "random" }, ownIdentity: { alias: "Maple", avatarSeed: "mine" }, activityLabel: "Chess", disclosures: [], planSlug: null };
  const message = { publicKey: "N".repeat(24), text: "See you tomorrow", createdAt: new Date().toISOString(), isMine: true, identity: match.ownIdentity };
  let release!: (response: Response) => void;
  const deferred = new Promise<Response>(resolve => { release = resolve; });
  let reads = 0;
  const fetcher = vi.fn((path: string, options?: RequestInit): Promise<Response> => {
    if (options?.method === "POST") return Promise.resolve(json(message));
    if (path.includes("/messages?")) return ++reads === 1 ? Promise.resolve(json({ messages: [], nextBefore: null })) : deferred;
    return Promise.resolve(json(match));
  });
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<MatchScreen matchKey={match.publicKey} />);
  await screen.findByText("Сообщений пока нет. Начните с общего занятия.");
  await user.type(screen.getByLabelText("Сообщение"), message.text);
  let background!: Promise<void>;
  await act(async () => { background = refresh.reload!(); });
  expect(reads).toBe(2);
  expect(screen.getByRole("button", { name: "Отправить сообщение" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Отправить сообщение" }));
  await screen.findByText(message.text);
  await act(async () => { release(json({ messages: [], nextBefore: null })); await background; });
  expect(screen.getByRole("list", { name: "Сообщения чата" })).toHaveTextContent(message.text);
  expect(screen.getByLabelText("Сообщение")).toHaveValue("");
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
});

it("offers inline onboarding for a new guest without creating a profile on mount", async () => {
  const { NewSeekScreen } = await import(
    "@/features/social/components/seek-screen"
  );
  const fetcher = vi
    .fn()
    .mockResolvedValue(json({ error: { code: "UNAUTHORIZED" } }, 401));
  vi.stubGlobal("fetch", fetcher);
  render(<NewSeekScreen />);
  expect(
    await screen.findByRole("button", { name: "Создать профиль" }),
  ).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![1].method).toBe("GET");
});

it("does not request messages after a match screen unmounts during its initial read", async () => {
  let resolve: ((value: Response) => void) | undefined;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const mounted = render(<MatchScreen matchKey="match" />);
  expect(fetcher).toHaveBeenCalledTimes(1);
  mounted.unmount();
  resolve!(json({ publicKey: "match", status: "active" }));
  await Promise.resolve();
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("explains the 14-window social limit when a fifteenth time is selected", async () => {
  const user = userEvent.setup();
  render(<SeekingForm profile={profile} />);
  for (let day = 1; day <= 5; day++) {
    for (const period of ["Утро", "День", "Вечер"]) {
      await user.click(
        screen.getAllByRole("button", { name: new RegExp(`^${period} `) })[
          day
        ]!,
      );
    }
  }
  expect(screen.getByRole("alert")).toHaveTextContent("не более 14 временных интервалов");
  expect(
    screen.getByRole("list", { name: "Выбранное свободное время" }).children,
  ).toHaveLength(14);
});

it("recovers from a new unbound guest and restores editable profile choices after saving the rotated key", async () => {
  const { NewSeekScreen } = await import(
    "@/features/social/components/seek-screen"
  );
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ error: { code: "UNAUTHORIZED" } }, 401))
    .mockResolvedValueOnce(json({ authenticated: true }))
    .mockResolvedValueOnce(json({ profile, recoveryKey: "R".repeat(43) }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<NewSeekScreen />);
  await user.click(
    await screen.findByRole("button", { name: "Восстановить с помощью Ключа Veya" }),
  );
  await user.type(screen.getByLabelText("Ключ восстановления"), "O".repeat(43));
  await user.click(screen.getByRole("button", { name: "Восстановить профиль" }));
  expect(await screen.findByLabelText("Ключ Veya")).toHaveValue("R".repeat(43));
  await user.click(screen.getByRole("button", { name: "Ключ сохранён" }));
  expect(screen.getByLabelText("Псевдоним")).toHaveValue("Maple");
  expect(screen.getByLabelText("Приватность")).toHaveValue("INCOGNITO");
  expect(screen.getByLabelText("Языки профиля (необязательно)")).toHaveValue(
    "en",
  );
  expect(JSON.parse(fetcher.mock.calls[2]![1].body)).toEqual({
    key: "O".repeat(43),
  });
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it("keeps an unsaved recovery key visible after a client route unmounts the profile screen", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({authenticated: true})).mockResolvedValueOnce(json({ profile, recoveryKey: "N".repeat(43) })));
  function Routes() {
    const [profilePage, setProfilePage] = useState(true);
    return <>{profilePage && <ProfilePanel profile={null} onProfile={() => {}} />}<button onClick={() => setProfilePage(false)}>Next route</button></>;
  }
  const user = userEvent.setup();
  render(<Routes />);
  await user.type(screen.getByLabelText("Псевдоним"), "Maple");
  await user.click(screen.getByLabelText("Мне исполнилось 18 лет"));
  await user.click(screen.getByRole("button", {name: "Создать профиль"}));
  expect(await screen.findByLabelText("Ключ Veya")).toHaveValue("N".repeat(43));
  await user.click(screen.getByRole("button", {name: "Next route"}));
  expect(screen.getByLabelText("Ключ Veya")).toHaveValue("N".repeat(43));
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  await user.click(screen.getByRole("button", {name: "Ключ сохранён"}));
  expect(screen.queryByLabelText("Ключ Veya")).not.toBeInTheDocument();
});
it("delivers an issued key and activates live social after the initiating screen unmounts", async () => {
  const dispatch = vi.spyOn(window, "dispatchEvent");
  let finish!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => { finish = resolve; });
  const fetcher = vi.fn().mockResolvedValueOnce(json({ authenticated: true })).mockReturnValueOnce(response);
  vi.stubGlobal("fetch", fetcher);
  function Routes() {
    const [show, setShow] = useState(true);
    return <>{show && <ProfilePanel profile={null} onProfile={() => {}} />}<button onClick={() => setShow(false)}>Next route</button></>;
  }
  const user = userEvent.setup();
  render(<Routes />);
  await user.type(screen.getByLabelText("Псевдоним"), "Maple");
  await user.click(screen.getByLabelText("Мне исполнилось 18 лет"));
  await user.click(screen.getByRole("button", { name: "Создать профиль" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole("button", { name: "Next route" }));
  finish(json({ profile, recoveryKey: "L".repeat(43) }));
  expect(await screen.findByLabelText("Ключ Veya")).toHaveValue("L".repeat(43));
  expect(dispatch.mock.calls.filter(([event]) => event.type === "veya:social-profile-changed")).toHaveLength(1);
});

function IssueKey() {
  const { showKey } = useRecoveryKey();
  return <button onClick={() => showKey("C".repeat(43))}>Issue key</button>;
}
it("copies a key but keeps it unsaved until explicit acknowledgement", async () => {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<IssueKey />);
  await user.click(screen.getByRole("button", { name: "Issue key" }));
  await user.click(screen.getByRole("button", { name: "Скопировать Ключ Veya" }));
  expect(writeText).toHaveBeenCalledWith("C".repeat(43));
  expect(await screen.findByRole("status")).toHaveTextContent("Ключ скопирован");
  expect(screen.getByLabelText("Ключ Veya")).toHaveValue("C".repeat(43));
  expect(screen.getByText(/потеряете и ключ, и сессию браузера/)).toBeVisible();
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "Ключ сохранён" }));
  const savedLeaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(savedLeaving);
  expect(savedLeaving.defaultPrevented).toBe(false);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(window.location.href).not.toContain("C".repeat(43));
});
it("does not restore a copy notice after an acknowledged key is cleared", async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => new Promise<void>((resolve) => { finish = resolve; }) } });
  render(<IssueKey />);
  await user.click(screen.getByRole("button", { name: "Issue key" }));
  await user.click(screen.getByRole("button", { name: "Скопировать Ключ Veya" }));
  await user.click(screen.getByRole("button", { name: "Ключ сохранён" }));
  await user.click(screen.getByRole("button", { name: "Issue key" }));
  finish();
  await Promise.resolve();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("offers manual copying when clipboard access fails without showing the clipboard error", async () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("secret clipboard provider detail")) } });
  render(<IssueKey />);
  await user.click(screen.getByRole("button", { name: "Issue key" }));
  await user.click(screen.getByRole("button", { name: "Скопировать Ключ Veya" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Выделите ключ и скопируйте его вручную");
  expect(screen.getByLabelText("Ключ Veya")).toHaveValue("C".repeat(43));
  expect(screen.queryByText(/secret clipboard provider detail/)).not.toBeInTheDocument();
});
it("requires an exact destructive confirmation and deletes only the current profile", async () => {
  const fetcher = vi.fn().mockResolvedValue(json({ deleted: true }));
  vi.stubGlobal("fetch", fetcher);
  const changed = vi.spyOn(window, "dispatchEvent");
  const user = userEvent.setup();
  function ProfileState() {
    const [current, setCurrent] = useState<Profile | null>(profile);
    return <ProfilePanel profile={current} onProfile={setCurrent} />;
  }
  render(<ProfileState />);
  await user.click(screen.getByRole("button", { name: "Удалить профиль Veya" }));
  expect(screen.getByText(/действие нельзя отменить/)).toHaveTextContent("Материалы для модерации");
  const confirm = screen.getByRole("button", { name: "Удалить профиль навсегда" });
  expect(confirm).toBeDisabled();
  await user.type(screen.getByLabelText("Введите DELETE для подтверждения"), "delete");
  expect(confirm).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Отменить удаление" }));
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Удалить профиль Veya" }));
  expect(screen.getByLabelText("Введите DELETE для подтверждения")).toHaveValue("");
  await user.type(screen.getByLabelText("Введите DELETE для подтверждения"), "DELETE");
  await user.click(screen.getByRole("button", { name: "Удалить профиль навсегда" }));
  expect(await screen.findByRole("button", { name: "Создать профиль" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Ваш профиль Veya удалён.");
  expect(screen.getByLabelText("Псевдоним")).toHaveValue("");
  expect(screen.getByLabelText("Языки профиля (необязательно)")).toHaveValue("ru");
  expect(fetcher).toHaveBeenCalledWith("/api/social/profile", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ confirmation: "DELETE" }) }));
  expect(changed.mock.calls.some(([event]) => event.type === "veya:social-profile-changed")).toBe(true);
});
it("preserves the profile when deletion fails and allows an explicit retry", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json({ error: { code: "SERVICE_UNAVAILABLE" } }, 503)).mockResolvedValueOnce(json({ deleted: true }));
  vi.stubGlobal("fetch", fetcher);
  const onProfile = vi.fn();
  const user = userEvent.setup();
  render(<ProfilePanel profile={profile} onProfile={onProfile} />);
  await user.click(screen.getByRole("button", { name: "Удалить профиль Veya" }));
  await user.type(screen.getByLabelText("Введите DELETE для подтверждения"), "DELETE");
  await user.click(screen.getByRole("button", { name: "Удалить профиль навсегда" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/попробуйте ещё раз/i);
  expect(onProfile).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Псевдоним")).toHaveValue("Maple");
  await user.click(screen.getByRole("button", { name: "Удалить профиль навсегда" }));
  await waitFor(() => expect(onProfile).toHaveBeenCalledWith(null));
});

it.each(["seek", "discover"])("offers profile deletion to an unavailable owner on %s without unusable onboarding", async (surface) => {
  const { NewSeekScreen } = await import("@/features/social/components/seek-screen");
  const { DiscoverScreen } = await import("@/features/social/components/discover-screen");
  const fetcher = vi.fn().mockResolvedValueOnce(json({ error: { code: "FORBIDDEN" } }, 403)).mockResolvedValueOnce(json({ deleted: true }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(surface === "seek" ? <NewSeekScreen /> : <DiscoverScreen />);
  await user.click(await screen.findByRole("button", { name: "Удалить профиль Veya" }));
  expect(screen.queryByRole("button", { name: "Создать профиль" })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Введите DELETE для подтверждения"), "DELETE");
  await user.click(screen.getByRole("button", { name: "Удалить профиль навсегда" }));
  expect(await screen.findByRole("button", { name: "Создать профиль" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Ваш профиль Veya удалён.");
});
it("explains an invalid or revoked recovery key without erasing the entered key", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json({ authenticated: true })).mockResolvedValueOnce(json({ error: { code: "NOT_FOUND" } }, 404));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<ProfilePanel profile={null} onProfile={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Восстановить с помощью Ключа Veya" }));
  await user.type(screen.getByLabelText("Ключ восстановления"), "O".repeat(43));
  await user.click(screen.getByRole("button", { name: "Восстановить профиль" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Этот Ключ Veya недействителен или больше не активен");
  expect(screen.getByLabelText("Ключ восстановления")).toHaveValue("O".repeat(43));
  expect(screen.getByRole("alert")).not.toHaveTextContent("O".repeat(43));
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
