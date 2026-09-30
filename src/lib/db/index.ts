import "server-only";
import { getServerEnv } from "@/lib/config/server";
import { createDatabase } from "./postgres";
import type { Database } from "./types";

let database: Database | undefined;

export function getDatabase(): Database {
  if (database) return database;
  const { DATABASE_URL } = getServerEnv();
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required for database access. See .env.example.");
  }
  database = createDatabase(DATABASE_URL);
  return database;
}

export type { Database, DatabaseExecutor, DatabaseResult } from "./types";
