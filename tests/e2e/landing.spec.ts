import { expect, test } from "@playwright/test";

test("renders the landing with no horizontal overflow or browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Veya — Make it happen together");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Less “we should.”More “let’s do it.”");
  await expect(page.getByRole("textbox", { name: "What do you want to do?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Make it happen" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("chooses an example, previews it and edits the same draft", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Meet friends" }).click();
  await page.getByRole("button", { name: "Make it happen" }).click();
  await expect(page.getByRole("heading", { name: "Let's meet somewhere this week." })).toBeFocused();
  await expect(page.getByText("Invites are coming soon. Your idea stays here while you explore.")).toBeVisible();
  await page.getByRole("button", { name: "Edit your idea" }).click();
  await expect(page.getByRole("textbox")).toHaveValue("Let's meet somewhere this week.");
  await expect(page.getByRole("textbox")).toBeFocused();
});

test("validates whitespace and supports keyboard submission", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("textbox");
  await input.fill("   ");
  await input.press("Control+Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Tell us what you'd like to do." }))
    .toHaveText("Tell us what you'd like to do.");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("Coffee this weekend?");
  await input.press("Control+Enter");
  await expect(page.getByRole("heading", { name: "Coffee this weekend?" })).toBeVisible();
});

test("long ideas stay inside the layout and are not persisted across visits", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox").fill("a".repeat(500));
  await page.getByRole("button", { name: "Make it happen" }).click();
  await expect(page.getByRole("heading", { name: "a".repeat(500) })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByRole("textbox")).toHaveValue("");
});

test("returns from the not-found page to the landing", async ({ page }) => {
  const response = await page.goto("/missing-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page wandered off." })).toBeVisible();
  await page.getByRole("link", { name: "Back to Veya" }).click();
  await expect(page.getByRole("textbox")).toBeVisible();
});
