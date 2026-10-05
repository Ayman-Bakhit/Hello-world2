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
  /** 'disabled': protected routes are unreachable (no way to mint a session). 'dev-insecure': local dev session endpoint, refused in production. */
  AUTH_MODE: z.enum(["disabled", "dev-insecure"]).default("disabled"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === "production" && c.AUTH_MODE === "dev-insecure") {
    throw new Error("Refusing to start: AUTH_MODE=dev-insecure is not allowed when NODE_ENV=production");
  }
  return c;
}
