import { expect, test } from "@playwright/test";
test("reviewed local assistance persists hints and enriches a deterministic voted plan", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const requests: { path: string; body: unknown }[] = [];
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (path === "/api/ai/intent" || path.endsWith("/assist"))
      requests.push({ path, body: req.postDataJSON() });
  });
  await page.goto("/plan");
  await page.getByRole("textbox").fill("Coffee in Bristol tomorrow under $20");
  await page.getByRole("button", { name: "Создать план" }).click();
  await page.getByLabel("Ваше имя").fill("Maya");
  await page.getByLabel("Место или район (необязательно)").fill("My manual place");
  await page
    .getByRole("button", { name: "Помочь с деталями", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Предложенные детали" }),
  ).toBeVisible();
  await expect(page.getByLabel("Место или район (необязательно)")).toHaveValue(
    "My manual place",
  );
  await page
    .getByRole("button", { name: "Применить детали", exact: true })
    .click();
  await expect(page.getByLabel("Ваше имя")).toHaveValue("Maya");
  await expect(page.getByLabel("Место или район (необязательно)")).toHaveValue(
    "Bristol",
  );
  await expect(
    page.getByRole("button", { name: "Кофе", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("Указанный бюджет: under $20", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/phase-5-${testInfo.project.name}-details.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Создать приглашение", exact: true })
    .click();
  await expect(page).toHaveURL(/\/i\/[A-Za-z0-9_-]{24}$/);
  const url = page.url(),
    slug = new URL(url).pathname.split("/").pop()!;
  const saved = await page.evaluate(
    async (slug) =>
      (await (await fetch(`/api/intents/${slug}`)).json()).intent
        .structuredIntent,
    slug,
  );
  expect(saved).toMatchObject({
    type: "meet",
    activities: ["coffee"],
    location: "Bristol",
    budgetHint: "under $20",
  });
  expect(saved.dateHint.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.reload();
  await expect(
    page.getByText("Указанный бюджет: under $20", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Указать свободное время", exact: true })
    .click();
  await page.getByLabel("Ваше имя").fill("Maya");
  await page
    .getByRole("button", { name: /Вечер / })
    .nth(1)
    .click();
  await page
    .getByRole("button", { name: "Присоединиться к встрече", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Вы с нами, Maya." }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Найти общее время", exact: true })
    .click();
  const best = page.getByRole("region", { name: "Лучший вариант", exact: true });
  await expect(best).toContainText("1 из 1");
  await best
    .getByRole("button", { name: "Предложить идею встречи", exact: true })
    .click();
  await expect(
    best.getByRole("region", { name: "Идея встречи", exact: true }),
  ).toContainText("Кофе");
  await expect(
    best.getByRole("button", { name: "ДА", exact: true }),
  ).toBeEnabled();
  await best.getByRole("button", { name: "ДА", exact: true }).click();
  await expect(
    best.getByRole("button", { name: "ДА", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    best.getByRole("region", { name: "Идея встречи", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/phase-5-${testInfo.project.name}-idea.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(
    best.getByRole("button", { name: "ДА", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    best.getByRole("region", { name: "Идея встречи", exact: true }),
  ).toHaveCount(0);
  await best
    .getByRole("button", { name: "Выбрать этот план", exact: true })
    .click();
  await page.getByRole("button", { name: "Подтвердить план", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Встреча запланирована." }),
  ).toBeVisible();
  const confirmed = page.getByRole("region", {
    name: "Подтверждённый план",
    exact: true,
  });
  await confirmed
    .getByRole("button", { name: "Предложить идею встречи", exact: true })
    .click();
  await expect(
    confirmed.getByRole("region", { name: "Идея встречи", exact: true }),
  ).toBeVisible();
  await expect(
    confirmed.getByRole("button", { name: "ДА", exact: true }),
  ).toHaveCount(0);
  const parseRequest = requests.find((req) => req.path === "/api/ai/intent")!;
  expect(Object.keys(parseRequest.body as object).sort()).toEqual([
    "referenceDate",
    "text",
    "timeZone",
  ]);
  for (const req of requests.filter((req) => req.path.endsWith("/assist")))
    expect(Object.keys(req.body as object).sort()).toEqual([
      "revision",
      "suggestionKey",
    ]);
  expect(errors).toEqual([]);
});
test("helper request failure preserves manual creation", async ({ page }) => {
  await page.route("**/api/ai/intent", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":{"code":"SERVICE_UNAVAILABLE"}}',
    }),
  );
  await page.goto("/plan");
  await page.getByRole("textbox").fill("A simple coffee");
  await page.getByRole("button", { name: "Создать план" }).click();
  await page.getByLabel("Ваше имя").fill("Alex");
  await page
    .getByRole("button", { name: "Помочь с деталями", exact: true })
    .click();
  await expect(
    page.getByText(/Добавьте детали сами/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Создать приглашение", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "План готов. Приглашайте друзей." }),
  ).toBeVisible();
});
