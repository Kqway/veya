// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharePanel } from "@/features/entry/components/share-panel";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "share");
});
describe("invite sharing", () => {
  it("prevents duplicate share calls and uses public organizer copy", async () => {
    let finish!: () => void;
    const share = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    const user = userEvent.setup();
    render(<SharePanel slug="abcdefghijklmnopqrstuvwx" creatorName="Artem" />);
    const button = screen.getByRole("button", { name: "Share invite" });
    await user.click(button);
    await user.click(button);
    expect(share).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Artem wants to make a plan 👀" }),
    );
    finish();
  });
  it("supports native sharing, keeps cancellation quiet and offers a failure fallback", async () => {
    const cancelled = new Error("cancelled");
    cancelled.name = "AbortError";
    const share = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(cancelled)
      .mockRejectedValueOnce(new Error("unavailable"));
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    const user = userEvent.setup();
    render(<SharePanel slug="abcdefghijklmnopqrstuvwx" />);
    const button = screen.getByRole("button", { name: "Share invite" });
    await user.click(button);
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://localhost:3000/i/abcdefghijklmnopqrstuvwx",
      }),
    );
    await user.click(button);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await user.click(button);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Copy the link below instead.",
    );
  });
  it("copies a canonical link and URL encodes Telegram sharing", async () => {
    const user = userEvent.setup();
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    render(<SharePanel slug="abcdefghijklmnopqrstuvwx" />);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("/i/abcdefghijklmnopqrstuvwx"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Link copied");
    const href = screen
      .getByRole("link", { name: "Telegram share" })
      .getAttribute("href")!;
    expect(new URL(href).searchParams.get("url")).toContain(
      "/i/abcdefghijklmnopqrstuvwx",
    );
  });
  it("keeps a selectable URL when clipboard permission is denied", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("denied"),
    );
    render(<SharePanel slug="abcdefghijklmnopqrstuvwx" />);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      /copy the link below/i,
    );
    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue(
      "http://localhost:3000/i/abcdefghijklmnopqrstuvwx",
    );
    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveFocus();
  });
});
