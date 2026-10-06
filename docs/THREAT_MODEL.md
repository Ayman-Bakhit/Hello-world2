# Threat Model (v0)

Assets: user funds (never held), wallet-address-to-identity links, tax/portfolio data, charity registry integrity, fee-split configuration, admin powers, protocol treasury.

| # | Threat | Mitigation | Status |
|---|---|---|---|
| 1 | Key/seed theft | Never request, store, or log keys. No signing keys in API. CI secret scan. | Design |
| 2 | Auth replay | 192-bit single-use nonce consumed atomically, 5 min expiry, bound to address and chain; exact server-issued message; ed25519 verify; one attempt per challenge | **Done (Slice 2)**, mutation-tested |
| 3 | Session theft / CSRF | httpOnly Secure SameSite cookies, hashed tokens, CSRF tokens on state changes, short TTL, revocation | Pending |
| 4 | Phishing-style malicious tx | Server builds tx, simulates, shows full "WHAT YOU ARE SIGNING" (asset, amount, destination, program, fees); client re-decodes from bytes, not from server summary | Pending |
| 5 | Fake charity wallet | Admin-verified registry, wallet verified separately, changes audit-logged, destination changes need re-verification and cooling period | Schema done |
| 6 | Rug via hidden authority | Display mint/freeze/update/upgrade authority read from chain; label derived from chain; Verified Transparency needs objective checks | Pending |
| 7 | UI lies about immutability | Label computed from on-chain state; test that fails if label and chain disagree | Pending |
| 8 | Fee split rounding or sum error | bps integers, sum==10000 enforced in shared TS, API (Zod uses shared validator), review step, and DB CHECK on launch configs; property tests; on-chain mirror tests | TS+API+DB done; on-chain pending |
| 9 | Malicious/untrusted token metadata (XSS) | Escape everywhere, strict CSP, sanitize image URIs, never render HTML from chain | Pending |
| 10 | Indexer poisoning / reorgs | Confirmed commitment only for tax data; raw payload retained; idempotent re-derivation | Pending |
| 11 | Wrong tax numbers | Pure engine, extensive tests, assumptions snapshot stored, estimates labeled | Done for engine core |
| 12 | Admin abuse | Named roles documented, every action logged with before/after + reason, no hidden super-admin, 2-person approval for verification and fee changes (target) | Schema done |
| 13 | SQL injection | Parameterized queries only (all SQL in `db/repos.ts`), zod validation, strict objects | Done for API; keep reviewing new queries |
| 14 | Rate abuse / DoS | Global + write rate limits, 64 KB body limit, per-account draft cap | Partial: in-memory limiter (single process), per-IP only, no per-wallet limit, no Redis |
| 15 | RPC key leak | Keys server-side only, proxied calls | Pending |
| 16 | Privacy leakage | Tax/portfolio data never public; public pages expose only disclosed creator info | Design |
| 17 | Wallet clustering by analytics | Don't link wallets publicly; user opts into display name | Design |
| 18 | Smart contract bugs | Established audited libs where possible; unit, invariant, fuzz, static analysis, independent audit before mainnet | Blocked on contract design |
| 19 | Supply chain | Lockfile, pinned deps, audit in CI, minimal deps in wallet/signing paths | Partial |
| 20 | Manipulation of rankings/metrics | No fake activity features. Discover ranks on real data; wash-trade detection to be added | Policy |

Out of scope for v0: nation-state attackers, compromised user device.

