import "server-only";
import { Pool, type QueryResultRow } from "pg";
import { logOperationalEvent } from "@/lib/logging/server";
import type { Database, DatabaseExecutor, DatabaseResult } from "./types";

export interface DatabaseOptions { max?: number; sslMode?: "verify-full"; }

class PostgresDatabase implements Database {
  private readonly pool: Pool;

  private closing: Promise<void> | undefined;

  constructor(connectionString: string, options: DatabaseOptions = {}) {
    const max = options.max ?? 5;
    if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error("Invalid DB_POOL_MAX.");
    if (options.sslMode) {
      const url = new URL(connectionString);
      for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(key);
      connectionString = url.toString();
    }
    // pg connects on the first query, not when the adapter is constructed.
    this.pool = new Pool({
      connectionString,
      max,
      ...(options.sslMode ? { ssl: { rejectUnauthorized: true } } : {}),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
    });
    this.pool.on("error", () => {
      // Deliberately omit driver error details, which can contain connection info.
      logOperationalEvent("database_idle_error");
    });
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<DatabaseResult<Row>> {
    const result = await this.pool.query<Row>(text, [...values]);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }

  async close(): Promise<void> {
    this.closing ??= this.pool.end();
    await this.closing;
  }

  async transaction<T>(work: (tx: DatabaseExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let destroy = false;
    try {
      await client.query("BEGIN");
      const tx: DatabaseExecutor = {
        async query<Row extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []) {
          const result = await client.query<Row>(text, [...values]);
          return { rows: result.rows, rowCount: result.rowCount ?? 0 };
        },
      };
      const result = await work(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { destroy = true; }
      throw error;
    } finally { client.release(destroy); }
  }
}

export function createDatabase(connectionString: string, options: DatabaseOptions = {}): Database {
  return new PostgresDatabase(connectionString, options);
}
