/**
 * WALLET SIGN-IN: NOT IMPLEMENTED (planned for Slice 2).
 *
 * These interfaces define the contract. There is deliberately NO working implementation and no
 * "accept anything" stub. /api/auth/nonce and /api/auth/verify return 501 until this exists.
 *
 * Required before production:
 *  1. Nonce: >= 128 bits from a CSPRNG, bound to {chain, address, domain}, expires in <= 5 minutes,
 *     single use (consume atomically; replay of a consumed or expired nonce must fail).
 *  2. Message: structured sign-in text (domain, address, nonce, issuedAt, expiresAt, statement) that the
 *     wallet displays. It must not be a transaction and must say it costs nothing and moves no funds.
 *  3. Verification: ed25519 signature check with an audited library over the exact message bytes,
 *     against the claimed public key. Reject malformed keys/signatures. A signature is a login proof,
 *     never a password, and is never stored.
 *  4. Ownership: only after verification set wallets.ownership_verified_at.
 *  5. Session: issue via createSession (random token, hash stored). Deliver as an httpOnly Secure
 *     SameSite cookie (browser) or bearer (API clients); add CSRF protection if cookies are used.
 *  6. Rate limit these routes per IP and per address; log failures without logging signatures.
 *  7. Tests: wrong key, wrong message, expired nonce, replayed nonce, nonce for another address.
 */
export interface NonceStore {
  issue(args: { chain: "solana"; address: string; domain: string }): Promise<{ nonce: string; expiresAt: Date }>;
  /** Must atomically mark the nonce consumed. Returns false if missing, expired, consumed, or bound to another address. */
  consume(args: { nonce: string; address: string }): Promise<boolean>;
}

export interface SignatureVerifier {
  verify(args: { address: string; message: Uint8Array; signature: Uint8Array }): Promise<boolean>;
}

export interface SessionIssuer {
  issue(userId: string): Promise<{ token: string; expiresAt: Date }>;
}

export const WALLET_AUTH_STATUS = {
  implemented: false,
  plannedSlice: "Slice 2",
  note: "Wallet signature sign-in is not implemented. Protected routes need a session that cannot yet be issued in production.",
} as const;
