// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipantForm } from "@/features/entry/components/participant-form";
import type { IntentView } from "@/features/backend/types";
const view: IntentView = {
  intent: {
    publicSlug: "abcdefghijklmnopqrstuvwx",
    creatorName: "Maya",
    rawText: "Coffee",
    title: "Coffee",
    structuredIntent: { type: "meet", activities: [], location: null },
    status: "collecting",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    participantCount: 0,
  },
  ownParticipant: null,
  isCreator: false,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("participant form", () => {
  it("requires availability and preserves details without making a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(
      <ParticipantForm view={view} onSaved={() => {}} onCancel={() => {}} />,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Ваше имя" }),
      "Alex",
    );
    await user.click(screen.getByRole("button", { name: "Присоединиться к встрече" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/хотя бы один подходящий промежуток/i);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Ваше имя" })).toHaveValue(
      "Alex",
    );
  });
  it("passes the direct HTTP intent view to the joined screen", async () => {
    const own = {
      displayName: "Sam",
      budgetMin: null,
      budgetMax: null,
      currency: null,
      notes: "",
      preferences: [],
      availability: [
        {
          startAt: new Date(Date.now() + 86400000).toISOString(),
          endAt: new Date(Date.now() + 86400000 + 3600000).toISOString(),
        },
      ],
    };
    const saved = { ...view, ownParticipant: own };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"authenticated":true}'))
      .mockResolvedValueOnce(new Response(JSON.stringify(saved)));
    vi.stubGlobal("fetch", fetcher);
    const onSaved = vi.fn(),
      user = userEvent.setup();
    render(
      <ParticipantForm view={view} onSaved={onSaved} onCancel={() => {}} />,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Ваше имя" }),
      "Sam",
    );
    await user.click(screen.getAllByRole("button", { name: /Вечер / })[1]!);
    await user.click(screen.getByRole("button", { name: "Присоединиться к встрече" }));
    expect(onSaved).toHaveBeenCalledWith(saved);
  });
  it("does not create a new identity when an existing guest's session is revoked", async () => {
    const own = {
      displayName: "Alex",
      budgetMin: 0,
      budgetMax: 1029,
      currency: "USD",
      notes: "original",
      preferences: [{ category: "activity" as const, value: "coffee" }],
      availability: [
        {
          startAt: new Date(Date.now() + 86400000).toISOString(),
          endAt: new Date(Date.now() + 86400000 + 3600000).toISOString(),
        },
      ],
    };
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response('{"error":{"code":"UNAUTHORIZED"}}', { status: 401 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(
      <ParticipantForm
        view={{ ...view, ownParticipant: own }}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByLabelText("Максимальный бюджет")).toHaveValue("10.29");
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/participants/me"),
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"budgetMin":0'),
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Сеанс завершён/i);
    expect(screen.getByLabelText("Заметка (необязательно)")).toHaveValue("original");
  });
});
