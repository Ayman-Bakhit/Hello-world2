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
| 8 | Fee split rounding or sum error | bps integers, sum==10000 enforced in TS and DB; property tests; on-chain mirror tests | TS+DB done |
| 9 | Malicious/untrusted token metadata (XSS) | Escape everywhere, strict CSP, sanitize image URIs, never render HTML from chain | Pending |
| 10 | Indexer poisoning / reorgs | Confirmed commitment only for tax data; raw payload retained; idempotent re-derivation | Pending |
| 11 | Wrong tax numbers | Pure engine, extensive tests, assumptions snapshot stored, estimates labeled | Done for engine core |
| 12 | Admin abuse | Named roles documented, every action logged with before/after + reason, no hidden super-admin, 2-person approval for verification and fee changes (target) | Schema done |
| 13 | SQL injection | Parameterized queries only, zod validation | Pending |
| 14 | Rate abuse / DoS | Redis rate limits per IP and wallet, request size limits | Pending |
| 15 | RPC key leak | Keys server-side only, proxied calls | Pending |
| 16 | Privacy leakage | Tax/portfolio data never public; public pages expose only disclosed creator info | Design |
| 17 | Wallet clustering by analytics | Don't link wallets publicly; user opts into display name | Design |
| 18 | Smart contract bugs | Established audited libs where possible; unit, invariant, fuzz, static analysis, independent audit before mainnet | Blocked on contract design |
| 19 | Supply chain | Lockfile, pinned deps, audit in CI, minimal deps in wallet/signing paths | Partial |
| 20 | Manipulation of rankings/metrics | No fake activity features. Discover ranks on real data; wash-trade detection to be added | Policy |

Out of scope for v0: nation-state attackers, compromised user device.
