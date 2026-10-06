import { z } from "zod";

const Origin = z.string().refine((s) => {
  if (s === "*") return false;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && u.origin === s;
  } catch {
    return false;
  }
}, "must be an exact origin like https://app.example.com (no wildcard, no path)");

/** Blank values in .env (e.g. `INDEXER_MAX_TRANSACTIONS_PER_SYNC=`) mean "use the default". */
const blank = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema);
const RpcUrl = z.string().refine((s) => {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
  } catch {
    return false;
  }
}, "must be an https URL (http is allowed only for localhost)");

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  CORS_ORIGINS: z.string().default("http://localhost:3000").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)).pipe(z.array(Origin).min(1)),
  /** 'wallet': Solana wallet-signature sign-in only (default). 'dev-insecure': ALSO registers the dev-only session endpoint; refused in production. */
  AUTH_MODE: z.enum(["wallet", "dev-insecure"]).default("wallet"),
  /** Origin of the web app users sign in to (must be one of CORS_ORIGINS). Defaults to the first CORS origin. */
  AUTH_ORIGIN: z.string().optional().transform((v) => (v ? v : undefined)),
  SOLANA_CLUSTER: z.enum(["devnet", "testnet", "mainnet"]).default("devnet"),
  NONCE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  COOKIE_SAMESITE: z.enum(["strict", "lax"]).default("strict"),
  /** Cookies are always Secure in production. In development set true when serving over https. */
  COOKIE_SECURE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // ---- Solana indexing (READ-ONLY). The RPC URL may contain an API key: it is server-side only and never logged or returned. ----
  /** Empty = indexing disabled (balances/transactions stay "no live data"). */
  SOLANA_RPC_URL: blank(RpcUrl.optional()),
  SOLANA_COMMITMENT: blank(z.enum(["finalized", "confirmed"]).default("finalized")),
  SOLANA_RPC_TIMEOUT_MS: blank(z.coerce.number().int().min(500).max(60_000).default(10_000)),
  /** Bounded initial sync: how many of the most recent transactions to index the first time. */
  INDEXER_INITIAL_TRANSACTION_LIMIT: blank(z.coerce.number().int().min(1).max(1000).default(50)),
  /** Cap on transactions fetched in any later sync. */
  INDEXER_MAX_TRANSACTIONS_PER_SYNC: blank(z.coerce.number().int().min(1).max(1000).default(100)),
  INDEXER_MAX_TOKEN_ACCOUNTS: blank(z.coerce.number().int().min(1).max(5000).default(500)),
  INDEXER_MAX_METADATA_LOOKUPS: blank(z.coerce.number().int().min(0).max(200).default(25)),
  /** Hard ceiling on RPC calls in one sync, whatever else is configured. */
  INDEXER_MAX_RPC_CALLS_PER_SYNC: blank(z.coerce.number().int().min(10).max(5000).default(400)),
  INDEXER_MAX_RUN_SECONDS: blank(z.coerce.number().int().min(10).max(900).default(120)),
  /** Minimum gap between syncs of the same wallet (cooldown). */
  INDEXER_MIN_SYNC_INTERVAL_SECONDS: blank(z.coerce.number().int().min(0).max(86_400).default(30)),
  INDEXER_MAX_CONCURRENT_SYNCS: blank(z.coerce.number().int().min(1).max(20).default(2)),
  /** Kick off a bounded sync in the background after a successful wallet sign-in. */
  INDEXER_SYNC_ON_LOGIN: blank(z.enum(["true", "false"]).default("true")).transform((v) => v === "true"),
  /** Requests per window per IP for POST /wallets/:id/sync (on top of the per-wallet cooldown). */
  INDEXER_SYNC_RATE_LIMIT_MAX: blank(z.coerce.number().int().min(1).max(100).default(5)),
  // ---- Tax data (Slice 6) ----
  /** A stored price counts for a transaction only if it was observed at most this long before it (no look-ahead). */
  TAX_PRICE_MAX_AGE_SECONDS: blank(z.coerce.number().int().min(60).max(86_400 * 7).default(3600)),
  /** Hard cap on transactions read for one tax calculation; beyond it the result is marked incomplete. */
  TAX_MAX_TRANSACTIONS: blank(z.coerce.number().int().min(100).max(50_000).default(5000)),
  /** Rows listed in a tax report/export. More than this is reported as DATA_REQUIRED (listing capped, totals complete); an export is refused. */
  REPORT_MAX_ROWS: blank(z.coerce.number().int().min(1).max(200_000).default(20_000)),
  /** Concurrent tax calculations: process-wide and per user. Over the limit is an explicit 503/429, not a queue. */
  TAX_MAX_CONCURRENT: blank(z.coerce.number().int().min(1).max(64).default(16)),
  TAX_MAX_CONCURRENT_PER_USER: blank(z.coerce.number().int().min(1).max(16).default(8)),
  // ---- Prices ----
  /** none = no prices (assets show PRICE DATA UNAVAILABLE). coingecko = SOL only. */
  PRICE_PROVIDER: blank(z.enum(["none", "coingecko"]).default("none")),
  PRICE_API_URL: blank(z.string().url().optional()),
  PRICE_API_KEY: blank(z.string().optional()),
  /** A price older than this is shown as stale. */
  PRICE_MAX_AGE_SECONDS: blank(z.coerce.number().int().min(10).max(86_400 * 7).default(900)),
  /** Max outstanding (unused, unexpired) sign-in challenges per wallet address. */
  MAX_OPEN_NONCES_PER_ADDRESS: z.coerce.number().int().min(1).max(100).default(10),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export interface Derived {
  authOrigin: string;
  authDomain: string;
  chainId: string;
  cookieName: string;
  cookieSecure: boolean;
}
export type Config = z.infer<typeof Env> & Derived;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  const prod = c.NODE_ENV === "production";
  if (prod && c.AUTH_MODE === "dev-insecure") {
    throw new Error("Refusing to start: AUTH_MODE=dev-insecure is not allowed when NODE_ENV=production");
  }
  if (prod && c.CORS_ORIGINS.some((o) => !o.startsWith("https://"))) {
    throw new Error("Refusing to start: CORS_ORIGINS must all be https:// when NODE_ENV=production");
  }
  if (prod && c.SOLANA_RPC_URL && !c.SOLANA_RPC_URL.startsWith("https://")) {
    throw new Error("Refusing to start: SOLANA_RPC_URL must be https:// when NODE_ENV=production");
  }
  const authOrigin = c.AUTH_ORIGIN ?? c.CORS_ORIGINS[0]!;
  if (!c.CORS_ORIGINS.includes(authOrigin)) throw new Error("Invalid configuration: AUTH_ORIGIN must be one of CORS_ORIGINS");
  const cookieSecure = prod || c.COOKIE_SECURE;
  return {
    ...c,
    authOrigin,
    authDomain: new URL(authOrigin).host,
    chainId: `solana:${c.SOLANA_CLUSTER}`,
    // __Host- prefix (browser-enforced: Secure, Path=/, no Domain) whenever the cookie is Secure.
    cookieName: cookieSecure ? "__Host-pn_session" : "pn_session",
    cookieSecure,
  };
}
