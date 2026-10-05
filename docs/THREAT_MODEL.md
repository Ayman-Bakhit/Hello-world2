# Threat Model (v0)

Assets: user funds (never held), wallet-address-to-identity links, tax/portfolio data, charity registry integrity, fee-split configuration, admin powers, protocol treasury.

| # | Threat | Mitigation | Status |
|---|---|---|---|
| 1 | Key/seed theft | Never request, store, or log keys. No signing keys in API. CI secret scan. | Design |
| 2 | Auth replay | Nonce single-use, 5 min expiry, bound to address and domain; signature over structured message | Schema done, code pending |
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
| 24 | Fake wallet auth giving false assurance | Nonce/verify return 501; `/auth/status` reports `implemented:false`; requirements checklist in code | Done (honest); Slice 2 must build it |
| 25 | Demo data mistaken for chain facts | `dataSource` + `verifiedOnChain` on every response, enforced by response schemas; empty `evidence`; web client validates | Done |
| 26 | Donation shown as completed without a transaction | Only status `demo` can be created; DB CHECK blocks `confirmed` without a recorded tx | Done; real confirmation flow pending |
| 27 | Fee split described as locked when it is not | Always "Configured fee split", `enforcement:"not_enforced"`, `mutability:"UNDETERMINED"`; review never `deployable` | Done until contracts exist |
| 28 | Secrets in logs | Authorization/Cookie redacted; no request-body logging; tested | Done |
| 29 | CORS misconfiguration | Exact-origin allowlist, wildcard rejected at config load, no credentials | Done |
| 30 | Session token theft/replay | 256-bit tokens, hash-only storage, expiry, revocation; no cookies yet so no CSRF surface | Partial: no rotation, no device binding, no logout endpoint yet |
| 31 | Duplicate writes (retries) | None yet | **Gap**: no idempotency keys on POST /donations, /launches |
| 32 | Response drift / data leaks via extra fields | Responses validated against Zod contracts before sending; wallet type has no secret fields | Done (non-strict: extra fields are stripped, not rejected) |
| 33 | Enumeration of IDs | UUIDs; 404 for foreign resources | Done |
| 34 | Missing transport security / headers | helmet defaults; TLS expected at reverse proxy | **Gap**: no HSTS config or TLS termination guidance tested; no CSRF (not needed for bearer) |
| 35 | No admin/audit surface | Not built; `audit_logs` schema exists | **Gap**: charity verification is seed-only; admin actions pending |
| 36 | DB hardening | Statement timeout, pool cap, parameterized SQL | **Gap**: app uses one DB role; no RLS; no least-privilege role split yet |
