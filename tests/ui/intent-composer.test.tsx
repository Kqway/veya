// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntentComposer } from "@/features/intents/components/intent-composer";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
});
describe("persistent intent composer", () => {
  it("explains blank submissions and focuses the idea", async () => {
    const user = userEvent.setup();
    render(<IntentComposer />);
    await user.click(screen.getByRole("button", { name: "Make it happen" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tell us what you'd like to do.",
    );
    expect(
      screen.getByRole("textbox", { name: "What do you want to do?" }),
    ).toHaveFocus();
  });
  it("fills an example without submitting", async () => {
    const user = userEvent.setup();
    render(<IntentComposer />);
    await user.click(screen.getByRole("button", { name: "Play games" }));
    expect(screen.getByRole("textbox")).toHaveValue(
      "Find friends for a game night.",
    );
    expect(
      screen.queryByRole("button", { name: "Create invite" }),
    ).not.toBeInTheDocument();
  });
  it("collects a name, creates a guest/intent and opens its persistent invite", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"authenticated":true}'))
      .mockResolvedValueOnce(
        new Response('{"intent":{"publicSlug":"abcdefghijklmnopqrstuvwx"}}'),
      );
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<IntentComposer />);
    await user.type(screen.getByRole("textbox"), "  Coffee this week?  ");
    await user.click(screen.getByRole("button", { name: "Make it happen" }));
    await user.type(screen.getByRole("textbox", { name: "Your name" }), "Maya");
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/intents",
      expect.objectContaining({
        body: expect.stringContaining('"rawText":"Coffee this week?"'),
      }),
    );
    expect(push).toHaveBeenCalledWith("/i/abcdefghijklmnopqrstuvwx");
  });
  it("preserves idea/name on a failed create and allows retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"error":{"code":"SERVICE_UNAVAILABLE"}}', {
            status: 503,
          }),
        ),
    );
    const user = userEvent.setup();
    render(<IntentComposer />);
    await user.click(screen.getByRole("button", { name: "Meet friends" }));
    await user.click(screen.getByRole("button", { name: "Make it happen" }));
    await user.type(screen.getByRole("textbox", { name: "Your name" }), "Alex");
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/try again/i);
    expect(screen.getByRole("textbox", { name: "Your name" })).toHaveValue(
      "Alex",
    );
    await user.click(screen.getByRole("button", { name: "Edit your idea" }));
    expect(screen.getByRole("textbox")).toHaveValue(
      "Let's meet somewhere this week.",
    );
  });
  it("rejects ideas over 500 characters", async () => {
    const user = userEvent.setup();
    render(<IntentComposer />);
    await user.click(screen.getByRole("textbox"));
    await user.paste("a".repeat(501));
    await user.click(screen.getByRole("button", { name: "Make it happen" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Keep your idea to 500 characters or fewer.",
    );
  });
});
