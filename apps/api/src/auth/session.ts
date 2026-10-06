import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "../db/pool";

/** Session tokens are 256-bit random values. Only a SHA-256 hash is stored; the token is shown once. */
export const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AuthMethod = "wallet_signature" | "dev_insecure";

/** Anything with .query (a Pool or a transaction client). */
type Queryable = Pick<Pool, "query">;

export interface NewSession {
  userId: string;
  walletId: string | null;
  authMethod: AuthMethod;
  ttlHours: number;
}

export async function createSession(db: Queryable, s: NewSession): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + s.ttlHours * 3_600_000);
  await db.query("INSERT INTO sessions (id_hash, user_id, wallet_id, auth_method, expires_at) VALUES ($1,$2,$3,$4,$5)", [
    hashToken(token), s.userId, s.walletId, s.authMethod, expiresAt,
  ]);
  return { token, expiresAt };
}

export interface SessionInfo {
  userId: string;
  walletId: string | null;
  authMethod: AuthMethod;
  expiresAt: Date;
}

/** `allowDev` must be false in production: dev_insecure sessions are then rejected even if a row exists. */
export async function lookupSession(pool: Pool, token: string, opts: { allowDev: boolean }): Promise<SessionInfo | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const r = await pool.query(
    "SELECT user_id, wallet_id, auth_method, expires_at FROM sessions WHERE id_hash = $1 AND revoked_at IS NULL AND expires_at > now()",
    [hashToken(token)],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.auth_method === "dev_insecure" && !opts.allowDev) return null;
  return { userId: row.user_id as string, walletId: (row.wallet_id as string | null) ?? null, authMethod: row.auth_method as AuthMethod, expiresAt: row.expires_at as Date };
}

export async function revokeSession(pool: Pool, token: string): Promise<void> {
  if (!TOKEN_PATTERN.test(token)) return;
  await pool.query("UPDATE sessions SET revoked_at = now() WHERE id_hash = $1 AND revoked_at IS NULL", [hashToken(token)]);
}
