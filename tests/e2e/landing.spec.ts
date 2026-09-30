import { expect, test } from "@playwright/test";
test("renders the landing without overflow or browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Veya — Make it happen together");
  await expect(
    page.getByRole("textbox", { name: "What do you want to do?" }),
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
  await page.goto("/");
  const input = page.getByRole("textbox");
  await input.fill("   ");
  await input.press("Control+Enter");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Tell us what you'd like to do." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Meet friends" }).click();
  await input.press("Control+Enter");
  await expect(
    page.getByRole("heading", { name: "Let's meet somewhere this week." }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Edit your idea" }).click();
  await expect(page.getByRole("textbox")).toHaveValue(
    "Let's meet somewhere this week.",
  );
});
test("long ideas create persistent invites inside the layout", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox").fill("a".repeat(500));
  await page.getByRole("button", { name: "Make it happen" }).click();
  await page.getByLabel("Your name").fill("Alex");
  await page.getByRole("button", { name: "Create invite" }).click();
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
  await page.getByRole("link", { name: "Back to Veya" }).click();
  await expect(page.getByRole("textbox")).toBeVisible();
});
