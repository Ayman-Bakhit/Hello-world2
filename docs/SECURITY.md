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

## Slice 5: Solana indexing (read-only)
- **Read-only by construction.** `SolanaRpc` has no method that sends, simulates, or signs. The indexer never asks the wallet for a signature, holds no key, builds no transaction. `POST /api/wallets/:id/sync` only causes reads.
- **RPC credentials are server-side.** `SOLANA_RPC_URL` (may embed an API key) is read from the environment only, must be https in production, is never returned, logged, or included in an error (provider errors are sanitized; a test asserts no response contains it). Never use a `NEXT_PUBLIC_` variable for it.
- **Authorization.** Sync and status are session + ownership checked in SQL; foreign wallets are 404. The wallet address comes from the database, never from the request.
- **Abuse limits.** Per-IP route limit, per-wallet cooldown, one run per wallet (DB-enforced), global concurrency cap, per-sync RPC-call budget and wall-clock cap, bounded token accounts, bounded metadata lookups, response size caps (8 MiB response, 1 MiB stored payload), no redirects followed.
- **All chain data is untrusted.** Every RPC response goes through size cap, lossless parse, envelope check, then Zod normalizers; malformed data is rejected (`RPC_MALFORMED`), never partially trusted. Requested vs returned signature must match. Amounts are bigint, never float.
- **Token metadata is hostile text.** Bounded, control/bidi stripped, URI scheme allowlisted, never fetched, rendered escaped, labeled UNVERIFIED. SPL tokens are identified by mint, never by a self-declared symbol. There is no "verified" badge without an objective source.
- **No invented numbers.** No hardcoded prices; missing price is "unavailable", never zero; partial sums are never totals; tax is never inferred (`not_assessed`).
- **Demo isolation.** Real wallets can never receive demo fixtures; demo wallets can never be synced.
- Residual risks (see INDEXING.md "Verification status"): cluster/URL mismatch is not detected; the RPC node is trusted for data it returns (a malicious/compromised provider can lie; verifiedOnChain stays false for this reason); in-memory rate limiter is per process; `confirmed` commitment is not reorg-safe; the DEX allowlist and Metaplex parsing are unverified against a live network.

## Slice 6: tax data
- Session + ownership on every tax route; the calculation reads only the caller's own wallets (user id from the session, never the request). Foreign wallet ids are 404.
- Demo/live isolation: real wallets never receive fixture results (`UNAVAILABLE` instead); demo wallets never read chain data.
- No fabricated inputs: no hardcoded or default prices, no default tax rates, no invented cost basis (unmatched transfers create no lots), no assumed swap treatment except an explicit, echoed parameter.
- Historical source data: raw transactions immutable (Slice 5); price rows cannot be updated in place (trigger) and zero prices are refused; results carry a sha256 input fingerprint.
- No double counting: duplicates by id or (wallet, signature) are ignored and counted; a same-signature internal transfer is matched, not taxed twice; failed transactions never create lots.
- Precision: bigint/integer strings end to end; no unsafe `Number` conversion of quantities or money.
- Remaining: chain data unverified; no real historical prices; per-request recalculation cost is bounded only by `TAX_MAX_TRANSACTIONS` and a rate limit; user-entered rates travel in the query string (not secret, but visible in logs/history).

