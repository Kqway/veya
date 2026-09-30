import "server-only";
import type { DatabaseExecutor } from "@/lib/db/types";
import type { AnalyticsClient } from "./types";

export function createDatabaseAnalyticsClient(db: DatabaseExecutor): AnalyticsClient {
  return {
    async track(event) {
      await db.query("INSERT INTO analytics_events(event_name,surface) VALUES ($1,$2)", [event.name, event.surface]);
    },
  };
}
