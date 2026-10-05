import { loadConfig } from "../config";
import { createPool } from "./pool";
import { migrate } from "./migrate";
import { seedDemo } from "./seed";

const cmd = process.argv[2];
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

try {
  if (cmd === "migrate") {
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
  } else if (cmd === "seed-demo") {
    if (config.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
    await seedDemo(pool);
    console.log("Demo data seeded (idempotent).");
  } else {
    console.error("Usage: cli <migrate|seed-demo>");
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