## Slice 7: manual cost basis
- **IDOR / cross-wallet**: wallet id comes from the path, is resolved against the session's user in SQL, and every record query filters by user AND wallet. Foreign, other-wallet and unknown records are indistinguishable (`404`). Tested for create, list, read, revise, void, and for reaching a record through the owner's other wallet. Mutation check: dropping either filter fails tests.
- **Audit-log tampering**: identity and revisions are append-only by trigger; "current" is a view; revisions are hash-chained and re-verified on read. A superuser who disables triggers can still edit, but the edit is detected. Not protected against rewriting the whole chain.
- **Duplicates / double counting**: duplicates and overlaps are excluded from the calculation (not merged, not deleted) until the user acknowledges; consumed lots cannot be reused (remaining-lot tracking); manual lots are wallet-scoped. Mutation checks: disabling duplicate review, cross-wallet scoping, lot consumption, and completeness each fail tests.
- **Precision**: exact decimal-to-raw conversion in bigint, `numeric(40,0)` storage, u64-max and >2^53 tested end to end; inexpressible input is rejected, never rounded.
- **Unsafe input / XSS**: strict schemas; notes limited to 1000 plain-text characters, control and bidi-override characters rejected; markup is stored as inert text and rendered escaped by React (browser-tested with an `<img onerror>` payload). Reasons are an enum.
- **Sensitive data in URLs/logs**: amounts, notes and tax rates are only sent in POST bodies (the GET tax routes now refuse rates); request bodies are not logged (tested with a log capture).
- **Provenance honesty**: `source`, `origin` and the UI label `USER-PROVIDED TAX DATA` always travel with the data; `verifiedOnChain` is false; nothing calls it verified.
- **Demo/live**: demo wallets cannot receive records; demo tax ignores them; real wallets never see demo numbers.
- Residual: a user can enter any number (that is the feature); the system cannot detect a false statement, only duplicates and inconsistencies. Records are per wallet and are not shared. Rate limiting is per process.

## Slice 8: tax report and export
- **IDOR / export authorization**: the wallet id comes from the path and is resolved against the session user in SQL; the calculation reads only that user's wallets, transactions and manual basis (user id from the session, never the request). Foreign and unknown wallets are indistinguishable (404) for both the report and the export; no data appears in the error body. Mutation checks: dropping the owner filter, ignoring the requested method, ignoring the year filter, hiding the manual-basis disclosure, weakening the limit-to-status rule and removing CSV escaping each fail tests.
- **CSV / formula injection**: text cells beginning with `=`, `+`, `-`, `@`, tab or CR get an apostrophe prefix; control/bidi characters are removed; plain generated decimals are the only unescaped cells. The columns contain chain values (validated base58), enums, uuids, ISO times and numbers; user notes are never exported. Unit and end-to-end tests cover hostile values.
- **XSS**: report text is rendered by React (escaped); a hostile `<img onerror>` / `<script>` in asset names, signatures and reasons is tested as inert text. JSON is served as `application/json` with `nosniff`, attachments with `Content-Disposition: attachment`.
- **Sensitive data**: the report and export contain no tokens, cookies, session ids, RPC URLs or keys, and no stack traces (tested with a configured RPC URL containing a key, the session token, and a forced internal failure that returns a generic 500). The word "RPC node" appears in a provenance sentence; no URL does.
- **Unsafe filenames**: built only from digits, enum letters and hex; the client re-validates before using it.
- **Oversized / abusive requests**: strict schemas, 64 KB body limit, per-route rate limits, `REPORT_MAX_ROWS` (export refused), `TAX_MAX_TRANSACTIONS` (report marked DATA_REQUIRED with a LIMIT requirement), and a calculation gate (`TAX_MAX_CONCURRENT`, `TAX_MAX_CONCURRENT_PER_USER`) that refuses excess work immediately with 503/429 instead of queueing.
- **Provenance honesty**: fixture prices and user-provided basis are labeled everywhere and never called verified; `verifiedOnChain` is always false.
- Residual: the gate and rate limits are per process; a single allowed calculation can still read up to `TAX_MAX_TRANSACTIONS` rows; the exported CSV is a spreadsheet file and the user is responsible for what they do with it; the data is only as good as the unverified indexed data and any figures the user entered.

