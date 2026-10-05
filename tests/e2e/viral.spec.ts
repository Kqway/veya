import { expect, test } from "@playwright/test";
test("invite previews stay public and joining/voting lead to another plan", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const events: unknown[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/analytics")
      events.push(r.postDataJSON());
  });
  await page.goto("/plan");
  await page.getByRole("textbox").fill("PRIVATE IDEA for friends");
  await page.getByRole("button", { name: "Создать план" }).click();
  await page.getByLabel("Ваше имя").fill("Artem");
  await page.getByRole("button", { name: "Создать приглашение" }).click();
  await expect(page).toHaveURL(/\/i\/[\w-]{24}$/);
  const invite = page.url();
  const html = await page.request.get(invite);
  const markup = await html.text();
  expect(markup).toContain('content="Artem предлагает встретиться 👀"');
  const meta = markup
    .match(/<meta[^>]+(?:property|name)="(?:og:|twitter:)[^>]+>/g)!
    .join(" ");
  expect(meta).not.toContain("PRIVATE IDEA");
  const og = await page
    .locator('meta[property="og:image"]')
    .getAttribute("content");
  expect(og).toBeTruthy();
  const image = await page.request.get(og!);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
  expect(image.headers()["cache-control"]).toContain("no-store");
  await page.getByRole("button", { name: "Указать свободное время" }).click();
  await expect(page.getByLabel("Ваше имя")).toBeFocused();
  await page.getByLabel("Ваше имя").fill("Artem");
  await page
    .getByRole("button", { name: /Вечер / })
    .nth(1)
    .click();
  await expect(
    page.getByText("Выбрано промежутков: 1. Можно добавить ещё."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Присоединиться к встрече" }).click();
  await expect(
    page.getByRole("heading", { name: "Вы с нами, Artem." }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/phase-6-${info.project.name}-invite.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "Создать свой план" }).click();
  await expect(page).toHaveURL("/");
  await expect
    .poll(() => events)
    .toContainEqual({ name: "new_intent_from_invite", surface: "invite" });
  await page.goto(`${invite}/results`);
  await page.getByRole("button", { name: "ДА", exact: true }).first().click();
  await expect(
    page.getByRole("button", { name: "ДА", exact: true }).first(),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Создать свой план" }).click();
  await expect(page).toHaveURL("/");
  await expect
    .poll(() => events)
    .toContainEqual({ name: "new_intent_from_invite", surface: "result" });
  expect(errors).toEqual([]);
});
test("narrow screens retain usable controls and reduced motion", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/plan");
  await page.getByRole("textbox").fill("Coffee somewhere this week");
  await page.getByRole("button", { name: "Создать план" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const target = await page
    .getByRole("button", { name: "Создать приглашение" })
    .boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page
      .locator(".details-card")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.screenshot({
    path: `test-results/phase-6-${info.project.name}-320px.png`,
    fullPage: true,
  });
});
