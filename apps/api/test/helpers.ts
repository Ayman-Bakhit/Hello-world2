import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { DEMO_IDS } from "@project-name/shared";
import { buildApp } from "../src/app";
import { loadConfig, type Config } from "../src/config";
import { createPool, type Pool } from "../src/db/pool";
import { createSession } from "../src/auth/session";
import { testDbUrl } from "./dbUrls";

export const W = DEMO_IDS.wallets;

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: "test", DATABASE_URL: testDbUrl(), LOG_LEVEL: "silent", AUTH_MODE: "dev-insecure",
    CORS_ORIGINS: "http://localhost:3000", RATE_LIMIT_MAX: "100000", RATE_LIMIT_WRITE_MAX: "100000", ...over,
  });
}

export interface Ctx {
  app: FastifyInstance;
  pool: Pool;
  /** session for the seeded demo user (owns the three demo wallets) */
  demoToken: string;
  close(): Promise<void>;
}

export async function makeCtx(over: Record<string, string> = {}, logStream?: { write(m: string): void }): Promise<Ctx> {
  const config = testConfig(over);
  const pool = createPool(config.DATABASE_URL);
  const app = await buildApp({ config, pool, ...(logStream ? { logStream } : {}) });
  await app.ready();
  const { token } = await createSession(pool, DEMO_IDS.user, 1);
  return { app, pool, demoToken: token, async close() { await app.close(); await pool.end(); } };
}

export const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/** A second, NON-demo user with one wallet, for authorization-boundary tests. */
export async function makeOtherUser(pool: Pool) {
  const u = await pool.query("INSERT INTO users (display_name) VALUES ('other') RETURNING id");
  const userId = u.rows[0].id as string;
  const address = `OTHER${randomBytes(12).toString("hex")}`;
  const w = await pool.query("INSERT INTO wallets (user_id, chain, address, label, data_source) VALUES ($1,'solana',$2,'Other','database') RETURNING id", [userId, address]);
  const { token } = await createSession(pool, userId, 1);
  return { userId, walletId: w.rows[0].id as string, address, token };
}