## Slice 9: Give / charity foundation
- **No money movement**: there is no endpoint that creates a donation, builds a transaction, requests a signature or sends funds. `POST /api/donations/plan` is stateless (tests assert no `donations` or `raw_transactions` rows change). The old demo-only create endpoint is gone (404).
- **IDOR**: every donation and receipt read filters by the session user in SQL; foreign, unknown and unauthenticated requests are refused (404/401) and the 404 body is identical for foreign and unknown ids. Receipts are reachable only through the owning user's donation. Mutation checks: dropping the owner filter on donation detail, receipt detail and the history list each fail tests.
- **Public vs private**: the registry and evidence are public and contain no donor, wallet or donation data. Admin-only fields (`verification_notes`, `internal_notes`, `verifier_user_id`) are never selected by public or user queries (a mutation that routed internal notes into the public summary fails a test); responses are also schema-parsed.
- **Verification honesty**: VERIFIED is unreachable without supporting evidence from a non-website source; fixture evidence can only back a demo charity, and the UI labels it `VERIFIED (FIXTURE, NOT REAL-WORLD)` with the demo tone. A website URL is shown as "not verified by us".
- **Untrusted metadata**: names, descriptions, summaries and references have control and bidi characters stripped and are rendered as React text only (hostile `<img onerror>` / `<script>` tested inert). URLs are validated at three layers (DB CHECK, API output, UI render): http(s) only (https only for logos and receipt documents), no credentials, no whitespace, <= 500 chars; `javascript:`, `data:`, `file:`, `ftp:` and protocol-relative URLs are refused. Links open with `rel="noopener noreferrer nofollow"`. Logos are not rendered, so no third-party image request is made.
- **Fake confirmation**: CONFIRMED is enforced by constraints and a trigger (chain data, chain provenance, donation time, indexed transaction of the donor wallet); fixture rows can never carry a transaction and the UI never shows a signature for them.
- **Data exposure**: Give responses are `no-store`, contain no session token, RPC URL or secret (tested).
- **Rate limiting**: `plan` uses the write rate limit.
- Residual: no admin mutation path exists, so verification data is seeded; the launch review still treats a fixture-VERIFIED demo charity as verified; the registry endpoints are public and unauthenticated by design (rate-limited like other public reads).

## Slice 10: tax reserve foundation
- **No money movement**: no deposit, withdraw, transfer, fund, escrow, sign or send route exists (route listing and probing tests); the reserve ledger table is write-locked by a database trigger; reserve writes create no transaction or donation row; responses contain no signature field.
- **Estimate vs balance**: the balance is `UNAVAILABLE` for real wallets (never `$0`), a fixture balance is refused by the builder unless the tax estimate is itself a demo fixture, and the target is never read as a balance (a test sets a target equal to the recommendation and asserts coverage stays unavailable).
- **Authorization**: requires a session (401); wallet ownership enforced (foreign and unknown are the same 404); the stored target is read by the session's user id only. A mutation that returned another user's row was initially NOT caught (the tests only covered the wallet-id gate); a user-scoped test was added and now fails the mutation.
- **Input validation**: strict schema; explicit `confirmed: true`; digits-only amounts (NaN, Infinity, exponent, sign, separators, unicode digits, over 12 digits, over 2 decimals, zero and negatives rejected before any write); USDC only; the client cannot choose `SYSTEM_RECOMMENDED`. A rejected request writes no row and no history.
- **Rates**: tax rates are never accepted in a URL (400); they travel in the POST body only.
- **Provenance honesty**: `authoritative:false` and `verifiedOnChain:false` on every figure; nothing is called verified, guaranteed, authoritative, final or a liability; the language lint covers API responses, shared copy, web components and rendered scenarios (new banned phrases: guaranteed tax liability, guaranteed tax savings, tax-free, irs-approved reserve).
- **Hygiene**: `no-store`; no session token, RPC URL or secret in reserve responses (tested). No free-text field was added, so there is no new XSS surface.
- Residual: the tax calculation gate and rate limits are per process; fixture prices and unverified chain data still feed the estimate; user-provided cost basis is unverifiable; no jurisdiction rules; the reserve balance will need an independent ledger design before it can be shown for real wallets.

