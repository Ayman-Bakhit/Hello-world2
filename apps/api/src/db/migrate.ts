import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "./pool";

const here = dirname(fileURLToPath(import.meta.url));

/** Repo-root db/ directory (works from src/db via tsx and from dist/ after bundling). */
export function findDbDir(): string {
  for (const rel of ["../../../../db", "../../../db", "../../db", "../db"]) {
    const p = join(here, rel);
    try {
      readdirSync(join(p, "migrations"));
      return p;
    } catch {
      /* try next */
    }
  }
  throw new Error("Could not locate db/migrations");
}

/**
 * Applies db/schema.sql if the database is empty, then any unapplied db/migrations/*.sql in order.
 * Idempotent. Never drops, truncates, or resets anything.
 */
export async function migrate(pool: Pool, dbDir = findDbDir()): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");

    const base = await client.query("SELECT to_regclass('public.users') AS t");
    if (base.rows[0].t === null) {
      await client.query("BEGIN");
      await client.query(readFileSync(join(dbDir, "schema.sql"), "utf8"));
      await client.query("INSERT INTO schema_migrations(filename) VALUES ('000_baseline_schema.sql')");
      await client.query("COMMIT");
      applied.push("000_baseline_schema.sql");
    }

    const done = new Set((await client.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename as string));
    const files = readdirSync(join(dbDir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      try {
        await client.query("BEGIN");
        await client.query(readFileSync(join(dbDir, "migrations", f), "utf8"));
        await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [f]);
        await client.query("COMMIT");
        applied.push(f);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${f} failed and was rolled back: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => undefined);
    client.release();
  }
  return applied;
}