## Slice 1 additions (API)
| # | Threat | Mitigation | Status |
|---|---|---|---|
| 21 | Unauthenticated access to private data | Bearer session required on wallet/portfolio/tax/reserve/donation/launch routes; tests assert 401 for each | Done (boundary); issuance not production-ready |
| 22 | Horizontal privilege escalation (read/write another user's wallet, launch, donation, target) | Owner filter in every SQL query; foreign resources return 404; tests per resource | Done |
| 23 | Insecure dev login reaching production | `dev-insecure` refused at startup when `NODE_ENV=production`; endpoint not registered otherwise; limited to `is_demo` users; loud warning log | Done; verify deploy config sets NODE_ENV |
| 24 | Fake wallet auth giving false assurance | Superseded: real signature verification shipped in Slice 2; no accept-anything path exists; dev-session is separate, flagged, and rejected in production | Done |
| 25 | Demo data mistaken for chain facts | `dataSource` + `verifiedOnChain` on every response, enforced by response schemas; empty `evidence`; web client validates | Done |
| 26 | Donation shown as completed without a transaction | Only status `demo` can be created; DB CHECK blocks `confirmed` without a recorded tx | Done; real confirmation flow pending |
| 27 | Fee split described as locked when it is not | Always "Configured fee split", `enforcement:"not_enforced"`, `mutability:"UNDETERMINED"`; review never `deployable` | Done until contracts exist |
| 28 | Secrets in logs | Authorization/Cookie redacted; no request-body logging; tested | Done |
| 29 | CORS misconfiguration | Exact-origin allowlist, wildcard rejected at config load, no credentials | Done |
| 30 | Session token theft/replay | 256-bit tokens, hash-only storage, absolute expiry, server-side revocation, logout, rotation at login, HttpOnly/Secure/SameSite=Strict/__Host- cookie | Partial: no device binding, idle timeout, session list/revoke-all |
| 31 | Duplicate writes (retries) | None yet | **Gap**: no idempotency keys on POST /donations, /launches |
| 32 | Response drift / data leaks via extra fields | Responses validated against Zod contracts before sending; wallet type has no secret fields | Done (non-strict: extra fields are stripped, not rejected) |
| 33 | Enumeration of IDs | UUIDs; 404 for foreign resources | Done |
| 34 | Missing transport security / headers | helmet defaults; TLS expected at reverse proxy | **Gap**: no HSTS config or TLS termination guidance tested; no CSRF (not needed for bearer) |
| 35 | No admin/audit surface | Not built; `audit_logs` schema exists | **Gap**: charity verification is seed-only; admin actions pending |
| 36 | DB hardening | Statement timeout, pool cap, parameterized SQL | **Gap**: app uses one DB role; no RLS; no least-privilege role split yet |

## Slice 2 additions (wallet authentication)
| # | Threat | Mitigation | Status |
|---|---|---|---|
| 37 | Forged or replayed sign-in | Single-use nonce, exact stored message, ed25519 verification, uniform 401; tests for wrong key, modified message/nonce/address, cross-wallet, replay, expiry | Done |
| 38 | Phishing site relays a sign-in request | Message names the app domain/URI; client refuses challenges for another origin; server accepts nonce/verify only from allowlisted Origins; wallet shows the text | Partial: raw signMessage text is only as safe as the user reading it; consider SIWS `solana:signIn` with wallet-side domain checks |
| 39 | Login CSRF (victim logged into attacker's account) | Origin allowlist on every state-changing request incl. `/nonce`, `/verify`; SameSite=Strict | Done |
| 40 | Logout CSRF / cross-site actions with the cookie | Cookie requests need an allowlisted Origin; SameSite=Strict | Done |
| 41 | XSS reading the session | HttpOnly cookie, nothing in web storage, token never in a body | Done for theft; an XSS can still act within the session until CSP/hardening (Slice 11) |
| 42 | Session fixation | Tokens are server-generated; login revokes the presented session | Done |
| 43 | Account takeover via an unverified wallet record | Wallet rows are created only by verified sign-in; verification marks `ownership_verified_at` | Done today; **future wallet-linking must require a signature from the linked wallet** |
| 44 | Duplicate accounts from concurrent first sign-ins | Per-address advisory lock in a transaction + UNIQUE(chain,address); concurrency test | Done |
| 45 | Nonce table flooding / challenge DoS | Per-address open-nonce cap, write rate limit per IP, 1-day cleanup | Partial: per-IP limiter is in-memory; no CAPTCHA/proof-of-work |
| 46 | Oracle leakage of why a sign-in failed | Uniform `AUTH_FAILED` body; reasons only in server logs (no secrets) | Done |
| 47 | Dev auth reaching production | Startup refusal, unregistered route, 404 handler guard, `dev_insecure` sessions rejected in production; tests | Done; verify deployment sets `NODE_ENV=production` |
| 48 | Wallet signs something else than shown | Client verifies `signedMessage` equals requested bytes and the signature is 64 bytes; challenge shape checked before signing | Done (client side); wallet UI fidelity is the wallet's job |
| 49 | User switches account in the extension mid-session | UI compares connected address to authenticated wallet and warns (`addressMismatch`); session stays bound to the verified wallet | Partial: no live `standard:events` listener |
| 50 | Key loss / no recovery | None by design (non-custodial, no email/password) | Accepted; document to users |
| 51 | Clock skew between app and DB | One clock (database) issues and validates expiry | Done |
| 52 | Cross-site cookie deployment mistakes | `SameSite=Strict` + `__Host-` require same-site hosting; documented | Documented; verify at deploy |
