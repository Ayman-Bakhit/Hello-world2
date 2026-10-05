import pg from "pg";
import { migrate } from "../src/db/migrate";
import { seedDemo } from "../src/db/seed";
import { TEST_DB_NAME, adminUrl, testDbUrl } from "./dbUrls";

/**
 * Creates a fresh, dedicated test database (name must end with _test), migrates it from the
 * checked-in schema + migrations, and seeds demo rows. Never touches any other database.
 */
export default async function setup() {
  if (!TEST_DB_NAME.endsWith("_test")) throw new Error("Test database name must end with _test");
  const admin = new pg.Client({ connectionString: adminUrl() });
  try {
    await admin.connect();
  } catch (e) {
    throw new Error(`Cannot reach PostgreSQL for tests (${(e as Error).message}). Start Postgres and set TEST_ADMIN_DATABASE_URL if needed.`);
  }
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: testDbUrl() });
  try {
    await migrate(pool);
    await seedDemo(pool);
  } finally {
    await pool.end();
  }
}