## Slice 11: launch configuration
- **No deployment surface**: no deploy, mint, liquidity, distribution, payout, donation, transfer, sign or send route exists (route listing and probing tests, API and browser). `deployment` is always not_deployed with null mint, signature and contract.
- **Status control**: only named actions change status, through one transition table; every body is strict, so a status (LIVE, DEPLOYING, READY, VERIFIED, ON_CHAIN) cannot be sent anywhere; the database cannot store DEPLOYING, LIVE or FAILED; READY needs a reviewed fingerprint equal to the current one (constraint), and the ready action needs the exact fingerprint plus explicit confirmation. A stale action (the configuration changed after validation) is refused under a row lock.
- **Ownership**: derived from the session, never the body. Every read and write filters by `creator_user_id` in SQL; a foreign and an unknown launch id (including history and every action) return the identical 404. Unauthenticated access is 401. Tested for read, update, configure, review, ready, cancel and history. Mutation checks: dropping the owner filter on the launch read and on history each fail tests.
- **Fee split**: validated by the shared invariant and required to equal the canonical 60/15/15/10 on the server (frontend validation is not trusted); the database also refuses a non-canonical split and a bad sum. It is never described as immutable.
- **Untrusted metadata**: plain-text names and descriptions (control and bidi characters and angle brackets rejected); URLs validated at the API, re-validated at render, rel=noopener noreferrer nofollow; no image is ever loaded and the server never fetches a URL; supply and decimals validated with exact BigInt arithmetic (u64 bound).
- **References**: the creator wallet and the tax reserve destination must be the actor's wallets; the charity must exist in the registry (a name or unknown id is rejected); verification is judged against the registry's current state, which the UI and public view show with its source.
- **Public view**: opt-in (`publish`), READY only; no user id, session, full wallet address, tax reserve destination, review internals or history (tested); hides again after an edit or cancel.
- **History**: append-only, hash-chained, owner-only; tampering outside the API is detected (tested). Not a blockchain proof.
- **Language**: banned phrases, "immutable", "deployed", "live", "earned/received/paid" are linted over responses and UI; fixtures are labeled DEMO DATA, NOT DEPLOYED, NOT VERIFIED ON-CHAIN.
- Residual: a fixture-VERIFIED charity can be selected (flagged); mainnet-beta is recorded as configuration only; per-account launch cap (`MAX_LAUNCHES_PER_USER`, default 50) and write rate limits bound abuse; the per-process limiter caveat still applies.

## Slice 12: token proof / transparency
- **One server-side rule**: `evaluateProof` derives status, every check and both verification flags. No request field can influence them; no write route exists under any proof path (tested for every method); the privileged writers are not imported by any route (tested).
- **No fake verification**: fixtures cannot pass `OBSERVATION_FROM_CHAIN`, so they can never be VERIFIED; the database refuses fixture observations on non-demo proofs; a tampered observation breaks the hash chain and the proof becomes UNAVAILABLE (tested by bypassing the trigger). Observations are validated by a strict schema (base58 addresses, u64 supply as a string, no extras) before storage.
- **Ownership and visibility**: owner proof filters by `creator_user_id` in SQL (foreign equals unknown, 404); the public proof serves only READY and published launches. The public form hides the tax reserve destination and recipient, abbreviates the creator and authority addresses, and carries no user id, session or secret (tested).
- **Untrusted metadata**: user-provided and on-chain text is rendered escaped; URLs validated; no image loaded; nothing fetched; no explorer URL generated.
- **Language**: required disclosures; never SAFE, GUARANTEED, TRUSTLESS, IMMUTABLE or AUDITED; VERIFIED TRANSPARENCY only when the server says so; unavailable values are labeled, not zero.
- Mutation checks (by hand, then reverted): fixture allowed to pass the chain check, unknown treated as pass, mismatch no longer failing, public form using the owner view, public form exposing the reserve destination, history integrity not checked. All caught. Removing `&& real` from the final VERIFIED flag is an equivalent mutant (the chain check already requires it).
- Residual: nothing populates real proofs yet; the observer, its trust and RPC failure handling are future work.

## Slice 13: deployment plan / signing boundary
- **No keys**: a global pre-validation hook refuses any request body or query containing key-material field names (private key, secret key, seed phrase, mnemonic, keypair), before any handler, without echoing values (tested across routes). The plan's `serverSigns`, `serverHoldsKeys`, `serverAcceptsKeyMaterial` are literal false, and a database constraint refuses a stored plan that says otherwise. A source scan asserts no route or plan repository can sign, serialize, simulate or send a transaction, or touch a keypair.
- **No execution surface**: read, review and an append-only record only. Probes confirm there is no sign, send, submit, deploy, execute, broadcast, confirm, mint, liquidity or payout route. The mint keypair is client-side; no unsigned bytes are stored.
- **READY gate and staleness**: server-side only; not-READY, stale, modified-after-review, foreign and unknown launches are refused (409/404/422). The request carries no parameters; the POST body must be empty.
- **Validation**: BigInt exactness, u64 bound, exact shares (precision loss refused), canonical fee split, 32-byte base58 addresses, verified charity, SPL Token only.
- **Honesty**: the configured fee split is never shown as on-chain; expected state is labeled not observed; no fake mint, signature, pool, program id or authority revocation; BLOCKED status is derived from named facts.
- Mutation checks (by hand, then reverted): READY gate, stale-review check, u64 bound, creator and liquidity precision checks, canonical split, address validation, Token-2022 refusal, charity verification, expected authority, plan hash, revoke instruction, the secret-material hook and the route error mapping. All caught.
- Residual: nothing exercises a real wallet or network; the signing flow itself is Slice 14.

