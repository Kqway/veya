import { test as base } from '@playwright/test';
import { resetBrowserRateLimits } from './browser-rate-isolation';
export * from '@playwright/test';
export const test = base.extend<{ rateBudgetIsolation: void }>({
 rateBudgetIsolation: [async ({ browser }, use) => {
  if (!browser.isConnected()) throw new Error('Browser fixture control unavailable.');
  const path = process.env.VEYA_E2E_FIXTURE_FILE;
  if (!path) throw new Error('Browser fixture control unavailable.');
  await resetBrowserRateLimits(path);
  await use();
 }, {auto:true}],
});
