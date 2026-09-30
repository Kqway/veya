import "server-only";
import { Pool, type QueryResultRow } from "pg";
import type { Database, DatabaseResult } from "./types";

class PostgresDatabase implements Database {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    // pg connects on the first query, not when the adapter is constructed.
    this.pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
    });
    this.pool.on("error", () => {
      // Deliberately omit driver error details, which can contain connection info.
      console.error("PostgreSQL idle connection failed.");
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
    await this.pool.end();
  }
}

export function createDatabase(connectionString: string): Database {
  return new PostgresDatabase(connectionString);
}
