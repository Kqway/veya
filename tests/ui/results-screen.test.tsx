// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultsScreen } from "@/features/scheduling/components/results-screen";
import type { ResultsView } from "@/features/backend/results-types";
const key = "a".repeat(32);
const view: ResultsView = {
  intent: {
    publicSlug: "abcdefghijklmnopqrstuvwx",
    creatorName: "Maya",
    rawText: "Coffee",
    title: "Coffee",
    structuredIntent: { type: "meet", activities: ["coffee"], location: null },
    status: "ready",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    participantCount: 2,
  },
  ownParticipant: null,
  isCreator: false,
  revision: 3,
  selectedSuggestionKey: null,
  canVote: true,
  summary: {
    participantsWithAvailability: 2,
    participantsMissingAvailability: 0,
  },
  message: "All 2 can make this time.",
  suggestions: [
    {
      suggestionKey: key,
      title: "Time for coffee",
      window: {
        startAt: "2026-10-01T18:00:00Z",
        endAt: "2026-10-01T19:00:00Z",
      },
      availableCount: 2,
      partialCount: 0,
      totalCount: 2,
      score: 900,
      durationMinutes: 60,
      shortened: false,
      activity: "coffee",
      budgetAssessment: "compatible",
      explanation: "All 2 can make this time.",
      votes: { yes: 0, maybe: 0, no: 0 },
      ownVote: null,
      attendance: [{ displayName: "Sam", status: "available" }],
    },
  ],
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("group results", () => {
  it("sends only the current key/revision/value and shows saved own vote", async () => {
    const saved = {
      ...view,
      suggestions: [
        {
          ...view.suggestions[0]!,
          votes: { yes: 1, maybe: 0, no: 0 },
          ownVote: "yes",
        },
      ],
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(view))
      .mockResolvedValueOnce(response(saved));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<ResultsScreen slug={view.intent.publicSlug} />);
    await user.click(await screen.findByRole("button", { name: "YES" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "YES" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/votes"),
      expect.objectContaining({
        body: JSON.stringify({ suggestionKey: key, revision: 3, value: "yes" }),
      }),
    );
  });
  it("explains stale results and reloads instead of overwriting a saved vote", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(view))
      .mockResolvedValueOnce(
        response({ error: { code: "STALE_RESULTS" } }, 409),
      )
      .mockResolvedValueOnce(response({ ...view, revision: 5 }));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<ResultsScreen slug={view.intent.publicSlug} />);
    await user.click(await screen.findByRole("button", { name: "MAYBE" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /suggestions changed/i,
    );
    await user.click(screen.getByRole("button", { name: "Reload results" }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });
  it("requires an explicit creator confirmation and then closes controls", async () => {
    const creator = { ...view, isCreator: true, canVote: false };
    const decided = {
      ...creator,
      intent: { ...creator.intent, status: "decided" },
      selectedSuggestionKey: key,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(creator))
      .mockResolvedValueOnce(response(decided));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<ResultsScreen slug={view.intent.publicSlug} />);
    await user.click(
      await screen.findByRole("button", { name: "Choose this plan" }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Confirm plan" }));
    expect(
      await screen.findByRole("heading", { name: "It's a plan." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Choose this plan" }),
    ).not.toBeInTheDocument();
  });
  it("gives nonmembers and empty groups a useful next action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          ...view,
          canVote: false,
          suggestions: [],
          message: "Ask friends to add future availability.",
        }),
      ),
    );
    render(<ResultsScreen slug={view.intent.publicSlug} />);
    expect(
      await screen.findByRole("heading", {
        name: "A little more availability.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Add availability" }),
    ).toHaveAttribute("href", `/i/${view.intent.publicSlug}`);
    expect(
      screen.queryByRole("button", { name: "YES" }),
    ).not.toBeInTheDocument();
  });
  it("keeps a confirmed alternative visible even with an expired collection status", async () => {
    const alternative = {
      ...view.suggestions[0]!,
      suggestionKey: "b".repeat(32),
      title: "The chosen alternative",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({
            ...view,
            intent: { ...view.intent, status: "expired" },
            canVote: false,
            selectedSuggestionKey: alternative.suggestionKey,
            suggestions: [view.suggestions[0]!, alternative],
          }),
        ),
    );
    render(<ResultsScreen slug={view.intent.publicSlug} />);
    expect(
      await screen.findByRole("heading", { name: "It's a plan." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Confirmed plan" }),
    ).toHaveTextContent("The chosen alternative");
    expect(
      screen.queryByRole("region", { name: "Best match" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "YES" }),
    ).not.toBeInTheDocument();
  });
});