## Slice 14: execution readiness and the hard gate
- **Execution is disabled by a server constant**, not a flag a client or file can flip: `REAL_EXECUTION_ENABLED = false`, the API refuses to start with the environment variable set to anything else, `executionPermitted` is the literal false in every response schema, and `assertExecutionDisabled` always throws. The attempt writer refuses any state implying a signature, send or confirmation; the database accepts only PLAN_BUILT, FAILED and CANCELLED and cannot store a signature.
- **No execution surface**: probes for execute, sign, send, submit, broadcast, confirm, approve and start return 404; a source scan asserts no route can sign, serialize or send or import the attempt writers.
- **No client input can change readiness**: flags (ready, approved, executionEnabled, status, mint key, signature, confirmation) are refused on POST bodies and ignored on GET queries; key-material names are refused everywhere before any handler.
- **Mint key**: only a public key is ever considered; a value shaped like a secret key is refused and never echoed or stored; the column accepts at most a 44-character base58 string.
- **Visibility**: readiness, decisions and attempts are owner-only and no-store; public launch, proof and listing responses contain no policy hash, decision, readiness or destination internals (tested).
- **Honesty**: the fee split is never called enforced; the three reviews are PENDING and a review needs an evidence reference and date; PASS never comes from a flag.
- Mutation checks (by hand, then reverted): pending decision treated as pass, execution gate passing, overall always EXECUTION_DISABLED, attempt states all recordable, secret-key shape check removed, allocation sum check removed, fee routing always enforceable, policy hash dropped from the plan hash, non-canonical split accepted (initially survived; a test was added), stale plan ignored, unverified charity accepted, mainnet review gate removed, config accepting REAL_EXECUTION_ENABLED=true. All caught.
- Residual: engineering defaults await product approval; nothing is verified against a real network.

## Product decisions (canonical record: docs/PRODUCT_DECISIONS.md)
- **No client can approve a decision.** Approval is a field of the policy in code (approver, date, reference, version), changed only by a reviewed code change; no route accepts or applies one (probed on every write method) and query flags are ignored. An approval applies to one version, so changing a decision invalidates it, and the policy hash (and so the plan hash) changes.
- **Pending stays blocking; approval is not implementation.** `PRODUCT_APPROVAL_COMPLETE` blocks while any decided item lacks approval; an approved fee routing or liquidity decision still blocks until its mechanism exists.
- **Decision records cannot carry chain facts**: a test scans every decision value for addresses (other than public program ids), URIs, signatures, pools, mints and observations. A document-sync test fails if docs/PRODUCT_DECISIONS.md disagrees with the code (status, approval, dependencies, blocked milestones).
- Mutation audit of the decision logic is recorded in docs/TESTING.md.

## Owner decision pass 1 (2026-10-07)
Approvals are recorded in code against the role "Product owner" (the form's name was a placeholder, no name is invented). They are product approvals only: nothing is implemented, audited or mainnet-ready. The chosen custom Solana program does not exist; the split is not enforced; the three reviews are required and pending; execution stays disabled. The deployment plan refuses any launch whose creator and liquidity shares do not match the decided 8% / 40% / 52% permanently unissued model. The 52% is never minted and is not burned; it is permanent only once the mint authority is revoked, so a plan that keeps the mint authority is refused. The tax reserve address in the launch configuration is a compatibility field only: it is not an approved destination and is not compared by Token Proof.
