# Security

Security over speed. Current state: design only plus pure-math code; no network surface exists yet.

Rules: no seed phrases or private keys requested, stored, or logged; no secrets in the frontend; secrets via env (see `.env.example`), RPC keys server-side; parameterized SQL; zod validation on all inputs; rate limiting; CSRF protection; strict CSP; signature verification with replay protection; simulate and summarize every transaction before signing.

Admin powers: not yet implemented. When built, each role and its exact powers are listed here, every sensitive action is written to `audit_logs` with reason, and there is no undocumented super-admin.

Reporting vulnerabilities: contact channel TBD before beta.

## Slice 1 status
Implemented: Zod validation everywhere, strict bodies, CORS allowlist, rate limiting, helmet headers, structured errors, log redaction, hashed expiring sessions, owner-scoped queries, response contract validation.

**Not implemented / not production-ready:**
- ~~Wallet sign-in~~ implemented in Slice 2 (below).
- Idempotency keys.
- Shared rate-limit store (Redis) for multi-instance deployments; per-wallet limits.
- Admin roles and the audit log writer. Charity verification is seed data only.
- Least-privilege DB role, RLS review, backups, TLS/HSTS deployment guidance.
- Dependency audit in CI.
Do not expose the API to the public internet in this state.

## Slice 2: wallet authentication (Solana)

What it proves: the caller controls the private key for a Solana address, at one moment, for one server-issued challenge. It proves nothing else. A wallet **connection** (extension exposes an address) is not proof of ownership; only a verified **signature** is. The UI and API keep these two states separate (`CONNECTED` vs `AUTHENTICATED`).

### Flow
```
browser                         API                                  PostgreSQL
  | connect (Wallet Standard)    |                                      |
  | POST /api/auth/nonce {address}                                       |
  |----------------------------->| validate address (on-curve, 32 bytes) |
  |                              | 192-bit CSPRNG nonce + message        |
  |                              |------------------------------------->| auth_nonces (message stored verbatim)
  |<-----{nonce, message,...}----|                                      |
  | client checks message is for this wallet + this site, then asks the wallet to sign TEXT (no transaction)
  | POST /api/auth/verify {address, nonce, message, signature(base64)}   |
  |----------------------------->| 1 atomically consume nonce (UPDATE .. WHERE unused AND unexpired AND address matches)
  |                              | 2 message must equal the stored text
  |                              | 3 ed25519 verify (@solana/keys, WebCrypto) against the address's key
  |                              | 4 tx: lock address, find-or-create user+wallet, mark verified, create session
  |<--Set-Cookie (HttpOnly) -----| body has NO token                    |
```

### Message format (version 1, plain text, `\n` line endings, no trailing newline)
```
{domain} wants you to sign in with your Solana account:
{address}

Sign in to PROJECT_NAME. This does not send a transaction or move funds.

URI: {uri}
Version: 1
Chain ID: {chainId}
Nonce: {nonce}
Issued At: {issuedAt}
Expiration Time: {expirationTime}
```
`domain` = host of `AUTH_ORIGIN`, `uri` = `AUTH_ORIGIN`, `chainId` = `solana:<SOLANA_CLUSTER>`, times are ISO-8601 UTC with milliseconds. Builder and strict parser: `packages/shared/src/auth/message.ts`. The message is not a transaction and cannot be submitted to any chain. The wallet shows the text to the user. The client refuses to ask for a signature unless the message is well formed, names this wallet and this site's origin, carries the server's nonce, and is unexpired.

### Nonce lifecycle
- **Issue**: `randomBytes(24)` base64url = 32 chars, 192 bits, from the OS CSPRNG. Not derived from the address or time. Bound to `{chain, address}`. Valid `NONCE_TTL_SECONDS` (default 300). The exact message text is stored. At most `MAX_OPEN_NONCES_PER_ADDRESS` unused, unexpired challenges per address (429 beyond that). Challenges older than a day are deleted opportunistically.
- **Consume**: one atomic `UPDATE ... WHERE nonce=$1 AND address=$2 AND consumed_at IS NULL AND expires_at > now() RETURNING message`. Whoever wins owns it. It is consumed **before** the signature is checked and stays consumed on failure: one attempt per challenge, so a captured request cannot be replayed and a leaked nonce cannot be retried. A client that fails must request a new challenge. Requests that fail schema validation (malformed signature, wrong lengths) are rejected before consumption.
- **One clock**: the database clock issues and checks expiry.

