import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "../db/pool";

/** Session tokens are 256-bit random values. Only a SHA-256 hash is stored; the token is shown once. */
export const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function createSession(pool: Pool, userId: string, ttlHours: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await pool.query("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1,$2,$3)", [hashToken(token), userId, expiresAt]);
  return { token, expiresAt };
}

export async function lookupSession(pool: Pool, token: string): Promise<{ userId: string } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const r = await pool.query("SELECT user_id FROM sessions WHERE id_hash = $1 AND revoked_at IS NULL AND expires_at > now()", [hashToken(token)]);
  const row = r.rows[0];
  return row ? { userId: row.user_id as string } : null;
}

export async function revokeSession(pool: Pool, token: string): Promise<void> {
  await pool.query("UPDATE sessions SET revoked_at = now() WHERE id_hash = $1 AND revoked_at IS NULL", [hashToken(token)]);
}
