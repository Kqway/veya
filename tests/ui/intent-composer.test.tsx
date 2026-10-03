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
    await user.click(screen.getByRole("button", { name: "Создать план" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Расскажите, чем хотите заняться.",
    );
    expect(
      screen.getByRole("textbox", { name: "Чем хотите заняться?" }),
    ).toHaveFocus();
  });
  it("fills an example without submitting", async () => {
    const user = userEvent.setup();
    render(<IntentComposer />);
    await user.click(screen.getByRole("button", { name: "Поиграть" }));
    expect(screen.getByRole("textbox")).toHaveValue(
      "Хочу собрать друзей на вечер игр.",
    );
    expect(
      screen.queryByRole("button", { name: "Создать приглашение" }),
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
    await user.click(screen.getByRole("button", { name: "Создать план" }));
    await user.type(screen.getByRole("textbox", { name: "Ваше имя" }), "Maya");
    await user.click(screen.getByRole("button", { name: "Кофе" }));
    await user.click(screen.getByRole("button", { name: "Создать приглашение" }));
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/intents",
      expect.objectContaining({
        body: expect.stringContaining('"rawText":"Coffee this week?"'),
      }),
    );
    expect(JSON.parse(fetcher.mock.calls[1]![1].body).structuredIntent.activities).toEqual(["coffee"]);
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
    await user.click(screen.getByRole("button", { name: "Встретиться с друзьями" }));
    await user.click(screen.getByRole("button", { name: "Создать план" }));
    await user.type(screen.getByRole("textbox", { name: "Ваше имя" }), "Alex");
    await user.click(screen.getByRole("button", { name: "Создать приглашение" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/попробуйте ещё раз/i);
    expect(screen.getByRole("textbox", { name: "Ваше имя" })).toHaveValue(
      "Alex",
    );
    await user.click(screen.getByRole("button", { name: "Изменить идею" }));
    expect(screen.getByRole("textbox")).toHaveValue(
      "Давайте встретимся на этой неделе.",
    );
  });
  it("rejects ideas over 500 characters", async () => {
    const user = userEvent.setup();
    render(<IntentComposer />);
    await user.click(screen.getByRole("textbox"));
    await user.paste("a".repeat(501));
    await user.click(screen.getByRole("button", { name: "Создать план" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Опишите идею не более чем в 500 символах.",
    );
  });
});
