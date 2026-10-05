# Security

Security over speed. Current state: design only plus pure-math code; no network surface exists yet.

Rules: no seed phrases or private keys requested, stored, or logged; no secrets in the frontend; secrets via env (see `.env.example`), RPC keys server-side; parameterized SQL; zod validation on all inputs; rate limiting; CSRF protection; strict CSP; signature verification with replay protection; simulate and summarize every transaction before signing.

Admin powers: not yet implemented. When built, each role and its exact powers are listed here, every sensitive action is written to `audit_logs` with reason, and there is no undocumented super-admin.

Reporting vulnerabilities: contact channel TBD before beta.

## Slice 1 status
Implemented: Zod validation everywhere, strict bodies, CORS allowlist, rate limiting, helmet headers, structured errors, log redaction, hashed expiring sessions, owner-scoped queries, response contract validation.

**Not implemented / not production-ready:**
- Wallet sign-in. Before production (see `apps/api/src/auth/walletAuth.ts`): CSPRNG nonce (>=128 bit, <=5 min, single use, bound to address+domain), structured sign-in message, ed25519 verification with an audited library, set `ownership_verified_at` only after verification, session via httpOnly Secure SameSite cookie or bearer, CSRF if cookies, per-address rate limits, tests for wrong key / replay / expiry / foreign nonce.
- Idempotency keys, logout/revocation endpoint, session rotation.
- Shared rate-limit store (Redis) for multi-instance deployments; per-wallet limits.
- Admin roles and the audit log writer. Charity verification is seed data only.
- Least-privilege DB role, RLS review, backups, TLS/HSTS deployment guidance.
- Dependency audit in CI.
Do not expose the API to the public internet in this state.
