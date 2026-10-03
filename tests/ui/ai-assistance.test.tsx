// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateDetails } from "@/features/entry/components/create-details";
import { PlanAssistance } from "@/features/scheduling/components/plan-assistance";
import { parsedIntent, parseInput } from "../support/ai";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
});
describe("optional reviewed assistance", () => {
  it("previews then applies editable details while preserving name and reply lifetime", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ data: parsedIntent, source: "mock" }))
      .mockResolvedValueOnce(response({ authenticated: true }))
      .mockResolvedValueOnce(
        response({ intent: { publicSlug: "abcdefghijklmnopqrstuvwx" } }),
      );
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<CreateDetails idea={parseInput.text} onEdit={() => {}} />);
    await user.type(screen.getByLabelText("Ваше имя"), "Sam");
    await user.type(
      screen.getByLabelText("Место или район (необязательно)"),
      "Manual town",
    );
    await user.selectOptions(screen.getByLabelText("Срок сбора ответов"), "3");
    await user.click(screen.getByRole("button", { name: "Помочь с деталями" }));
    expect(
      await screen.findByRole("heading", { name: "Предложенные детали" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Место или район (необязательно)")).toHaveValue(
      "Manual town",
    );
    await user.click(screen.getByRole("button", { name: "Применить детали" }));
    expect(screen.getByLabelText("Ваше имя")).toHaveValue("Sam");
    expect(screen.getByLabelText("Срок сбора ответов")).toHaveValue("3");
    expect(screen.getByLabelText("Тип встречи (необязательно)")).toHaveValue(
      "meet",
    );
    expect(screen.getByLabelText("Место или район (необязательно)")).toHaveValue(
      "Bristol",
    );
    expect(screen.getByRole("button", { name: "Кино" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Создать приглашение" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/i/abcdefghijklmnopqrstuvwx"),
    );
    expect(JSON.parse(fetcher.mock.calls[2]![1].body).structuredIntent).toEqual(
      parsedIntent,
    );
    const parseBody = JSON.parse(fetcher.mock.calls[0]![1].body);
    expect(Object.keys(parseBody).sort()).toEqual([
      "referenceDate",
      "text",
      "timeZone",
    ]);
    expect(parseBody.text).toBe(parseInput.text);
  });
  it("dismisses suggestions without replacing manual choices", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(response({ data: parsedIntent, source: "mock" })),
    );
    const user = userEvent.setup();
    render(<CreateDetails idea={parseInput.text} onEdit={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Кофе" }));
    await user.click(screen.getByRole("button", { name: "Помочь с деталями" }));
    await user.click(
      await screen.findByRole("button", { name: "Оставить мои детали" }),
    );
    expect(
      screen.queryByRole("heading", { name: "Предложенные детали" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Кофе" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Тип встречи (необязательно)")).toHaveValue(
      "general",
    );
  });
  it("keeps manual creation enabled after a parsing request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ error: { code: "SERVICE_UNAVAILABLE" } }, 503),
        ),
    );
    const user = userEvent.setup();
    render(<CreateDetails idea="Coffee" onEdit={() => {}} />);
    await user.type(screen.getByLabelText("Ваше имя"), "Maya");
    await user.click(screen.getByRole("button", { name: "Помочь с деталями" }));
    expect(
      await screen.findByText(/Добавьте детали сами/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Ваше имя")).toHaveValue("Maya");
    expect(screen.getByRole("button", { name: "Создать приглашение" })).toBeEnabled();
  });
  it("does not wait for a slow helper before ordinary creation", async () => {
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path === "/api/ai/intent"
          ? pending
          : path === "/api/session"
            ? response({ authenticated: true })
            : response({ intent: { publicSlug: "abcdefghijklmnopqrstuvwx" } }),
      ),
    );
    const user = userEvent.setup();
    const { unmount } = render(
      <CreateDetails idea="Coffee" onEdit={() => {}} />,
    );
    await user.type(screen.getByLabelText("Ваше имя"), "Maya");
    await user.click(screen.getByRole("button", { name: "Помочь с деталями" }));
    expect(screen.getByRole("button", { name: "Создать приглашение" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Создать приглашение" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    unmount();
    release(response({ data: parsedIntent, source: "mock" }));
  });
  it("shows a transient plain-text idea and sends only proposal key/revision", async () => {
    const key = "a".repeat(32),
      fetcher = vi.fn().mockResolvedValue(
        response({
          suggestionKey: key,
          revision: 3,
          idea: {
            data: {
              title: "Coffee <script>not HTML</script>",
              idea: "A conversation together",
            },
            source: "mock",
          },
          explanation: {
            data: { explanation: "2 of 3 can make this time." },
            source: "mock",
          },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    const { container } = render(
      <PlanAssistance
        slug="abcdefghijklmnopqrstuvwx"
        suggestionKey={key}
        revision={3}
        disabled={false}
      />,
    );
    expect(fetcher).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Предложить идею встречи" }));
    expect(
      await screen.findByText("Coffee <script>not HTML</script>"),
    ).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("2 of 3 can make this time.")).toBeInTheDocument();
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      suggestionKey: key,
      revision: 3,
    });
  });
  it("makes stale assistance recoverable without creating an identity", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ error: { code: "STALE_RESULTS" } }, 409));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(
      <PlanAssistance
        slug="abcdefghijklmnopqrstuvwx"
        suggestionKey={"a".repeat(32)}
        revision={3}
        disabled={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Предложить идею встречи" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      /Обновите результаты/,
    );
    expect(
      screen.getByRole("button", { name: "Предложить идею встречи" }),
    ).toBeEnabled();
    expect(fetcher.mock.calls[0]![0]).toBe(
      "/api/intents/abcdefghijklmnopqrstuvwx/assist",
    );
  });
});
