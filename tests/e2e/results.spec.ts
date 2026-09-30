import { devices, expect, test, type Page } from "@playwright/test";

async function createPlan(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox").fill("Coffee and a walk together?");
  await page.getByRole("button", { name: "Make it happen" }).click();
  await page.getByLabel("Your name").fill("Maya");
  await page.getByRole("button", { name: "Coffee", exact: true }).click();
  await page.getByRole("button", { name: "Create invite" }).click();
  await expect(page).toHaveURL(/\/i\/[A-Za-z0-9_-]{24}$/);
  return page.url();
}
async function join(page: Page, creator: boolean, name: string) {
  await page
    .getByRole("button", {
      name: creator ? "Add your availability" : "Add yourself",
    })
    .click();
  await page.getByLabel("Display name").fill(name);
  await page
    .getByRole("button", { name: /Evening / })
    .nth(1)
    .click();
  await page.getByRole("button", { name: "Join the plan" }).click();
  await expect(
    page.getByRole("heading", { name: `You're in, ${name}.` }),
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
      friend.getByRole("region", { name: "Best match", exact: true }),
    ).toContainText("1 of 1");
    await expect(
      friend.getByRole("list", { name: "Group availability" }),
    ).toHaveCount(0);
    await expect(
      friend.getByRole("button", { name: "YES", exact: true }),
    ).toHaveCount(0);
    await friend
      .getByRole("link", { name: "Join the plan", exact: true })
      .click();
    await join(friend, false, "Sam");
    await friend
      .getByRole("link", { name: "Find a time together", exact: true })
      .click();
    const best = friend.getByRole("region", {
      name: "Best match",
      exact: true,
    });
    await expect(best).toContainText("2 of 2");
    await expect(
      best.getByRole("list", { name: "Group availability" }),
    ).toContainText("Maya");
    await expect(
      best.getByRole("list", { name: "Group availability" }),
    ).toContainText("Sam");
    await best.getByRole("button", { name: "YES", exact: true }).click();
    await expect(
      best.getByRole("button", { name: "YES", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await friend.reload();
    await expect(best.getByLabel("Group votes")).toContainText("YES 1");
    expect(
      await friend.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await friend.screenshot({
      path: `test-results/phase-4-${testInfo.project.name}-results.png`,
      fullPage: true,
    });

    await page.getByRole("button", { name: "Edit your details" }).click();
    await page
      .getByRole("button", { name: "Remove time 1", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Morning / })
      .nth(1)
      .click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("heading", { name: "You're in, Maya." }),
    ).toBeVisible();
    await best.getByRole("button", { name: "MAYBE", exact: true }).click();
    await expect(
      friend
        .getByRole("alert")
        .filter({ hasText: "These suggestions changed." }),
    ).toBeVisible();
    await friend
      .getByRole("button", { name: "Reload results", exact: true })
      .click();
    await expect(
      friend
        .getByRole("alert")
        .filter({ hasText: "These suggestions changed." }),
    ).toHaveCount(0);
    await expect(best).toContainText("1 of 2");
    await expect(best.getByLabel("Group votes")).toContainText("YES 0");

    await page
      .getByRole("link", { name: "Find a time together", exact: true })
      .click();
    const ownerBest = page.getByRole("region", {
      name: "Best match",
      exact: true,
    });
    await expect(ownerBest).toContainText("1 of 2");
    await ownerBest
      .getByRole("button", { name: "Choose this plan", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Make this the group plan?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "It's a plan." }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Confirm plan", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "It's a plan." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "YES", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Choose this plan", exact: true }),
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
      .getByRole("button", { name: "Refresh results", exact: true })
      .click();
    await expect(
      friend.getByRole("heading", { name: "It's a plan." }),
    ).toBeVisible();
    await friend.goto(url);
    await expect(
      friend.getByRole("heading", { name: "This plan is closed to changes." }),
    ).toBeVisible();
    await expect(
      friend.getByRole("button", { name: "Edit your details" }),
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
    page.getByRole("heading", { name: "This plan couldn't be found." }),
  ).toBeVisible();
  const url = await createPlan(page);
  await page
    .getByRole("link", { name: "Find a time together", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A little more availability." }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Add availability", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add your availability", exact: true }),
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
  await expect(page.getByRole("status")).toContainText("expired");
  await expect(
    page.getByRole("button", { name: "YES", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Another idea? Start a new plan →" }),
  ).toBeVisible();
});
