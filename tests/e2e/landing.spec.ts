import { expect, test } from "../support/browser-test";
test("renders the landing without overflow or browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/plan");
  await expect(page).toHaveTitle("Veya — Что должно произойти?");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(
    page.getByRole("textbox", { name: "Чем хотите заняться?" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("example and keyboard submission collect details and allow editing", async ({
  page,
}) => {
  await page.goto("/plan");
  const input = page.getByRole("textbox");
  await input.fill("   ");
  await input.press("Control+Enter");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Расскажите, чем хотите заняться." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Встретиться с друзьями" }).click();
  await input.press("Control+Enter");
  await expect(
    page.getByRole("heading", { name: "Давайте встретимся на этой неделе." }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Изменить идею" }).click();
  await expect(page.getByRole("textbox")).toHaveValue(
    "Давайте встретимся на этой неделе.",
  );
});
test("long ideas create persistent invites inside the layout", async ({
  page,
}) => {
  await page.goto("/plan");
  await page.getByRole("textbox").fill("a".repeat(500));
  await page.getByRole("button", { name: "Создать план" }).click();
  await page.getByLabel("Ваше имя").fill("Alex");
  await page.getByRole("button", { name: "Создать приглашение" }).click();
  await expect(page).toHaveURL(/\/i\/[A-Za-z0-9_-]{24}$/);
  await expect(page.getByText("a".repeat(500), { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByText("a".repeat(500), { exact: true })).toBeVisible();
});
test("returns from a missing page to the landing", async ({ page }) => {
  expect((await page.goto("/missing-page"))?.status()).toBe(404);
  await page.getByRole("link", { name: "На главную Veya" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("textbox", { name: "Что должно произойти?", exact: true })).toBeVisible();
});
