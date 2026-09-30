// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateDetails } from "@/features/entry/components/create-details";
import { ParticipantForm } from "@/features/entry/components/participant-form";
import type { IntentView } from "@/features/backend/types";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const view: IntentView = {
  intent: {
    publicSlug: "abcdefghijklmnopqrstuvwx",
    creatorName: "Artem",
    rawText: "Coffee",
    title: "Coffee",
    structuredIntent: { type: "meet", activities: [], location: null },
    status: "collecting",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    participantCount: 0,
  },
  ownParticipant: null,
  isCreator: true,
};
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
});
describe("pending form lifecycle", () => {
  it("does not create after leaving while guest initialization is pending", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            finish = r;
          }),
      )
      .mockResolvedValue(response(view));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    const mounted = render(<CreateDetails idea="Coffee" onEdit={() => {}} />);
    await user.type(screen.getByLabelText("Your name"), "Artem");
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    mounted.unmount();
    await act(async () => {
      finish(response({}));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
  it("does not redirect after leaving while creation is pending", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({}))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            finish = r;
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    const mounted = render(<CreateDetails idea="Coffee" onEdit={() => {}} />);
    await user.type(screen.getByLabelText("Your name"), "Artem");
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    mounted.unmount();
    await act(async () => {
      finish(response(view));
    });
    expect(push).not.toHaveBeenCalled();
  });
  it("does not join or invoke callbacks after leaving during guest initialization", async () => {
    let finish!: (response: Response) => void;
    const onSaved = vi.fn();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            finish = r;
          }),
      )
      .mockResolvedValue(response(view));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    const mounted = render(
      <ParticipantForm view={view} onSaved={onSaved} onCancel={() => {}} />,
    );
    await user.type(screen.getByLabelText("Display name"), "Artem");
    await user.click(screen.getAllByRole("button", { name: /Evening / })[1]!);
    await user.click(screen.getByRole("button", { name: "Join the plan" }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    mounted.unmount();
    await act(async () => {
      finish(response({}));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
