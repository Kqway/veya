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
  retries: process.env.CI ? 1 : 0,
  workers: 2,
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
