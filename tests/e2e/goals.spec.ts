import {
  test,
  expect,
  type Page,
  type TestInfo,
} from "../support/browser-test";
import type { GoalDTO } from "../../src/features/goals/schema";

async function screenshot(page: Page, info: TestInfo, name: string) {
  await expect(page.locator(".goal-skeleton")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}
async function api<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (own) => {
    const response = await fetch(own, { cache: "no-store" });
    if (!response.ok) throw new Error(`Read failed ${response.status}`);
    return response.json();
  }, path);
}
async function start(page: Page, text = "Заработай мне 10000 ₽") {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Что должно произойти?" }).fill(text);
  await page.getByRole("button", { name: "Начать", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Псевдоним", exact: true })
    .fill("Александр");
  await page.getByLabel("Мне исполнилось 18 лет").check();
  await page.getByLabel("Я сам решаю, что раскрыть о себе").check();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(page).toHaveURL(/\/goals\/[A-Za-z0-9_-]{24}$/);
  await page
    .getByRole("button", { name: "Ключ сохранён", exact: true })
    .click();
  return page.url().split("/").at(-1)!;
}

test("intent → durable execution → verified document → approved invoice → confirmed demo result", async ({
  page,
  context,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Что должно произойти?" }),
  ).toBeVisible();
  await screenshot(page, info, "home-empty");
  const key = await start(page);
  await expect(
    page.getByRole("heading", { name: /Заработать.*10.*000/ }),
  ).toBeVisible();
  await expect(page.getByText("Работаю", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await screenshot(page, info, "goal-active");
  await expect(page.getByText("Ожидаю", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await screenshot(page, info, "goal-waiting");
  // Worker continues in another process while the entire page is closed.
  await page.close();
  const returned = await context.newPage();
  returned.on("pageerror", (error) => errors.push(error.message));
  await returned.goto(`/goals/${key}`);
  await expect(
    returned.getByRole("heading", { name: "Выставить демо-счёт" }),
  ).toBeVisible({ timeout: 45000 });
  const waiting = (
    await api<{ goal: GoalDTO }>(returned, `/api/agent/goals/${key}`)
  ).goal;
  expect(waiting.status).toBe("WAITING_APPROVAL");
  expect(waiting.confirmedAmountMinor).toBe(0);
  expect(waiting.artifacts.some((artifact) => artifact.verified)).toBe(true);
  const approval = waiting.approvals.find((item) => item.status === "pending")!;
  await returned.goto(`/goals/${key}/approvals/${approval.publicKey}`);
  await expect(
    returned.getByRole("button", { name: "Разрешить", exact: true }),
  ).toBeVisible();
  await screenshot(returned, info, "approval");
  await returned
    .getByRole("button", { name: "Разрешить", exact: true })
    .click();
  await expect(
    returned.getByText("Готово", { exact: true }).first(),
  ).toBeVisible({ timeout: 15000 });
  const result = (
    await api<{ goal: GoalDTO }>(returned, `/api/agent/goals/${key}`)
  ).goal;
  expect(result.status).toBe("COMPLETED");
  expect(result.confirmedAmountMinor).toBe(1000000);
  expect(
    result.events.some(
      (event) =>
        event.type === "payment" || event.description.includes("оплаты"),
    ),
  ).toBe(true);
  await screenshot(returned, info, "goal-completed");
  const artifact = result.artifacts.find((item) => item.verified)!;
  const content = await returned.evaluate(async (path) => {
    const response = await fetch(path);
    return {
      status: response.status,
      text: await response.text(),
      type: response.headers.get("content-type"),
    };
  }, `/api/agent/goals/${key}/artifacts/${artifact.publicKey}`);
  expect(content.status).toBe(200);
  expect(content.text).toContain("## План внедрения");
  expect(content.type).toContain("text/markdown");
  await returned.goto("/");
  await expect(returned.locator(".goal-card")).toHaveCount(1);
  await screenshot(returned, info, "home-result");
  for (const [path, name] of [
    ["/settings", "settings"],
    ["/connections", "connections"],
    ["/autonomy", "autonomy"],
    ["/activity", "activity"],
  ]) {
    await returned.goto(path!);
    await expect(returned.getByRole("heading", { level: 1 })).toBeVisible();
    await screenshot(returned, info, name!);
    expect(
      await returned.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("approval denial pauses the goal and a fresh exact approval resumes it", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const key = await start(page, "Заработай 100 ₽");
  await expect(
    page.getByRole("button", { name: "Отклонить", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await page.getByRole("button", { name: "Отклонить", exact: true }).click();
  await expect(page.getByText("На паузе", { exact: true })).toBeVisible();
  await screenshot(page, info, "goal-paused");
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Разрешить", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Разрешить", exact: true }).click();
  await expect(page.getByText("Готово", { exact: true }).first()).toBeVisible({
    timeout: 15000,
  });
  expect(
    (await api<{ goal: GoalDTO }>(page, `/api/agent/goals/${key}`)).goal
      .confirmedAmountMinor,
  ).toBe(10000);
});

test("new surfaces fit 320/375/390/tablet/desktop and respect reduced motion", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 375, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "Что должно произойти?" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".goal-composer")
        .evaluate((element) => getComputedStyle(element).transitionDuration),
    ).toMatch(/0s/);
    await screenshot(page, info, `home-${width}`);
  }
  await page.goto("/goals/AAAAAAAAAAAAAAAAAAAAAAAA");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await screenshot(page, info, "goal-error");
});
