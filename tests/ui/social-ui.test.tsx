// @vitest-environment jsdom
import { cleanup, render as baseRender, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { RecoveryKeyProvider } from "@/features/social/components/recovery-key-provider";
const render = (ui: ReactNode) => baseRender(<RecoveryKeyProvider>{ui}</RecoveryKeyProvider>);
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProfilePanel } from "@/features/social/components/profile-panel";
import { SeekingForm } from "@/features/social/components/seeking-form";
import { MatchScreen } from "@/features/social/components/match-screen";
import { IntentComposer } from "@/features/intents/components/intent-composer";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/features/realtime/client", () => ({ useSocialRefresh: () => ({status: "inactive", reconnect: vi.fn()}) }));
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
});
it("requires explicit adult consent and shows a selectable one-time key without storing it", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ authenticated: true }))
    .mockResolvedValueOnce(json({ profile, recoveryKey: "K".repeat(43) }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<ProfilePanel profile={null} onProfile={() => {}} />);
  await user.type(screen.getByLabelText("Alias"), "Maple");
  await user.click(screen.getByRole("button", { name: "Create profile" }));
  expect(screen.getByRole("alert")).toHaveTextContent("18 or older");
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText("I am 18 or older"));
  await user.click(screen.getByRole("button", { name: "Create profile" }));
  expect(await screen.findByLabelText("Veya Key")).toHaveValue("K".repeat(43));
  expect(screen.getByLabelText("Veya Key")).toHaveAttribute("readonly");
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "I saved my key" }));
  expect(screen.queryByLabelText("Veya Key")).not.toBeInTheDocument();
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
    screen.getByLabelText("What do you want to do?"),
    "Play chess",
  );
  await user.type(
    screen.getByLabelText("Activity label"),
    "My manual activity",
  );
  await user.click(screen.getByRole("button", { name: "Help structure" }));
  expect(
    await screen.findByRole("heading", { name: "Suggested structure" }),
  ).toBeInTheDocument();
  const aiBody = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
  expect(aiBody.referenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(screen.getByLabelText("Activity label")).toHaveValue(
    "My manual activity",
  );
  await user.click(
    screen.getByRole("button", { name: "Apply reviewed suggestion" }),
  );
  expect(screen.getByLabelText("Activity label")).toHaveValue("Chess");
  await user.click(screen.getByRole("button", { name: "Create seeking post" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Choose at least one time",
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
  await user.type(screen.getByLabelText("Disclosure value"), "Sam");
  await user.click(screen.getByRole("button", { name: "Share disclosure" }));
  expect(screen.getByRole("alert")).toHaveTextContent("consent");
  expect(
    fetcher.mock.calls.some(([path]) => path.endsWith("/disclosures")),
  ).toBe(false);
  await user.click(screen.getByLabelText("I understand and consent"));
  await user.click(screen.getByRole("button", { name: "Share disclosure" }));
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
    screen.getByLabelText("What do you want to do?"),
    "Chess near me",
  );
  await user.click(
    screen.getByRole("button", { name: "Find compatible people" }),
  );
  expect(push).toHaveBeenCalledWith("/seek/new");
  expect(sessionStorage.getItem("veya.social.draft")).toBe("Chess near me");
  expect(
    screen.getByRole("button", { name: "Make it happen" }),
  ).toBeInTheDocument();
});

it("submits a complete manual seeking form with selected local times", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(json({ publicKey: "P".repeat(24) }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<SeekingForm profile={profile} />);
  await user.type(
    screen.getByLabelText("What do you want to do?"),
    "Play chess online",
  );
  await user.type(screen.getByLabelText("Activity key"), "chess");
  await user.type(screen.getByLabelText("Activity label"), "Chess");
  await user.selectOptions(screen.getByLabelText("Interaction"), "online");
  await user.click(screen.getAllByRole("button", { name: /^Evening / })[1]!);
  await user.click(screen.getByRole("button", { name: "Create seeking post" }));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith(`/seek/${"P".repeat(24)}`),
  );
  const body = JSON.parse(fetcher.mock.calls[0]![1].body);
  expect(body).toMatchObject({
    rawText: "Play chess online",
    activityKey: "chess",
    interactionMode: "online",
    city: null,
    privacyMode: "INCOGNITO",
    languages: ["en"],
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
  await user.click(await screen.findByRole("button", { name: "Find people" }));
  expect(
    await screen.findByText("You want to do the same activity"),
  ).toBeInTheDocument();
  expect(screen.queryByText("SECRET_SCORE_999")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Interested" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Interest sent");
  expect(
    screen.queryByRole("button", { name: "Interested" }),
  ).not.toBeInTheDocument();
  const interest = fetcher.mock.calls.find(([path]) =>
    path.endsWith("/connections"),
  );
  expect(JSON.parse(interest![1].body as string)).toEqual({
    handle: "H".repeat(24),
  });
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
    await screen.findByRole("button", { name: "Create profile" }),
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
    for (const period of ["Morning", "Afternoon", "Evening"]) {
      await user.click(
        screen.getAllByRole("button", { name: new RegExp(`^${period} `) })[
          day
        ]!,
      );
    }
  }
  expect(screen.getByRole("alert")).toHaveTextContent("at most 14 time ranges");
  expect(
    screen.getByRole("list", { name: "Selected availability" }).children,
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
    await screen.findByRole("button", { name: "Recover with a Veya Key" }),
  );
  await user.type(screen.getByLabelText("Recovery key"), "O".repeat(43));
  await user.click(screen.getByRole("button", { name: "Recover profile" }));
  expect(await screen.findByLabelText("Veya Key")).toHaveValue("R".repeat(43));
  await user.click(screen.getByRole("button", { name: "I saved my key" }));
  expect(screen.getByLabelText("Alias")).toHaveValue("Maple");
  expect(screen.getByLabelText("Privacy")).toHaveValue("INCOGNITO");
  expect(screen.getByLabelText("Profile languages (optional)")).toHaveValue(
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
  await user.type(screen.getByLabelText("Alias"), "Maple");
  await user.click(screen.getByLabelText("I am 18 or older"));
  await user.click(screen.getByRole("button", {name: "Create profile"}));
  expect(await screen.findByLabelText("Veya Key")).toHaveValue("N".repeat(43));
  await user.click(screen.getByRole("button", {name: "Next route"}));
  expect(screen.getByLabelText("Veya Key")).toHaveValue("N".repeat(43));
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  await user.click(screen.getByRole("button", {name: "I saved my key"}));
  expect(screen.queryByLabelText("Veya Key")).not.toBeInTheDocument();
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
  await user.type(screen.getByLabelText("Alias"), "Maple");
  await user.click(screen.getByLabelText("I am 18 or older"));
  await user.click(screen.getByRole("button", { name: "Create profile" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole("button", { name: "Next route" }));
  finish(json({ profile, recoveryKey: "L".repeat(43) }));
  expect(await screen.findByLabelText("Veya Key")).toHaveValue("L".repeat(43));
  expect(dispatch.mock.calls.filter(([event]) => event.type === "veya:social-profile-changed")).toHaveLength(1);
});
