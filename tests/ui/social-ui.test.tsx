// @vitest-environment jsdom
import { act, cleanup, render as baseRender, screen, waitFor } from "@testing-library/react";
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
  expect(screen.queryByText(/No active seeking posts yet/)).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Your active activity" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry activities" }));
  expect(await screen.findByRole("combobox", { name: "Your active activity" })).toHaveValue(post.publicKey);
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
    await user.type(await screen.findByLabelText("Alias"), "Maple");
    await user.click(screen.getByLabelText("I am 18 or older"));
    await user.click(screen.getByRole("button", { name: "Create profile" }));
    await user.click(await screen.findByRole("button", { name: "I saved my key" }));
    await waitFor(() => expect(postReads).toBe(1));
  } else {
    await user.click(await screen.findByRole("button", { name: "Retry activities" }));
    await waitFor(() => expect(profileReads).toBe(2));
    if (phase === "posts") await waitFor(() => expect(postReads).toBe(2));
  }
  await user.click(screen.getByRole("button", { name: "Delete Veya profile" }));
  await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
  await user.click(screen.getByRole("button", { name: "Permanently delete profile" }));
  expect(await screen.findByRole("button", { name: "Create profile" })).toBeVisible();
  await act(async () => {
    release(json(phase === "profile" ? { profile } : { posts: [{ publicKey: "p".repeat(24), status: "active", activityLabel: "Old activity" }] }));
  });
  expect(screen.getByRole("button", { name: "Create profile" })).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "Your active activity" })).not.toBeInTheDocument();
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

it.each([["chess", "Chess"], ["pottery", "Pottery"]])("submits a complete manual %s seeking form with selected local times", async (activityKey, activityLabel) => {
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
  await user.type(screen.getByLabelText("Activity key"), activityKey);
  await user.type(screen.getByLabelText("Activity label"), activityLabel);
  await user.selectOptions(screen.getByLabelText("Interaction"), "online");
  await user.click(screen.getAllByRole("button", { name: /^Evening / })[1]!);
  await user.click(screen.getByRole("button", { name: "Create seeking post" }));
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
  await user.click(screen.getByRole("button", { name: "Copy Veya Key" }));
  expect(writeText).toHaveBeenCalledWith("C".repeat(43));
  expect(await screen.findByRole("status")).toHaveTextContent("Key copied");
  expect(screen.getByLabelText("Veya Key")).toHaveValue("C".repeat(43));
  expect(screen.getByText(/lose both this key and your browser session/)).toBeVisible();
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "I saved my key" }));
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
  await user.click(screen.getByRole("button", { name: "Copy Veya Key" }));
  await user.click(screen.getByRole("button", { name: "I saved my key" }));
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
  await user.click(screen.getByRole("button", { name: "Copy Veya Key" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Select the key and copy it manually");
  expect(screen.getByLabelText("Veya Key")).toHaveValue("C".repeat(43));
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
  await user.click(screen.getByRole("button", { name: "Delete Veya profile" }));
  expect(screen.getByText(/cannot be undone/)).toHaveTextContent("Moderation evidence");
  const confirm = screen.getByRole("button", { name: "Permanently delete profile" });
  expect(confirm).toBeDisabled();
  await user.type(screen.getByLabelText("Type DELETE to confirm"), "delete");
  expect(confirm).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Cancel deletion" }));
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Delete Veya profile" }));
  expect(screen.getByLabelText("Type DELETE to confirm")).toHaveValue("");
  await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
  await user.click(screen.getByRole("button", { name: "Permanently delete profile" }));
  expect(await screen.findByRole("button", { name: "Create profile" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Your social profile was deleted.");
  expect(screen.getByLabelText("Alias")).toHaveValue("");
  expect(fetcher).toHaveBeenCalledWith("/api/social/profile", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ confirmation: "DELETE" }) }));
  expect(changed.mock.calls.some(([event]) => event.type === "veya:social-profile-changed")).toBe(true);
});
it("preserves the profile when deletion fails and allows an explicit retry", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json({ error: { code: "SERVICE_UNAVAILABLE" } }, 503)).mockResolvedValueOnce(json({ deleted: true }));
  vi.stubGlobal("fetch", fetcher);
  const onProfile = vi.fn();
  const user = userEvent.setup();
  render(<ProfilePanel profile={profile} onProfile={onProfile} />);
  await user.click(screen.getByRole("button", { name: "Delete Veya profile" }));
  await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
  await user.click(screen.getByRole("button", { name: "Permanently delete profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/try again/);
  expect(onProfile).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Alias")).toHaveValue("Maple");
  await user.click(screen.getByRole("button", { name: "Permanently delete profile" }));
  await waitFor(() => expect(onProfile).toHaveBeenCalledWith(null));
});

it.each(["seek", "discover"])("offers profile deletion to an unavailable owner on %s without unusable onboarding", async (surface) => {
  const { NewSeekScreen } = await import("@/features/social/components/seek-screen");
  const { DiscoverScreen } = await import("@/features/social/components/discover-screen");
  const fetcher = vi.fn().mockResolvedValueOnce(json({ error: { code: "FORBIDDEN" } }, 403)).mockResolvedValueOnce(json({ deleted: true }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(surface === "seek" ? <NewSeekScreen /> : <DiscoverScreen />);
  await user.click(await screen.findByRole("button", { name: "Delete Veya profile" }));
  expect(screen.queryByRole("button", { name: "Create profile" })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
  await user.click(screen.getByRole("button", { name: "Permanently delete profile" }));
  expect(await screen.findByRole("button", { name: "Create profile" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Your social profile was deleted.");
});
it("explains an invalid or revoked recovery key without erasing the entered key", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json({ authenticated: true })).mockResolvedValueOnce(json({ error: { code: "NOT_FOUND" } }, 404));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<ProfilePanel profile={null} onProfile={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Recover with a Veya Key" }));
  await user.type(screen.getByLabelText("Recovery key"), "O".repeat(43));
  await user.click(screen.getByRole("button", { name: "Recover profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This Veya Key is invalid or no longer active");
  expect(screen.getByLabelText("Recovery key")).toHaveValue("O".repeat(43));
  expect(screen.getByRole("alert")).not.toHaveTextContent("O".repeat(43));
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
