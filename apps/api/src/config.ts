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
