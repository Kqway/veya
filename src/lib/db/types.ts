import type { QueryResultRow } from "pg";

export interface DatabaseResult<Row> {
  rows: Row[];
  rowCount: number;
}

export interface DatabaseExecutor {
  /** Bind user values with $1, $2, ...; never interpolate them into SQL text. */
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<DatabaseResult<Row>>;
}

export interface Database extends DatabaseExecutor {
  transaction<T>(work: (tx: DatabaseExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
