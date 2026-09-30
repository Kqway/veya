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
  await page.goto("/");
  await page.getByRole("textbox").fill("Coffee in Bristol tomorrow under $20");
  await page.getByRole("button", { name: "Make it happen" }).click();
  await page.getByLabel("Your name").fill("Maya");
  await page.getByLabel("Place or area (optional)").fill("My manual place");
  await page
    .getByRole("button", { name: "Help with details", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Suggested details" }),
  ).toBeVisible();
  await expect(page.getByLabel("Place or area (optional)")).toHaveValue(
    "My manual place",
  );
  await page
    .getByRole("button", { name: "Apply details", exact: true })
    .click();
  await expect(page.getByLabel("Your name")).toHaveValue("Maya");
  await expect(page.getByLabel("Place or area (optional)")).toHaveValue(
    "Bristol",
  );
  await expect(
    page.getByRole("button", { name: "Coffee", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("Budget mentioned: under $20", { exact: true }),
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
    .getByRole("button", { name: "Create invite", exact: true })
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
    page.getByText("Budget mentioned: under $20", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add your availability", exact: true })
    .click();
  await page.getByLabel("Display name").fill("Maya");
  await page
    .getByRole("button", { name: /Evening / })
    .nth(1)
    .click();
  await page
    .getByRole("button", { name: "Join the plan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "You're in, Maya." }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Find a time together", exact: true })
    .click();
  const best = page.getByRole("region", { name: "Best match", exact: true });
  await expect(best).toContainText("1 of 1");
  await best
    .getByRole("button", { name: "Get a meetup idea", exact: true })
    .click();
  await expect(
    best.getByRole("region", { name: "Meetup idea", exact: true }),
  ).toContainText("coffee");
  await expect(
    best.getByRole("button", { name: "YES", exact: true }),
  ).toBeEnabled();
  await best.getByRole("button", { name: "YES", exact: true }).click();
  await expect(
    best.getByRole("button", { name: "YES", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    best.getByRole("region", { name: "Meetup idea", exact: true }),
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
    best.getByRole("button", { name: "YES", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    best.getByRole("region", { name: "Meetup idea", exact: true }),
  ).toHaveCount(0);
  await best
    .getByRole("button", { name: "Choose this plan", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm plan", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "It's a plan." }),
  ).toBeVisible();
  const confirmed = page.getByRole("region", {
    name: "Confirmed plan",
    exact: true,
  });
  await confirmed
    .getByRole("button", { name: "Get a meetup idea", exact: true })
    .click();
  await expect(
    confirmed.getByRole("region", { name: "Meetup idea", exact: true }),
  ).toBeVisible();
  await expect(
    confirmed.getByRole("button", { name: "YES", exact: true }),
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
  await page.goto("/");
  await page.getByRole("textbox").fill("A simple coffee");
  await page.getByRole("button", { name: "Make it happen" }).click();
  await page.getByLabel("Your name").fill("Alex");
  await page
    .getByRole("button", { name: "Help with details", exact: true })
    .click();
  await expect(
    page.getByText(/You can keep adding details yourself/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create invite", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your plan is ready to invite people." }),
  ).toBeVisible();
});
