import { expect, test } from "@playwright/test";
test("security headers and explicit overnight times survive join and refresh", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const home = await page.goto("/plan");
  expect(home!.headers()["x-frame-options"]).toBe("DENY");
  expect(home!.headers()["x-content-type-options"]).toBe("nosniff");
  expect(home!.headers()["referrer-policy"]).toBe("no-referrer");
  const invalid = await page.request.get("/api/intents/bad");
  expect(invalid.status()).toBe(404);
  expect(invalid.headers()["cross-origin-resource-policy"]).toBe("same-origin");
  expect(invalid.headers()["cache-control"]).toContain("no-store");
  await page.getByRole("textbox").fill("Late-night coffee");
  await page.getByRole("button", { name: "Создать план" }).click();
  await page.getByLabel("Ваше имя").fill("Artem");
  await page.getByRole("button", { name: "Создать приглашение" }).click();
  await expect(page).toHaveURL(/\/i\/[\w-]{24}$/);
  const html = await page.request.get(page.url());
  expect(html.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await page.getByRole("button", { name: "Указать свободное время" }).click();
  await page.getByLabel("Ваше имя").fill("Artem");
  await page.getByText("Указать другое время", { exact: true }).click();
  const date = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await page.getByLabel("Дата", { exact: true }).fill(date);
  await page.getByLabel("Время начала").fill("22:00");
  await page.getByLabel("Время окончания").fill("01:00");
  await page.getByLabel("Заканчивается на следующий день").check();
  await page.getByRole("button", { name: "Добавить время", exact: true }).click();
  await expect(
    page
      .getByRole("list", { name: "Выбранное свободное время" })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Присоединиться к встрече" }).click();
  await expect(
    page.getByRole("heading", { name: "Вы с нами, Artem." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Вы с нами, Artem." }),
  ).toBeVisible();
  const saved = await page.evaluate(
    async () =>
      (
        await (
          await fetch(`/api/intents/${location.pathname.split("/").pop()}`)
        ).json()
      ).ownParticipant.availability,
  );
  expect(Date.parse(saved[0].endAt) - Date.parse(saved[0].startAt)).toBe(
    3 * 3600000,
  );
  await page.screenshot({
    path: `test-results/phase-7-${info.project.name}-overnight.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("AI quota rejection preserves manual details and creation", async ({
  page,
}) => {
  await page.route("**/api/ai/intent", (route) =>
    route.fulfill({
      status: 429,
      headers: { "Retry-After": "60" },
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "RATE_LIMITED" } }),
    }),
  );
  await page.goto("/plan");
  await page.getByRole("textbox").fill("Coffee tomorrow");
  await page.getByRole("button", { name: "Создать план" }).click();
  await page.getByLabel("Ваше имя").fill("Artem");
  await page
    .getByLabel("Место или район (необязательно)", { exact: true })
    .fill("Riverside");
  await page.getByRole("button", { name: "Помочь с деталями" }).click();
  await expect(page.getByRole("status")).toContainText("Добавьте детали сами");
  await expect(page.getByLabel("Ваше имя")).toHaveValue("Artem");
  await expect(
    page.getByLabel("Место или район (необязательно)", { exact: true }),
  ).toHaveValue("Riverside");
  await page.getByRole("button", { name: "Создать приглашение" }).click();
  await expect(page).toHaveURL(/\/i\/[\w-]{24}$/);
});
