import type { AnalyticsClient } from "./types";

/** Phase 1 has no collection or network requests. Persistence comes in Phase 2. */
export const analytics: AnalyticsClient = {
  async track() {},
};

export type { AnalyticsClient, AnalyticsEvent, AnalyticsEventName } from "./types";
