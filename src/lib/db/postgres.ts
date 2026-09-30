import "server-only";
import { Pool, type QueryResultRow } from "pg";
import type { Database, DatabaseExecutor, DatabaseResult } from "./types";

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

export function createDatabase(connectionString: string): Database {
  return new PostgresDatabase(connectionString);
}
