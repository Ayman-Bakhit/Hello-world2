import pg from "pg";

// int8 and numeric come back as strings by default; keep that. Never coerce money to JS numbers.
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, statement_timeout: 10_000 });
}
export type Pool = pg.Pool;
