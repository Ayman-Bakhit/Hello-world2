import { randomBytes } from "node:crypto";
import { getAddressFromPublicKey } from "@solana/addresses";
import { generateKeyPair, signBytes } from "@solana/keys";
import type { FastifyInstance } from "fastify";
import { DEMO_IDS } from "@project-name/shared";
import { buildApp } from "../src/app";
import type { IndexerParts } from "../src/indexer/service";
import { loadConfig, type Config } from "../src/config";
import { createPool, type Pool } from "../src/db/pool";
import { createSession } from "../src/auth/session";
import { testDbUrl } from "./dbUrls";

export const W = DEMO_IDS.wallets;

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: "test", DATABASE_URL: testDbUrl(), LOG_LEVEL: "silent", AUTH_MODE: "dev-insecure", SOLANA_CLUSTER: "devnet",
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

export async function makeCtx(over: Record<string, string> = {}, logStream?: { write(m: string): void }, indexer?: IndexerParts): Promise<Ctx> {
  const config = testConfig(over);
  const pool = createPool(config.DATABASE_URL);
  const app = await buildApp({ config, pool, ...(logStream ? { logStream } : {}), ...(indexer ? { indexer } : {}) });
  await app.ready();
  const { token } = await createSession(pool, { userId: DEMO_IDS.user, walletId: null, authMethod: "dev_insecure", ttlHours: 1 });
  return { app, pool, demoToken: token, async close() { await app.close(); await pool.end(); } };
}

export const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/** A second, NON-demo user with one wallet, for authorization-boundary tests. */
export async function makeOtherUser(pool: Pool) {
  const u = await pool.query("INSERT INTO users (display_name) VALUES ('other') RETURNING id");
  const userId = u.rows[0].id as string;
  const address = `OTHER${randomBytes(12).toString("hex")}`;
  const w = await pool.query("INSERT INTO wallets (user_id, chain, address, label, data_source) VALUES ($1,'solana',$2,'Other','database') RETURNING id", [userId, address]);
  const { token } = await createSession(pool, { userId, walletId: w.rows[0].id as string, authMethod: "wallet_signature", ttlHours: 1 });
  return { userId, walletId: w.rows[0].id as string, address, token };
}

export const ORIGIN = "http://localhost:3000";
const browser = { origin: ORIGIN };

/**
 * An ephemeral test wallet: a fresh in-memory ed25519 key pair from @solana/keys. Test-only; the
 * application itself never creates, receives, or stores private keys.
 */
export async function makeSigner() {
  const kp = await generateKeyPair();
  const address = await getAddressFromPublicKey(kp.publicKey);
  return {
    address,
    /** base64 signature over the UTF-8 bytes of `text` */
    async sign(text: string): Promise<string> {
      return Buffer.from(await signBytes(kp.privateKey, new TextEncoder().encode(text))).toString("base64");
    },
  };
}
export type Signer = Awaited<ReturnType<typeof makeSigner>>;

export async function requestNonce(app: FastifyInstance, address: string, headers: Record<string, string> = browser) {
  return app.inject({ method: "POST", url: "/api/auth/nonce", payload: { address }, headers });
}

export function cookieValue(res: { cookies: Array<{ name: string; value: string }> }, name = "pn_session"): string | undefined {
  return res.cookies.find((c) => c.name === name)?.value;
}

/** Full happy-path sign-in. Returns the verify response plus the challenge used. */
export async function signIn(app: FastifyInstance, signer: Signer, headers: Record<string, string> = browser, cookie?: string) {
  const n = await requestNonce(app, signer.address, headers);
  if (n.statusCode !== 200) throw new Error(`nonce failed: ${n.statusCode} ${n.body}`);
  const ch = n.json() as { nonce: string; message: string };
  const res = await app.inject({
    method: "POST", url: "/api/auth/verify", headers: { ...headers, ...(cookie ? { cookie } : {}) },
    payload: { address: signer.address, nonce: ch.nonce, message: ch.message, signature: await signer.sign(ch.message) },
  });
  return { res, ch };
}