### Verification and replay protection
Rejected, always as the same `401 AUTH_FAILED` body (the reason is logged, not returned): nonce unknown, expired, already used, or issued to a different address; message differs from the issued text; signature does not verify for that address. Malformed input is `400 VALIDATION_ERROR`. Signature crypto is `@solana/addresses` + `@solana/keys` (official Solana Kit, WebCrypto Ed25519); nothing is hand-rolled. Off-curve addresses (PDAs) cannot sign and are refused.
Mutation-tested: removing the address binding, the single-use check, the message comparison, or the signature check each makes the suite fail.

### Users and wallets
Inside one transaction guarded by a per-address advisory lock: existing wallet -> its user; otherwise create a user and wallet. `UNIQUE(chain,address)` is the backstop. Repeated and concurrent sign-ins never duplicate users or wallets. `ownership_verified_at` is set only here (first verification time is preserved). A soft-removed wallet is reactivated for the same user on proof of control. Demo wallets can never be verified (DB CHECK) or signed into.

### Sessions
- 256-bit random token; only its SHA-256 is stored. Absolute expiry `SESSION_TTL_HOURS` (default 12). No sliding extension, no refresh endpoint.
- Browser: HttpOnly cookie, `SameSite=Strict` (configurable to Lax), `Path=/`, no `Domain`. In production it is `Secure` and named `__Host-pn_session` (the browser enforces Secure + Path=/ + no Domain). The token is never in a response body and never reaches page JavaScript or web storage.
- **Rotation**: signing in revokes any session the browser presented. Tokens are server-generated, so fixation is not possible.
- **Logout**: `POST /api/auth/logout` revokes server-side (`revoked_at`) and clears the cookie. A copied cookie is dead immediately. Idempotent.
- Cookie sessions are protected from CSRF by SameSite plus an Origin check: any state-changing request that carries an Origin must come from `CORS_ORIGINS`; a state-changing request presenting the session cookie without an Origin is refused (403). This also blocks login-CSRF on `/nonce` and `/verify`. Bearer clients are unaffected.
- `Cache-Control: no-store` on all auth responses.

### Development authentication
`AUTH_MODE=dev-insecure` registers `POST /api/auth/dev-session`, returning a bearer token for the seeded **demo** user with no signature. Purpose: exercise the demo-backed endpoints locally. Guards: startup refuses it when `NODE_ENV=production`; the route is not registered otherwise; the handler returns 404 in production anyway; sessions carry `auth_method=dev_insecure` and production request handling **rejects** such sessions even if a row exists; it can only ever log in the seeded `is_demo` user. It does not touch the wallet-signature path.

### Production authentication
Wallet signature only. Required configuration: `NODE_ENV=production`, https-only `CORS_ORIGINS`, `AUTH_ORIGIN` (defaults to the first origin), `COOKIE_SAMESITE` strict, API and web on the same site (same registrable domain) or cookies will not be sent, TLS terminated in front, `TRUST_PROXY=true` only behind a trusted proxy.

### Wallet ownership verification
`wallets.ownership_verified_at` is set only by a verified signature. The API exposes it as `ownershipVerified`. Any future "add/link another wallet" feature must require a fresh signature from the new wallet inside an authenticated session; until it exists, each wallet is its own account.

### Still not done (auth-specific)
No idle timeout or sliding refresh; no "list/revoke my sessions" or revoke-all; no step-up re-authentication for sensitive actions; rate limiting is per IP and in-memory (per-address challenge cap only); no wallet-linking; no account recovery (losing the key loses the account); no audit log of sign-ins; the signed message is not a Solana off-chain-message-standard envelope (wallet UIs show it as plain text); Ed25519 signature malleability is irrelevant here because each nonce is single-use, but any future use of signatures as identifiers must handle it.
