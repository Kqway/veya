import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

process.env.VEYA_TEST_ADMIN_SECRET ??= randomBytes(32).toString("base64url");

const systemChromium =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (!process.env.CI && existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // A release gate must fail on its first broken journey, even if retrying could
  // pass. Preserve the first trace rather than accepting a flaky hosted result.
  retries: 0,
  // Independent journeys share the real global production quotas in one isolated
  // database. Pace them; realtime journeys still run multiple actors together.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "Europe/Moscow",
    launchOptions: systemChromium ? { executablePath: systemChromium } : {},
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node --conditions=react-server --import tsx tests/e2e/server.ts",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
