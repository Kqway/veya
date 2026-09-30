// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { IntentComposer } from "@/features/intents/components/intent-composer";

afterEach(cleanup);

describe("intent draft composer", () => {
  it("focuses the input and explains blank submissions", async () => {
    const user = userEvent.setup();
    render(<IntentComposer />);
    await user.click(screen.getByRole("button", { name: "Make it happen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Tell us what you'd like to do.");
    expect(screen.getByRole("textbox", { name: "What do you want to do?" })).toHaveFocus();
  });

  it("fills the idea from an example without submitting", async () => {
    const user = userEvent.setup();
    render(<IntentComposer />);
    await user.click(screen.getByRole("button", { name: "Play games" }));
    expect(screen.getByRole("textbox")).toHaveValue("Find friends for a game night.");
    expect(screen.queryByText("Your next plan")).not.toBeInTheDocument();
  });

  it("previews a normalized idea without claiming an invite exists", async () => {
    const user = userEvent.setup();
    render(<IntentComposer />);
    await user.type(screen.getByRole("textbox"), "  Let's meet this week.  ");
    await user.click(screen.getByRole("button", { name: "Make it happen" }));
    expect(screen.getByRole("heading", { name: "Let's meet this week." })).toBeInTheDocument();
    expect(screen.getByText("Invites are coming soon. Your idea stays here while you explore.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy link/i })).not.toBeInTheDocument();
  });

  it("returns to the draft for editing without losing the idea", async () => {
    const user = userEvent.setup();
    render(<IntentComposer />);
    await user.click(screen.getByRole("button", { name: "Meet friends" }));
    await user.click(screen.getByRole("button", { name: "Make it happen" }));
    await user.click(screen.getByRole("button", { name: "Edit your idea" }));
    expect(screen.getByRole("textbox")).toHaveValue("Let's meet somewhere this week.");
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("rejects ideas beyond the 500-character limit", async () => {
    const user = userEvent.setup();
    render(<IntentComposer />);
    await user.click(screen.getByRole("textbox"));
    await user.paste("a".repeat(501));
    await user.click(screen.getByRole("button", { name: "Make it happen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Keep your idea to 500 characters or fewer.");
    expect(screen.queryByText("Your next plan")).not.toBeInTheDocument();
  });
});
