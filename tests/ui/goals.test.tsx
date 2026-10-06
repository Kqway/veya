// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { GoalHome } from "@/features/goals/components/home";
import {
  ApprovalPanel,
  GoalStatus,
  MoneyProgress,
  Timeline,
} from "@/features/goals/components/primitives";
import { RecoveryKeyProvider } from "@/features/social/components/recovery-key-provider";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
}));
vi.mock("@/features/realtime/client", () => ({
  useSocialRefresh: () => ({
    status: "live",
    profileActive: true,
    reconnect: vi.fn(),
  }),
}));
const key = "AAAAAAAAAAAAAAAAAAAAAAAA";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
});

it("starts with an empty intent surface and explicitly labels simulated money", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ goals: [] })),
  );
  render(
    <RecoveryKeyProvider>
      <GoalHome />
    </RecoveryKeyProvider>,
  );
  expect(
    screen.getByRole("heading", { name: "Что должно произойти?" }),
  ).toBeVisible();
  expect(
    screen.getByRole("textbox", { name: "Что должно произойти?" }),
  ).toBeVisible();
  expect(screen.getByText(/Клиенты и платежи симулируются/)).toBeVisible();
  await waitFor(() =>
    expect(screen.queryByText("Загружаю цели…")).not.toBeInTheDocument(),
  );
  expect(screen.queryByText(/Найдено .* возможностей/)).not.toBeInTheDocument();
});

it("creates a persisted demo goal from the phrase and opens its process", async () => {
  const fetcher = vi.fn(async (path: string, init?: RequestInit) =>
    json(
      path === "/api/social/profile"
        ? { profile: { alias: "Owner" } }
        : path === "/api/agent/goals"
          ? init?.method === "POST"
            ? { goal: { publicKey: key } }
            : { goals: [] }
          : {},
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <RecoveryKeyProvider>
      <GoalHome />
    </RecoveryKeyProvider>,
  );
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Что должно произойти?" }),
    "Заработай 10000 ₽",
  );
  await user.click(screen.getByRole("button", { name: "Начать" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith(`/goals/${key}`));
  const create = fetcher.mock.calls.find(
    (call) =>
      call[0] === "/api/agent/goals" &&
      (call[1] as RequestInit | undefined)?.method === "POST",
  );
  expect(JSON.parse((create?.[1] as RequestInit).body as string)).toMatchObject(
    { text: "Заработай 10000 ₽", environment: "demo" },
  );
});

it("preserves the phrase when the service fails and offers a retry", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path === "/api/agent/goals"
        ? json({ error: { code: "UNAVAILABLE" } }, 503)
        : json({ profile: { alias: "Owner" } }),
    ),
  );
  render(
    <RecoveryKeyProvider>
      <GoalHome />
    </RecoveryKeyProvider>,
  );
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Что должно произойти?" }),
    "Найди стажировку",
  );
  await user.click(screen.getByRole("button", { name: "Начать" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("textbox")).toHaveValue("Найди стажировку");
  expect(push).not.toHaveBeenCalled();
});

it("shows confirmed money only and distinct waiting state", () => {
  render(
    <>
      <MoneyProgress confirmed={600000} target={1000000} currency="RUB" />
      <GoalStatus status="WAITING_EXTERNAL" />
    </>,
  );
  expect(screen.getByText(/6.?000/)).toBeVisible();
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "60",
  );
  expect(screen.getByText("Ожидаю")).toBeVisible();
});

it("renders external text as plain timeline content", () => {
  render(
    <Timeline
      events={[
        {
          publicKey: key,
          type: "TOOL_COMPLETED",
          description: "<script>steal()</script>",
          evidenceRef: "mock:receipt",
          createdAt: "2026-10-05T12:00:00Z",
        },
      ]}
    />,
  );
  expect(screen.getByText("<script>steal()</script>")).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
});

it("approves only the selected immutable action and does not offer unlimited financial autonomy", async () => {
  const decide = vi.fn(async () => {});
  render(
    <ApprovalPanel
      approval={{
        publicKey: key,
        action: "create_invoice",
        description: "Создать демо-счёт на 6 000 ₽",
        status: "pending",
        amountMinor: 600000,
        currency: "RUB",
        createdAt: "2026-10-05T12:00:00Z",
        expiresAt: "2099-01-01T00:00:00Z",
      }}
      busy={false}
      onDecision={decide}
    />,
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Разрешить" }));
  expect(decide).toHaveBeenCalledWith(key, "approve");
  expect(screen.queryByText(/Всегда разрешать/)).not.toBeInTheDocument();
});

it.each([401, 403, 404])(
  "clears private data after authorization changes in another tab (%s)",
  async (status) => {
    const { useGoalResource } =
      await import("@/features/goals/components/client");
    function View() {
      const result = useGoalResource<{ secret: string }>("/goals/" + key);
      return (
        <>
          <p>{result.data?.secret}</p>
          {result.error && <p role="alert">{result.error}</p>}
          <button onClick={() => void result.reload()}>Refresh</button>
        </>
      );
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ secret: "Private goal title" }))
      .mockResolvedValueOnce(json({ error: { code: "UNAVAILABLE" } }, status));
    vi.stubGlobal("fetch", fetcher);
    render(<View />);
    expect(await screen.findByText("Private goal title")).toBeVisible();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Private goal title")).not.toBeInTheDocument();
  },
);
it("retries a failed goal creation after onboarding without creating identity again", async () => {
  const { GoalOnboarding } =
    await import("@/features/goals/components/onboarding");
  let created = false,
    posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/social/profile" && init?.method === "POST") {
        posts++;
        if (created) return json({ error: { code: "CONFLICT" } }, 409);
        created = true;
        return json({ profile: { alias: "Owner" } });
      }
      return json({ profile: created ? { alias: "Owner" } : null });
    }),
  );
  const ready = vi
    .fn()
    .mockRejectedValueOnce(new Error("temporary"))
    .mockResolvedValueOnce(undefined);
  render(
    <RecoveryKeyProvider>
      <GoalOnboarding onReady={ready} />
    </RecoveryKeyProvider>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Псевдоним" }), "Owner");
  await user.click(screen.getByLabelText("Мне исполнилось 18 лет"));
  await user.click(screen.getByLabelText("Я сам решаю, что раскрыть о себе"));
  await user.click(screen.getByRole("button", { name: "Продолжить" }));
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "Продолжить" }));
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
  expect(posts).toBe(1);
});

it("reloads settings and replaces stale identity fields when another tab changes profile", async () => {
  const { GoalSettings } = await import("@/features/goals/components/settings");
  const profile = {
    alias: "Profile A",
    avatarSeed: "a",
    privacyMode: "OPEN",
    ageBand: null,
    languages: ["ru"],
    hasRecoveryKey: true,
  };
  let replaced = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      json(
        path === "/api/social/profile"
          ? {
              profile: replaced
                ? {
                    ...profile,
                    alias: "Profile B",
                    avatarSeed: "b",
                    privacyMode: "PRIVATE",
                  }
                : profile,
            }
          : {},
      ),
    ),
  );
  render(
    <RecoveryKeyProvider>
      <GoalSettings />
    </RecoveryKeyProvider>,
  );
  await screen.findByRole("heading", { name: "Profile A" });
  replaced = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(
    await screen.findByRole("heading", { name: "Profile B" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Profile A" }),
  ).not.toBeInTheDocument();
});
