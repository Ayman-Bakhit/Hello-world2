import { randomBytes } from "node:crypto";
import { buildSignInMessage, type NonceResponse } from "@project-name/shared";
import type { Config } from "../config";
import type { Pool } from "../db/pool";
import { ApiError } from "../errors";
import { createSession } from "./session";
import { parseSignerAddress, verifyEd25519 } from "./solana";

/**
 * Nonce lifecycle
 *   issue   : 192-bit CSPRNG nonce, bound to {chain, address}, stored with the exact message text,
 *             valid for NONCE_TTL_SECONDS (default 300).
 *   consume : ONE atomic UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING.
 *             Whoever wins the UPDATE owns the nonce. It is consumed BEFORE the signature is checked and
 *             stays consumed on failure: one attempt per challenge, so a leaked/guessed nonce cannot be
 *             retried and replay of a captured request always fails.
 * The server never trusts the client's message: it must equal the stored text exactly.
 */

export async function issueChallenge(pool: Pool, config: Config, addressInput: string): Promise<NonceResponse> {
  const address = parseSignerAddress(addressInput);
  if (!address) throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", { address: ["not a valid Solana wallet address"] });

  // Opportunistic cleanup of long-dead challenges only (never touches users, wallets, or sessions).
  await pool.query("DELETE FROM auth_nonces WHERE expires_at < now() - interval '1 day'");

  const open = await pool.query("SELECT count(*)::int AS n FROM auth_nonces WHERE address = $1 AND consumed_at IS NULL AND expires_at > now()", [address]);
  if ((open.rows[0].n as number) >= config.MAX_OPEN_NONCES_PER_ADDRESS) {
    throw new ApiError(429, "TOO_MANY_CHALLENGES", "Too many open sign-in challenges for this wallet. Wait for them to expire and retry.");
  }

  // One clock for issue and expiry checks: the database's.
  const now: Date = (await pool.query("SELECT date_trunc('milliseconds', now()) AS n")).rows[0].n;
  const expires = new Date(now.getTime() + config.NONCE_TTL_SECONDS * 1000);
  const nonce = randomBytes(24).toString("base64url"); // 32 chars, 192 bits
  const message = buildSignInMessage({
    domain: config.authDomain, uri: config.authOrigin, address, chainId: config.chainId,
    nonce, issuedAt: now.toISOString(), expirationTime: expires.toISOString(),
  });
  await pool.query(
    "INSERT INTO auth_nonces (nonce, chain, address, issued_at, expires_at, message, domain, chain_id) VALUES ($1,'solana',$2,$3,$4,$5,$6,$7)",
    [nonce, address, now, expires, message, config.authDomain, config.chainId],
  );
  return { nonce, message, domain: config.authDomain, chainId: config.chainId, issuedAt: now.toISOString(), expiresAt: expires.toISOString() };
}

export type VerifyFailure = "invalid_address" | "nonce_unavailable" | "message_mismatch" | "bad_signature" | "demo_wallet";
export type VerifyResult =
  | { ok: true; userId: string; walletId: string; createdUser: boolean; session: { token: string; expiresAt: Date } }
  | { ok: false; reason: VerifyFailure };

export async function verifySignIn(
  pool: Pool,
  config: Config,
  req: { address: string; nonce: string; message: string; signature: Uint8Array },
): Promise<VerifyResult> {
  const address = parseSignerAddress(req.address);
  if (!address) return { ok: false, reason: "invalid_address" };

  // 1. Atomically claim the nonce. Single use, bound to this address, unexpired, chain-bound.
  const claimed = await pool.query(
    `UPDATE auth_nonces SET consumed_at = now()
     WHERE nonce = $1 AND address = $2 AND chain = 'solana' AND consumed_at IS NULL AND expires_at > now()
     RETURNING message`,
    [req.nonce, address],
  );
  const row = claimed.rows[0];
  if (!row) return { ok: false, reason: "nonce_unavailable" };

  // 2. The message must be exactly what this server issued for this nonce.
  if (row.message !== req.message) return { ok: false, reason: "message_mismatch" };

  // 3. ed25519 signature over those exact bytes, by the key that IS the address.
  if (!(await verifyEd25519(address, row.message as string, req.signature))) return { ok: false, reason: "bad_signature" };

  // 4. User / wallet lookup-or-create and session issue, atomically. A per-address advisory lock makes
  //    concurrent first sign-ins for the same wallet serialize, so duplicate users cannot be created.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`wallet:solana:${address}`]);

    let userId: string;
    let walletId: string;
    let createdUser = false;
    const existing = await client.query(
      "SELECT w.id, w.user_id, w.data_source, u.is_demo FROM wallets w JOIN users u ON u.id = w.user_id WHERE w.chain = 'solana' AND w.address = $1",
      [address],
    );
    const w = existing.rows[0];
    if (w) {
      if (w.data_source === "demo" || w.is_demo) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "demo_wallet" };
      }
      walletId = w.id as string;
      userId = w.user_id as string;
      // Proven control: mark verified (first time only keeps the original timestamp) and re-activate if it was soft-removed.
      await client.query("UPDATE wallets SET ownership_verified_at = COALESCE(ownership_verified_at, now()), removed_at = NULL WHERE id = $1", [walletId]);
    } else {
      const u = await client.query("INSERT INTO users DEFAULT VALUES RETURNING id");
      userId = u.rows[0].id as string;
      createdUser = true;
      const ins = await client.query(
        "INSERT INTO wallets (user_id, chain, address, data_source, ownership_verified_at) VALUES ($1,'solana',$2,'database', now()) RETURNING id",
        [userId, address],
      );
      walletId = ins.rows[0].id as string;
    }

    const session = await createSession(client, { userId, walletId, authMethod: "wallet_signature", ttlHours: config.SESSION_TTL_HOURS });
    await client.query("COMMIT");
    return { ok: true, userId, walletId, createdUser, session };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
