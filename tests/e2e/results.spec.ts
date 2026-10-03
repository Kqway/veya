import { devices, expect, test, type Page } from "@playwright/test";

async function createPlan(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox").fill("Coffee and a walk together?");
  await page.getByRole("button", { name: "Создать план" }).click();
  await page.getByLabel("Ваше имя").fill("Maya");
  await page.getByRole("button", { name: "Кофе", exact: true }).click();
  await page.getByRole("button", { name: "Создать приглашение" }).click();
  await expect(page).toHaveURL(/\/i\/[A-Za-z0-9_-]{24}$/);
  return page.url();
}
async function join(page: Page, creator: boolean, name: string) {
  await page
    .getByRole("button", {
      name: creator ? "Указать свободное время" : "Присоединиться",
    })
    .click();
  await page.getByLabel("Ваше имя").fill(name);
  await page
    .getByRole("button", { name: /Вечер / })
    .nth(1)
    .click();
  await page.getByRole("button", { name: "Присоединиться к встрече" }).click();
  await expect(
    page.getByRole("heading", { name: `Вы с нами, ${name}.` }),
  ).toBeVisible();
}
test("group overlaps, persistent votes, stale results and explicit organizer confirmation", async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [],
    events: { name: string; surface: string }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/analytics")
      events.push(request.postDataJSON());
  });
  const url = await createPlan(page);
  await join(page, true, "Maya");
  const context = await browser.newContext({
    ...(testInfo.project.name === "mobile"
      ? devices["Pixel 7"]
      : { viewport: { width: 1280, height: 900 } }),
    baseURL: "http://127.0.0.1:3100",
    timezoneId: "Europe/Moscow",
  });
  try {
    const friend = await context.newPage();
    friend.on("pageerror", (error) => errors.push(error.message));
    await friend.goto(`${url}/results`);
    await expect(
      friend.getByRole("region", { name: "Лучший вариант", exact: true }),
    ).toContainText("1 из 1");
    await expect(
      friend.getByRole("list", { name: "Свободное время участников" }),
    ).toHaveCount(0);
    await expect(
      friend.getByRole("button", { name: "ДА", exact: true }),
    ).toHaveCount(0);
    await friend
      .getByRole("link", { name: "Присоединиться к встрече", exact: true })
      .click();
    await join(friend, false, "Sam");
    await friend
      .getByRole("link", { name: "Найти общее время", exact: true })
      .click();
    const best = friend.getByRole("region", {
      name: "Лучший вариант",
      exact: true,
    });
    await expect(best).toContainText("2 из 2");
    await expect(
      best.getByRole("list", { name: "Свободное время участников" }),
    ).toContainText("Maya");
    await expect(
      best.getByRole("list", { name: "Свободное время участников" }),
    ).toContainText("Sam");
    await best.getByRole("button", { name: "ДА", exact: true }).click();
    await expect(
      best.getByRole("button", { name: "ДА", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await friend.reload();
    await expect(best.getByLabel("Голоса участников")).toContainText("ДА 1");
    expect(
      await friend.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await friend.screenshot({
      path: `test-results/phase-4-${testInfo.project.name}-results.png`,
      fullPage: true,
    });

    await page.getByRole("button", { name: "Изменить данные" }).click();
    await page
      .getByRole("button", { name: "Удалить промежуток 1", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Утро / })
      .nth(1)
      .click();
    await page.getByRole("button", { name: "Сохранить изменения" }).click();
    await expect(
      page.getByRole("heading", { name: "Вы с нами, Maya." }),
    ).toBeVisible();
    await best.getByRole("button", { name: "ВОЗМОЖНО", exact: true }).click();
    await expect(
      friend
        .getByRole("alert")
        .filter({ hasText: "Варианты встречи изменились." }),
    ).toBeVisible();
    await friend
      .getByRole("button", { name: "Перезагрузить результаты", exact: true })
      .click();
    await expect(
      friend
        .getByRole("alert")
        .filter({ hasText: "Варианты встречи изменились." }),
    ).toHaveCount(0);
    await expect(best).toContainText("1 из 2");
    await expect(best.getByLabel("Голоса участников")).toContainText("ДА 0");

    await page
      .getByRole("link", { name: "Найти общее время", exact: true })
      .click();
    const ownerBest = page.getByRole("region", {
      name: "Лучший вариант",
      exact: true,
    });
    await expect(ownerBest).toContainText("1 из 2");
    await ownerBest
      .getByRole("button", { name: "Выбрать этот план", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Подтвердить этот вариант для всех?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Встреча запланирована." }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Подтвердить план", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Встреча запланирована." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "ДА", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Выбрать этот план", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/phase-4-${testInfo.project.name}-confirmed.png`,
      fullPage: true,
    });
    await friend
      .getByRole("button", { name: "Обновить результаты", exact: true })
      .click();
    await expect(
      friend.getByRole("heading", { name: "Встреча запланирована." }),
    ).toBeVisible();
    await friend.goto(url);
    await expect(
      friend.getByRole("heading", { name: "Этот план больше нельзя изменить." }),
    ).toBeVisible();
    await expect(
      friend.getByRole("button", { name: "Изменить данные" }),
    ).toHaveCount(0);
    await expect
      .poll(() => events.map((event) => event.name))
      .toContain("result_viewed");
    for (const event of events)
      expect(Object.keys(event).sort()).toEqual(["name", "surface"]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("empty, invalid and expired results provide a useful next step", async ({
  page,
}) => {
  await page.goto("/i/not-an-invite/results");
  await expect(
    page.getByRole("heading", { name: "План не найден." }),
  ).toBeVisible();
  const url = await createPlan(page);
  await page
    .getByRole("link", { name: "Найти общее время", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Нужно ещё немного свободного времени." }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Указать свободное время", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Указать свободное время", exact: true }),
  ).toBeVisible();
  const slug = new URL(url).pathname.split("/").pop()!;
  expect(
    await page.evaluate(
      async (slug) =>
        (await fetch(`/api/intents/${slug}`, { method: "DELETE" })).status,
      slug,
    ),
  ).toBe(200);
  await page.goto(`${url}/results`);
  await expect(page.getByRole("status")).toContainText("Срок приглашения истёк");
  await expect(
    page.getByRole("button", { name: "ДА", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Создать свой план" }),
  ).toBeVisible();
});
