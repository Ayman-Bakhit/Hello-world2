import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createPool } from "./db/pool";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = await buildApp({ config, pool });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.PORT, host: config.HOST });
if (config.AUTH_MODE === "dev-insecure") {
  app.log.warn("AUTH_MODE=dev-insecure: /api/auth/dev-session issues sessions without wallet signatures. Local development only.");
}
