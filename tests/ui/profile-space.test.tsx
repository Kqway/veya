// @vitest-environment jsdom
import "../support/history-guard";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProfileScene } from "@/features/profile-space/components/profile-scene";
import { ProfileEditor } from "@/features/profile-space/components/profile-editor";
import { defaultCustomization, type ProfileSpace } from "@/features/profile-space/schema";

function self(): ProfileSpace {
  const customization = { ...defaultCustomization(), status: "На одной волне", tagline: "Больше маленьких приключений", interests: ["Кино"], goals: ["Найти компанию для прогулок"], selectedActivities: ["chess"], intentPostKey: "p".repeat(24) };
  return { identity: { alias: "Лис", avatarSeed: "pair-safe-seed" }, audience: "self", presentation: { world: "minimal", accent: "coral", avatar: "orbit" }, status: customization.status, tagline: customization.tagline, currentIntent: { activityLabel: "Шахматы", interactionMode: "online", format: "one_to_one", timeHint: "В выходные" }, activities: [{ activityKey: "chess", activityLabel: "Шахматы", count: 2 }], interests: customization.interests, goals: customization.goals, blockOrder: ["intent", "activities", "interests", "goals"], action: { kind: "seek", key: null }, customization, intentOptions: [{ publicKey: "p".repeat(24), activityLabel: "Шахматы" }, { publicKey: "q".repeat(24), activityLabel: "Прогулка" }], activityOptions: [{ activityKey: "chess", activityLabel: "Шахматы", count: 2 }, { activityKey: "walk", activityLabel: "Прогулка", count: 1 }] };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("renders only projected fields in DTO order and labels real post counts", () => {
  const space = self();
  render(<ProfileScene space={{ ...space, blockOrder: ["goals", "intent", "activities"], interests: [] }}><button>Позвать вместе</button></ProfileScene>);
  expect(screen.getByRole("heading", { name: "Лис" })).toBeVisible();
  const scene = screen.getByRole("region", { name: "Пространство Лис" });
  expect(within(scene).getAllByRole("heading").map(item => item.textContent)).toEqual(["Лис", "Цели", "Сейчас хочу", "Мои занятия"]);
  expect(screen.getByText("2 заявки")).toBeVisible();
  expect(screen.queryByText("Кино")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Позвать вместе" })).toBeVisible();
  expect(scene.innerHTML).not.toContain(space.identity.avatarSeed);
});

it("switches all eight controlled worlds in live preview and saves the full draft", async () => {
  const user = userEvent.setup();
  let saved: unknown;
  render(<ProfileEditor space={self()} onSave={async settings => { saved = settings; }} />);
  const scene = within(screen.getByRole("region", { name: "Предпросмотр пространства" })).getByRole("region", { name: "Пространство Лис" });
  for (const [label, world] of [["Минимализм", "minimal"], ["Полночь", "midnight"], ["Стекло", "glass"], ["Уют", "cozy"], ["Кибер", "cyber"], ["Манга", "manga"], ["Нулевые", "y2k"], ["Монохром", "monochrome"]]) {
    await user.click(screen.getByRole("button", { name: label! }));
    expect(scene).toHaveAttribute("data-world", world);
  }
  await user.clear(screen.getByLabelText("Статус"));
  await user.type(screen.getByLabelText("Статус"), "Готов к приключениям");
  expect(within(scene).getByText("Готов к приключениям")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Сохранить пространство" }));
  expect(saved).toMatchObject({ world: "monochrome", status: "Готов к приключениям", blockOrder: ["intent", "activities", "interests", "goals"] });
  expect(screen.getByRole("status")).toHaveTextContent("Сохранено");
});

it("supports keyboard block ordering, visibility and removing blocks from preview", async () => {
  const user = userEvent.setup();
  render(<ProfileEditor space={self()} onSave={async () => {}} />);
  const up = screen.getByRole("button", { name: "Цели: выше" });
  up.focus();
  await user.keyboard("{Enter}{Enter}{Enter}");
  const scene = within(screen.getByRole("region", { name: "Предпросмотр пространства" })).getByRole("region", { name: "Пространство Лис" });
  expect(within(scene).getAllByRole("heading")[1]).toHaveTextContent("Цели");
  await user.click(screen.getByLabelText("Показывать: Цели"));
  expect(within(scene).queryByRole("heading", { name: "Цели" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Кому виден статус"), "everyone");
  expect(screen.getByLabelText("Кому виден статус")).toHaveValue("everyone");
});

it("rejects invalid full draft and retains edits after a failed save for retry", async () => {
  const user = userEvent.setup();
  let attempts = 0;
  render(<ProfileEditor space={self()} onSave={async () => { attempts++; if (attempts === 1) throw new Error("unavailable"); }} />);
  fireEvent.change(screen.getByLabelText("Интересы — каждый с новой строки"), { target: { value: Array.from({ length: 9 }, (_, index) => `Интерес ${index}`).join("\n") } });
  await user.click(screen.getByRole("button", { name: "Сохранить пространство" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/8/);
  expect(attempts).toBe(0);
  fireEvent.change(screen.getByLabelText("Интересы — каждый с новой строки"), { target: { value: "Музыка" } });
  await user.click(screen.getByRole("button", { name: "Сохранить пространство" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Не удалось сохранить");
  expect(screen.getByLabelText("Интересы — каждый с новой строки")).toHaveValue("Музыка");
  await user.click(screen.getByRole("button", { name: "Сохранить пространство" }));
  expect(screen.getByRole("status")).toHaveTextContent("Сохранено");
});

it("guards unsaved edits without browser storage and exposes mobile preview controls", async () => {
  const user = userEvent.setup();
  render(<ProfileEditor space={self()} onSave={async () => {}} />);
  await user.type(screen.getByLabelText("Статус"), "!");
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "Предпросмотр" }));
  expect(screen.getByRole("button", { name: "Предпросмотр" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Настройки" }));
  expect(screen.getByRole("button", { name: "Настройки" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Сохранить пространство" }));
  const savedEvent = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(savedEvent);
  expect(savedEvent.defaultPrevented).toBe(false);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it("confirms discarding unsaved edits before client links, including keyboard activation", async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { unmount } = render(<><a href="/discover" onClick={event => { event.preventDefault(); navigate(); }}><span>Поиск компании</span></a><ProfileEditor space={self()} onSave={async () => {}} /></>);
  await user.type(screen.getByLabelText("Статус"), "!");
  await user.click(screen.getByText("Поиск компании"));
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Статус")).toHaveValue("На одной волне!");
  const link = screen.getByRole("link", { name: "Поиск компании" });
  link.focus();
  await user.keyboard("{Enter}");
  expect(navigate).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await user.keyboard("{Enter}");
  expect(navigate).toHaveBeenCalledTimes(1);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
  unmount();
  const outsideLink = document.createElement("a");
  outsideLink.href = "/connections";
  document.body.append(outsideLink);
  const outsideNavigation = vi.fn((event: MouseEvent) => event.preventDefault());
  outsideLink.addEventListener("click", outsideNavigation);
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  outsideLink.dispatchEvent(click);
  expect(outsideNavigation).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledTimes(3);
  outsideLink.remove();
});

it("allows links after saving or resetting and leaves preview anchors and new tabs alone", async () => {
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<><a href="/discover" onClick={event => event.preventDefault()}>Поиск компании</a><a href="#preview" onClick={event => event.preventDefault()}>К предпросмотру</a><a href="/connections" target="_blank" onClick={event => event.preventDefault()}>Открыть отдельно</a><ProfileEditor space={self()} onSave={async () => {}} /></>);
  await user.click(screen.getByRole("link", { name: "Поиск компании" }));
  await user.type(screen.getByLabelText("Статус"), "!");
  await user.click(screen.getByRole("link", { name: "К предпросмотру" }));
  await user.click(screen.getByRole("link", { name: "Открыть отдельно" }));
  expect(confirm).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Отменить изменения" }));
  await user.click(screen.getByRole("link", { name: "Поиск компании" }));
  await user.type(screen.getByLabelText("Статус"), "!");
  await user.click(screen.getByRole("button", { name: "Сохранить пространство" }));
  await user.click(screen.getByRole("link", { name: "Поиск компании" }));
  expect(confirm).not.toHaveBeenCalled();
});

it("keeps the editor and its history state when browser Back is cancelled", async () => {
  const user = userEvent.setup();
  const originalUrl = window.location.href;
  const originalState = window.history.state;
  const editorState = { __NA: true, tree: "editor-route" };
  const routerNavigation = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  window.history.replaceState(editorState, "", "/profile/edit");
  window.addEventListener("popstate", routerNavigation);
  try {
    render(<ProfileEditor space={self()} onSave={async () => {}} />);
    await user.type(screen.getByLabelText("Статус"), "!");
    window.history.replaceState({ __NA: true, tree: "previous-route" }, "", "/discover");
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    expect(window.location.pathname).toBe("/profile/edit");
    expect(window.history.state).toEqual(editorState);
    expect(routerNavigation).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Статус")).toHaveValue("На одной волне!");
    confirm.mockReturnValue(true);
    window.history.replaceState({ __NA: true, tree: "previous-route" }, "", "/discover");
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    expect(window.location.pathname).toBe("/discover");
    expect(routerNavigation).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
    window.removeEventListener("popstate", routerNavigation);
    window.history.replaceState(originalState, "", originalUrl);
  }
});

it("previews selected owned activities and existing intent options", async () => {
  const user = userEvent.setup();
  let saved: unknown;
  render(<ProfileEditor space={self()} onSave={async settings => { saved = settings; }} />);
  await user.click(screen.getByLabelText("Занятие: Прогулка"));
  await user.selectOptions(screen.getByLabelText("Моя текущая заявка"), "q".repeat(24));
  const scene = within(screen.getByRole("region", { name: "Предпросмотр пространства" })).getByRole("region", { name: "Пространство Лис" });
  expect(within(scene).getAllByText("Прогулка")).toHaveLength(2);
  expect(within(scene).getByText("1 заявка")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Сохранить пространство" }));
  expect(saved).toMatchObject({ selectedActivities: ["chess", "walk"], intentPostKey: "q".repeat(24) });
});
