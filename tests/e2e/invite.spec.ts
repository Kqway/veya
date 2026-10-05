import { devices, expect, test, type Page } from "@playwright/test";
async function createPlan(page: Page) {
  await page.goto("/plan");
  await page.getByRole("textbox").fill("Coffee and a walk this week?");
  await page.getByRole("button", { name: "Создать план" }).click();
  await page.getByLabel("Ваше имя").fill("Maya");
  await page.getByRole("button", { name: "Кофе", exact: true }).click();
  await page
    .getByLabel("Место или район (необязательно)", { exact: true })
    .fill("Riverside");
  await page.getByRole("button", { name: "Создать приглашение" }).click();
  await expect(page).toHaveURL(/\/i\/[A-Za-z0-9_-]{24}$/);
  await expect(
    page.getByRole("heading", { name: "План готов. Приглашайте друзей." }),
  ).toBeVisible();
  return page.url();
}
async function addAvailability(page: Page) {
  await page
    .getByRole("button", { name: /Вечер / })
    .nth(1)
    .click();
}
test("creator shares, a separate guest joins, refreshes, edits and joins only once", async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = await createPlan(page);
  await page.getByRole("button", { name: "Скопировать ссылку" }).click();
  await expect(page.getByLabel("Ссылка на приглашение")).toHaveValue(url);
  const context = await browser.newContext({
    ...(testInfo.project.name === "mobile"
      ? devices["Pixel 7"]
      : { viewport: { width: 1280, height: 900 } }),
    baseURL: "http://127.0.0.1:3100",
    timezoneId: "Europe/Moscow",
  });
  try {
    const friend = await context.newPage();
    friend.on("pageerror", (e) => errors.push(e.message));
    await friend.goto(url);
    await expect(
      friend.getByRole("heading", { name: "Maya предлагает встретиться." }),
    ).toBeVisible();
    await friend.getByRole("button", { name: "Присоединиться" }).click();
    await friend.getByLabel("Ваше имя").fill("Sam");
    await addAvailability(friend);
    await friend
      .getByText("Бюджет, предпочтения и заметка (необязательно)", { exact: true })
      .click();
    await friend.getByLabel("Максимальный бюджет").fill("10.29");
    await friend.getByLabel("Занятия", { exact: true }).fill("Coffee");
    await friend.getByLabel("Заметка (необязательно)").fill("I can bring snacks.");
    await friend.getByRole("button", { name: "Присоединиться к встрече" }).click();
    await expect(
      friend.getByRole("heading", { name: "Вы с нами, Sam." }),
    ).toBeVisible();
    expect(
      await friend.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await friend.reload();
    await expect(
      friend.getByRole("heading", { name: "Вы с нами, Sam." }),
    ).toBeVisible();
    await friend.getByRole("button", { name: "Изменить данные" }).click();
    await friend
      .getByText("Бюджет, предпочтения и заметка (необязательно)", { exact: true })
      .click();
    await expect(friend.getByLabel("Максимальный бюджет")).toHaveValue("10.29");
    await friend.getByLabel("Заметка (необязательно)").fill("Bring a jacket.");
    await friend.getByRole("button", { name: "Сохранить изменения" }).click();
    await expect(
      friend.getByText("Bring a jacket.", { exact: true }),
    ).toBeVisible();
    const slug = new URL(url).pathname.split("/").pop()!;
    const result = await friend.evaluate(async (slug) => {
      const response = await fetch(`/api/intents/${slug}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Duplicate" }),
      });
      return { status: response.status, body: await response.json() };
    }, slug);
    expect(result.status).toBe(200);
    expect(result.body.intent.participantCount).toBe(1);
    expect(result.body.ownParticipant.displayName).toBe("Sam");
    await page.reload();
    await expect(
      page.getByText("Свободное время указали: 1", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Bring a jacket.", { exact: true }),
    ).toHaveCount(0);
    await friend.screenshot({
      path: `test-results/phase-3-${testInfo.project.name}-joined.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
test("invalid and closed invites have a useful way forward", async ({
  page,
}) => {
  await page.goto("/i/not-an-invite");
  await expect(
    page.getByRole("heading", { name: "Приглашение не найдено." }),
  ).toBeVisible();
  const url = await createPlan(page);
  const slug = new URL(url).pathname.split("/").pop()!;
  expect(
    await page.evaluate(
      async (slug) =>
        (await fetch(`/api/intents/${slug}`, { method: "DELETE" })).status,
      slug,
    ),
  ).toBe(200);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Срок приглашения истёк." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Указать свободное время" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Создать новый план", exact: true }),
  ).toBeVisible();
});
test("revoked membership cannot silently replace its identity on edit", async ({
  page,
}) => {
  await createPlan(page);
  await page.getByRole("button", { name: "Указать свободное время" }).click();
  await page.getByLabel("Ваше имя").fill("Maya");
  await addAvailability(page);
  await page.getByRole("button", { name: "Присоединиться к встрече" }).click();
  await expect(
    page.getByRole("heading", { name: "Вы с нами, Maya." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Изменить данные" }).click();
  expect(
    await page.evaluate(
      async () => (await fetch("/api/session", { method: "DELETE" })).status,
    ),
  ).toBe(200);
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Сеанс завершён." }),
  ).toBeVisible();
  await expect(page.getByLabel("Ваше имя")).toHaveValue("Maya");
});

test("enabled analytics follows entry actions without personal properties", async ({
  page,
}) => {
  // This journey asserts a successful native clipboard write. Denial/fallback is
  // covered separately; headless Chromium does not grant this permission by default.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:3100",
  });
  const events: { name: string; surface: string }[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/analytics")
      events.push(request.postDataJSON());
  });
  await createPlan(page);
  await page.getByRole("button", { name: "Скопировать ссылку" }).click();
  await expect(page.getByRole("status").filter({hasText:"Ссылка скопирована. Приглашайте друзей!"})).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  await expect
    .poll(() => events.map((event) => event.name))
    .toEqual(
      expect.arrayContaining([
        "landing_view",
        "intent_started",
        "invite_opened",
        "invite_link_copied",
      ]),
    );
  for (const event of events)
    expect(Object.keys(event).sort()).toEqual(["name", "surface"]);
});

test("custom local ranges save UTC instants and reject overlapping selections", async ({
  page,
}) => {
  await createPlan(page);
  await page.getByRole("button", { name: "Указать свободное время" }).click();
  await page.getByLabel("Ваше имя").fill("Alex");
  const date = await page.evaluate(() => {
    const day = new Date();
    day.setDate(day.getDate() + 1);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  });
  await page.getByText("Указать другое время", { exact: true }).click();
  await page.getByLabel("Дата", { exact: true }).fill(date);
  await page.getByLabel("Время начала", { exact: true }).fill("09:30");
  await page.getByLabel("Время окончания", { exact: true }).fill("11:00");
  await page.getByRole("button", { name: "Добавить время", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Выбранное свободное время" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: /Утро / })
    .nth(1)
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Промежутки времени пересекаются." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Выбранное свободное время" })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Присоединиться к встрече" }).click();
  await expect(
    page.getByRole("heading", { name: "Вы с нами, Alex." }),
  ).toBeVisible();
  const saved = await page.evaluate(
    async () =>
      (
        await (
          await fetch(`/api/intents/${location.pathname.split("/").pop()}`)
        ).json()
      ).ownParticipant,
  );
  expect(saved.availability).toEqual([
    { startAt: `${date}T06:30:00.000Z`, endAt: `${date}T08:00:00.000Z` },
  ]);
});
