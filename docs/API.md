# API (Slice 1)

Fastify 5 + Zod + PostgreSQL. Package: `apps/api`. Contracts (Zod schemas) live in `packages/shared/src/api/schemas.ts` and are used by the API for request validation, by the API for response validation, and by the web client for response validation.

Base URL (local): `http://localhost:4000`. All routes are under `/api`; `GET /health` is also served at the root.

## Read this first
- **Nothing here is on-chain data.** No indexer, RPC, or price provider exists yet. Every response that carries balances, transactions, tax, reserve balance, or token facts is `"dataSource": "demo"` and `"verifiedOnChain": false`. Treat both fields as part of the contract.
- **Non-custodial.** No endpoint moves funds, builds a transaction, requests a signature, or accepts a key/seed/secret. Wallet records contain public information only.
- **Authentication is real, the API is still demo-grade.** Sessions come from Solana wallet-signature sign-in (Slice 2). Everything else in this list that is demo-backed is still demo. See [Authentication](#authentication) and `docs/SECURITY.md`.
- Money: integer USD cents as strings (`"1842000"` = $18,420.00). Token amounts: base units as strings. Rates: integer basis points. No floats.
- Tax language: fields are `estimated*`. There is no tax-bill field anywhere.

## How the web app uses this API (Slice 4)
The wallet-scoped routes take `:walletId`; the web app always passes the signed-in session's wallet (from `GET /api/wallets`). Per-screen endpoint list: `docs/FRONTEND.md`.
- **`404 NO_LIVE_DATA`**: returned by portfolio, transactions, tax and tax-reserve (GET and POST target) when the wallet is yours but is not a demo wallet. It means "nothing is indexed for this wallet yet" and is how the UI knows to show an empty state. The API never substitutes demo data for a real wallet. A wallet that is foreign or unknown is a plain `404 NOT_FOUND`, which is deliberately distinguishable from "yours but empty".
- Data labels the UI relies on: `dataSource` (`demo`/`database`/`chain`) and `verifiedOnChain`. Nothing returns `chain` or `verifiedOnChain:true` yet.
- `GET /api/discover` also accepts `launchedWithinDays` (1-3650; demo tokens are measured against a fixed demo reference time).
- Donations are read-only for the UI: there is no create endpoint (Slice 9 removed the demo-only `POST /api/donations`, which attached demo records to a user's wallet). The UI uses the stateless `POST /api/donations/plan`. Launch configurations (`POST /api/launches`, review) ARE used: they are real saved records and deploy nothing.

## Endpoint summary
Capability: **demo** = fixture-backed (not real data). **db** = stored in PostgreSQL. **prod-capable** = logic is real and would not change when real data arrives.

| Method & route | Auth | Data source | Status |
|---|---|---|---|
| `GET /health`, `GET /api/health` | public | none | production-capable (liveness) |
| `GET /api/auth/status` | public | none | production-capable |
| `POST /api/auth/nonce` | public (Origin-checked) | db (`auth_nonces`) | production-capable |
| `POST /api/auth/verify` | public (Origin-checked) | db (users, wallets, sessions) | production-capable; sets HttpOnly cookie |
| `GET /api/auth/session` | public (reports "not authenticated") | db | production-capable |
| `POST /api/auth/logout` | cookie/bearer optional (Origin-checked) | db | production-capable |
| `POST /api/auth/dev-session` | public, only when `AUTH_MODE=dev-insecure` | db (sessions) | **dev only**; absent and rejected in production |
| `GET /api/wallets` | session | db (`demo` rows) | db-backed; demo seed data |
| `GET /api/wallets/:id` | session + owner | db | db-backed |
| `GET /api/wallets/:id/sync` | session + owner | db (`wallet_sync_*`) | indexing status for the wallet |
| `POST /api/wallets/:id/sync` | session + owner, rate limited, per-wallet cooldown | RPC read, db write | starts a bounded READ-ONLY sync (202); no signing, no sending |
| `GET /api/portfolio/:walletId` | session + owner | demo wallets: demo; real wallets: **chain** (indexed) or 404 `NO_LIVE_DATA` | live for real wallets after sync |
| `GET /api/transactions/:walletId` | session + owner | demo wallets: demo; real wallets: **chain** (indexed) or 404 `NO_LIVE_DATA` | live for real wallets after sync |
| `GET /api/tax/:walletId` | session + owner | demo wallets: demo fixture. Real wallets: derived on demand from indexed transactions + stored prices | status `COMPLETE|PARTIAL|DATA_REQUIRED|UNAVAILABLE`; estimate only |
| `GET /api/tax/:walletId/details` | session + owner | same | realized slices, every tax event with status/reason/missing data |
| `GET /api/tax-reserve/:walletId` | session + owner | target: db; estimate: tax engine (real) or fixture (demo); balance: UNAVAILABLE (real) or labeled fixture (demo) | derived on demand; `no-store` |
| `POST /api/tax-reserve/:walletId/target` | session + owner | db | production-capable (config only, moves no funds) |
| `POST /api/tax/:walletId/calculate`, `POST /api/tax-reserve/:walletId/calculate` | session + owner | derived | same results as the GET routes, with year/method/swap treatment/**tax rates in the body** |
| `GET /api/tax/:walletId/report` | session + owner | derived | estimated tax report (JSON) for a year/method/swap treatment |
| `POST /api/tax/:walletId/report/export` | session + owner, rate limited | derived | CSV or JSON file download |
| `GET/POST /api/wallets/:id/manual-basis` | session + owner | db (USER_PROVIDED) | list / create user-provided cost basis (real wallets only) |
| `GET /api/wallets/:id/manual-basis/:basisId` | session + owner | db | record + full audit history + `historyIntact` |
| `POST /api/wallets/:id/manual-basis/:basisId/revisions`, `.../void` | session + owner | db | auditable correction / soft removal. **No DELETE** |
| `GET /api/charities`, `GET /api/charities/:id`, `GET /api/charities/:id/evidence` | public (no donor data, no admin-only fields) | db (`demo` rows) | db-backed |
| `GET /api/donations/:walletId` | session + owner | db | db-backed |
| `GET /api/donations/by-id/:id`, `GET /api/receipts/:id` | session + owner (404 otherwise) | db | db-backed |
| `POST /api/donations/plan` | session + owner | none | stateless review; persists nothing; `transfersEnabled:false` |
| `POST /api/donations` | removed in Slice 9 | | 404: there is no donation creation endpoint |
| `POST /api/launches`, `PUT /api/launches/:id` | session + owner | db | configuration only; always returns the launch to DRAFT |
| `GET /api/launches`, `GET /api/launches/:id`, `GET /api/launches/:id/history` | session + owner | db | production-capable |
| `POST /api/launches/:id/configure`, `/review`, `/ready`, `/cancel` | session + owner | db | named lifecycle actions; the server decides the status |
| `GET /api/public/launches`, `GET /api/public/launches/:id` | public | db | READY and published configurations only |
| `GET /api/tokens` | public | demo | **demo** |
| `GET /api/tokens/:id/proof`, `GET /api/proof/:id` | public | demo | **demo** |
| `GET /api/discover` | public | demo | **demo** (filter/sort logic is real) |

Common error body (all errors):
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "fields": { "feeSplit": ["fee split totals 10001 basis points; it must be exactly 10000"] } } }
```
Codes: `NO_LIVE_DATA` 404 (see above), `SYNC_UNSUPPORTED` 409, `SYNC_COOLDOWN` 429, `INDEXING_UNAVAILABLE` 503, `INDEXER_BUSY` 503, `VALIDATION_ERROR` 400, `BAD_REQUEST` 400/413, `UNAUTHENTICATED` 401 (with `WWW-Authenticate: Bearer`), `AUTH_FAILED` 401 (any sign-in failure; deliberately uniform), `ORIGIN_NOT_ALLOWED` 403, `NOT_FOUND` 404, `LIMIT_REACHED` 409, `DEMO_DATA_MISSING` 409, `CHARITY_NOT_VERIFIED` 422, `WALLET_NOT_OWNED` 422, `RATE_LIMITED` 429, `TOO_MANY_CHALLENGES` 429, `INTERNAL_ERROR` 500 (no internals leaked).
A resource owned by another user is reported as `404`, not `403`, so existence is not revealed. Wallets created by real sign-in are `dataSource:"database"`. Until synced, their portfolio/transactions return 404 `NO_LIVE_DATA`; after a successful sync they return indexed chain data. Tax and reserve return 404 `NO_LIVE_DATA` for them (no fabricated data). Only the seeded demo user's wallets return demo fixtures.

## Authentication
Sign-in is Solana wallet-signature only (full design, message format and nonce lifecycle in `docs/SECURITY.md`).
- Browsers: an **HttpOnly cookie** (`pn_session`; `__Host-pn_session`, Secure, in production; `SameSite=Strict`). Send requests with `credentials: "include"`. State-changing requests must carry an allowlisted `Origin` (browsers do this automatically).
- API clients: `Authorization: Bearer <token>` is also accepted (tokens are the same 256-bit random values; only a SHA-256 is stored).
- A wallet **connection** is not authentication. `GET /api/auth/session` reports `authenticated:true` only after a verified signature.
- `AUTH_MODE=dev-insecure` additionally registers `POST /api/auth/dev-session` (demo user, no signature). Local development only; refused at startup in production and its sessions are rejected there.

### `GET /api/auth/status` (public)
`{ mode:"wallet"|"dev-insecure", walletSignIn:{ implemented:true, messageVersion:"1", nonceTtlSeconds, chainId, domain }, productionReady:false }`

### `POST /api/auth/nonce` (public)
Request `{ "address": "<base58 Solana address>", "chain": "solana" }`. The address must be a valid on-curve 32-byte key.
`200 { nonce, message, domain, chainId, issuedAt, expiresAt }` with `Cache-Control: no-store`. `message` is the exact text to sign. `400` invalid address/body, `403` bad Origin, `429 TOO_MANY_CHALLENGES` / `RATE_LIMITED`.

### `POST /api/auth/verify` (public)
Request `{ "address", "nonce", "message", "signature" }` where `signature` is the 64-byte ed25519 signature as **standard base64 with padding** (88 chars) over the UTF-8 bytes of `message`.
`200 { authenticated:true, user:{id}, wallet:{...ownershipVerified:true...}, session:{expiresAt, authMethod:"wallet_signature"} }` plus `Set-Cookie`. The body never contains the session token.
`400` malformed input (nonce not consumed). `401 AUTH_FAILED` for every cryptographic/state failure: unknown, expired, used, or wrong-address nonce; message not equal to the issued text; signature invalid. The nonce is consumed on any failure after it is claimed (wrong message, bad signature); an unknown, expired, or other-address nonce has nothing to consume. `403` bad Origin. Signing in while presenting an old session revokes the old one.

### `GET /api/auth/session` (public)
`{ authenticated:boolean, user:{id}|null, wallet:{...}|null, session:{expiresAt, authMethod}|null }`. Never an error for "not signed in". `Cache-Control: no-store`.

### `POST /api/auth/logout`
Revokes the presented session (if any), clears the cookie. `200 { loggedOut:true }`. Idempotent. Requires an allowlisted Origin when a cookie is presented.

### `POST /api/auth/dev-session` (dev only)
`201 { token, expiresAt, warning }` for the seeded demo user. Absent unless `AUTH_MODE=dev-insecure`; 404 in production.

## Authorization boundary
Every wallet-, donation-, launch-, and tax-reserve query filters by the session's user id in SQL (`apps/api/src/db/repos.ts`). Tests cover cross-user access for each protected resource.
Tax and reserve are **user-scoped**: `:walletId` identifies the owner, the figures cover all of the owner's wallets (`"scope": "user"`).

## Endpoints

### Health
`GET /health` → `200 {"status":"ok","service":"api","version":"0.1.0"}`. No DB call, no config.

### Wallets
`GET /api/wallets` → `{ wallets: [{ id, chain:"solana", address, label, ownershipVerified:false, dataSource, createdAt }] }`
`GET /api/wallets/:id` → one wallet. `400` bad uuid, `404` unknown or not yours.
No field can hold a key, seed, or secret. `ownershipVerified` is `false` until signature verification exists.

### Wallet sync (Slice 5, read-only)
`GET /api/wallets/:id/sync` -> `{ walletId, state: unsupported_demo_wallet | indexing_unavailable | never_synced | syncing | synced | failed, configured, cluster, priceProvider, limits, lastRun, lastSuccessAt, window, nextAllowedAt }`. `lastRun` has `status` (`running|succeeded|partial|failed`), `counts`, and a safe `error {code,message}`. `window` says how much history is indexed (`historyComplete`, `hasGap`, `indexedCount`).
`POST /api/wallets/:id/sync` (no body) -> `202 { run, alreadyRunning:false }`; `200 { alreadyRunning:true }` if one is in progress. Errors: `404` (not yours / unknown), `409 SYNC_UNSUPPORTED` (demo wallet), `429 SYNC_COOLDOWN` (with `Retry-After`) or `RATE_LIMITED`, `503 INDEXING_UNAVAILABLE` (no `SOLANA_RPC_URL`) or `INDEXER_BUSY`. Starting a sync only READS the chain. The RPC URL never appears in any response.

### Portfolio (demo wallets and indexed real wallets)
Real wallets (Slice 5): `GET /api/portfolio/:walletId` -> `{ walletId, totalValueCents|null, partialValueCents|null, costBasisCents:null, realizedPnlCents:null, unrealizedPnlCents:null, valuation:{status,pricedAssets,unpricedAssets}, source:{kind:"solana_rpc",cluster,slot,observedAt,lastSyncedAt}, assets:[{ kind:"native"|"spl", mint|null, symbol (SOL only), name, decimals, balance (raw), quantity (exact decimal), tokenAccounts, priceMicroUsd|null, valuation:"priced"|"stale_price"|"price_unavailable", price:{source,observedAt}|null, valueCents|null, allocationBps|null, metadata:{status,name,symbol,uri,source,verified:false}, observedSlot, observedAt }], dataSource:"chain", verifiedOnChain:false }`. `404 NO_LIVE_DATA` until a sync has succeeded. Zero-balance accounts are not listed. Tax, reserve and donation endpoints stay `NO_LIVE_DATA` for real wallets.
Demo wallets:
`GET /api/portfolio/:walletId` → `{ walletId, totalValueCents, costBasisCents, realizedPnlCents, unrealizedPnlCents, assets:[{ symbol, name, decimals, balance, priceMicroUsd, valueCents, costBasisCents, unrealizedPnlCents, realizedPnlCents, allocationBps, isFictionalToken }], dataSource:"demo", verifiedOnChain:false }`
A non-demo wallet returns `404` (no fabricated balances).

### Transactions (demo wallets and indexed real wallets)
Real wallets (Slice 5): same shape, newest first by slot, each record: real `signature`, `timestamp|null`, `type` (`transfer|token_receipt|token_send|swap|fee|unknown`), primary `asset`/`amount` (signed raw units) and the full `deltas[]`, `status` (`success|failed`), `feeLamports` (only when the wallet paid), `slot`, `classification {kind, reason, version}`, `programIds`, `usdValueCents:null`, `taxTreatment:"not_assessed"`, `explorerUrl`, `source:"chain"`. `window` reports the indexed range, `historyComplete`, `hasGap`. `404 NO_LIVE_DATA` until a sync has succeeded.
Demo wallets:
`GET /api/transactions/:walletId?limit=25&offset=0` (limit 1-100) → `{ walletId, transactions:[{ id, signature, timestamp, type, asset, decimals, amount, usdValueCents, taxTreatment, source:"demo", explorerUrl:null }], pagination:{ limit, offset, total, nextOffset }, dataSource, verifiedOnChain }`
`signature` is a `DEMO-SIG-*` placeholder. Records with `source:"chain"` will exist only after the indexer.

### Tax (Slice 6)
`GET /api/tax/:walletId?taxYear=&method=FIFO|LIFO|HIFO&swapTreatment=DISPOSAL_AND_ACQUISITION|NOT_ASSESSED&shortTermRateBps=&longTermRateBps=&stateRateBps=` (rates: all three or none; unknown params 400). Scope is the user's real wallets pooled. Response adds to the fields below: `status`, `figuresComplete` (true only for COMPLETE), `methodSource` (`requested|default|demo_fixture`), nullable figures (`null` = not computed, never 0), `assumptions` (null unless the caller supplied rates), `calculation { engineVersion, dataModelVersion, feePolicy: "RECORDED_NOT_APPLIED", swapTreatment, inputFingerprint, counts, coverage, priceSources, walletsIncluded }`, `requirements[] { kind, severity, message, count }`. Real wallets: `dataSource:"chain"`, `verifiedOnChain:false`; never synced = `status:"UNAVAILABLE"` with no figures (200, not demo). `GET /api/tax/:walletId/details` adds `realized[]` (per lot slice, `inTaxYear`) and `events[]` (kind, status, reason, missing, price and source, confidence, matchedWith, candidates; capped at 500, `truncated`). `GET /api/tax-reserve/:walletId` accepts the same query; for real wallets `currentReserveCents`, `coverageBps`, `recommendedAdditionalReserveCents` are `null` (the reserve balance is not read from any chain) and the exposure is an estimate with the underlying `status`. `POST .../target` stores a target only. No endpoint moves funds.

### Tax (demo wallets; same shape)
`GET /api/tax/:walletId` → `{ scope:"user", taxYear, costBasisMethod, estimatedRealizedGainsCents, estimatedRealizedLossesCents, estimatedShortTermNetCents, estimatedLongTermNetCents, estimatedTaxableEvents, estimatedTaxExposureCents, assumptions, methodology:{ name, version, limitations[] }, disclaimer[], dataSource:"demo", verifiedOnChain:false }`
Computed by the shared tax engine from synthetic events. Disclaimer: "Estimated tax exposure is a tax planning estimate, not a tax bill or tax advice."

### Tax reserve (Slice 10)
`GET /api/tax-reserve/:walletId?taxYear=&method=&swapTreatment=` and `POST /api/tax-reserve/:walletId/calculate` (rates in the BODY, never a URL; a GET with rate parameters is `400`) return the same shape:
```
{ walletId, scope:"user", currency:"USDC",
  taxEstimate:    { source:"TAX_ENGINE|DEMO_FIXTURE", status, label:"ESTIMATE", estimatedExposureCents|null, withheldReason, ratesSupplied, incomplete, missing:[{kind,severity,count,message}], authoritative:false, verifiedOnChain:false },
  recommendation: { source:"SYSTEM_RECOMMENDATION", policy:"EXPOSURE_1X", status:"ESTIMATE|ESTIMATE_INCOMPLETE|WITHHELD|UNAVAILABLE", label, recommendedCents|null, reason, authoritative:false },
  userTarget:     { set, source:"USER_SET|SYSTEM_RECOMMENDED|null", enabled, targetType, targetPercentage, targetAmountCents, resolvedCents, effectiveCents, resolutionNote, updatedAt, dataSource, label, isMoney:false },
  targetVsExposure: { available, bps, wording, reason },
  reserveBalance: { source:"UNAVAILABLE|DEMO_FIXTURE", status:"NOT_CONNECTED|DEMO", cents|null, label, note },
  coverage:       { available, bps, label, reason },     remaining: { available, cents, reason },
  funding:        { enabled:false, message:"Reserve funding is not enabled in this beta.", custody:"none", moneyMovement:"NOT_ENABLED" },
  disclaimer, dataSource, verifiedOnChain:false }
```
- Real wallets: `reserveBalance` is `UNAVAILABLE` / `NOT_CONNECTED` (not zero), so `coverage` and `remaining` are unavailable. Demo wallet: a labeled fixture balance, `dataSource:"demo"`.
- Status rules: exposure and recommendation exist only for COMPLETE or PARTIAL status with user-supplied rates; DATA_REQUIRED withholds both and lists what is missing; UNAVAILABLE shows nothing.
`POST /api/tax-reserve/:walletId/target` body, one of (strict, unknown fields rejected):
```json
{ "targetType": "amount", "targetAmount": "10000.00", "currency": "USDC", "enabled": true, "confirmed": true }
{ "targetType": "percentage", "targetPercentage": "30", "currency": "USDC", "enabled": true, "confirmed": true }
```
- `confirmed: true` is required (explicit confirmation); `source` cannot be supplied (always `USER_SET`). `enabled` defaults to true.
- Amount: digits only, at most 12 whole digits and 2 decimals, above 0 (no NaN, Infinity, exponent, sign, separators or unicode digits); USDC only. Percent: above 0, at most 100, at most 2 decimals.
- Writes `tax_reserves` plus one append-only `tax_reserve_target_events` row in one transaction; **moves no money**; nothing derived is stored. Returns the same body as GET (without rates, so the recommendation is unavailable until the caller recalculates with rates).
- All three routes require a session and wallet ownership (foreign and unknown wallet ids are the same 404), and respond `cache-control: no-store`.
- There is no deposit, withdraw, transfer, fund, escrow, sign or send route (tested by route listing and by probing).

### Charities (db, demo rows) - Slice 9
`GET /api/charities?verified=true|false` -> `{ charities:[Charity] }`, `GET /api/charities/:id` -> `Charity`:
`{ id, slug, name, description, website, logoUrl, country, category, verificationState, verificationSource, lastReviewedAt, evidenceCount, legalEntityIdentifier, wallets:[{ id, chain, address, verificationStatus, supportedAssets }], dataSource, createdAt, updatedAt }`.
- `verificationState`: `UNVERIFIED | PENDING_REVIEW | VERIFIED | SUSPENDED`. `verificationSource`: `REGISTRY_LOOKUP | OFFICIAL_DOCUMENT | ADMIN_REVIEW | FIXTURE | null`. Seed charities are fictional, `dataSource:"demo"`, verified only by `FIXTURE` evidence.
- `website` and `logoUrl` are re-validated on output (http(s) / https only, no credentials); anything else is returned as `null`. Names and descriptions have control and bidi characters removed. All of it is untrusted text.
- `GET /api/charities/:id/evidence` -> `{ charityId, verificationState, verificationSource, lastReviewedAt, evidence:[{ id, sourceType, sourceRef, sourceUrl, status, checkedAt, reviewedBy:"ADMIN|NOT_RECORDED", publicSummary, dataSource }], caveat, dataSource }`. No internal notes, no verifier identity.
- Public and read-only. Contains no donor, wallet or donation data (tested).

### Donations (db) - Slice 9
`GET /api/donations/:walletId` -> `{ walletId, donations:[Donation], confirmedTotalCents, demoTotalCents, taxNote, dataSource, verifiedOnChain }`
`Donation = { id, walletId, charityId, asset, quantity, assetDecimals, usdReferenceCents|null, usdReferenceSource|null, status, transactionSignature|null, donatedAt|null, receiptId|null, receiptStatus|null, destinationAddress, provenance, createdAt, dataSource, taxNote }`
- `status`: `draft | pending | confirmed | failed | cancelled | demo`. `quantity` is an integer string in base units (exact above 2^53). `usdReferenceCents` is a reference value, not the deductible amount.
- `confirmed` needs an indexed chain transaction of the donor wallet, `dataSource:"chain"`, `provenance:"CHAIN_INDEXED"` and `donatedAt` (database constraints and trigger). Nothing in the API can produce one in this slice; fixture rows are `status:"demo"`, `provenance:"DEMO_FIXTURE"`.
`GET /api/donations/by-id/:id` -> `{ donation, receipt|null }`. `GET /api/receipts/:id` -> `Receipt = { id, donationId, receiptReference, charityReceiptReference, issuedAt, documentUrl, receiptHash, verificationState, provenanceNote, labels, caveat, dataSource }`.
- Every read filters by the session's user id in SQL. A foreign, unknown or malformed id gets the same 404 (400 for a malformed uuid); no session is 401. `cache-control: no-store`.
- Fixture receipts have `labels: ["DEMO RECEIPT","FIXTURE DATA","NOT A TAX RECEIPT"]` and are never VERIFIED. The caveat says a receipt does not prove that a contribution is deductible.
`POST /api/donations/plan` body `{ "walletId": uuid, "charityId": uuid, "asset": "USDC", "amount": "25.50" }` (strict) -> `200 DonationPlanResponse`
- Stateless review: persists nothing, creates no transaction, asks for no signature. Always `transfersEnabled:false`, `persisted:false`, `disabledReason:"Donation transfers are not enabled in this beta."`. Includes charity eligibility (VERIFIED and a verified wallet that supports the asset) with the blocked reason, exact `quantity`, `usdReferenceCents` (assumes 1 USDC = 1 USD, labeled "not a market quote"), a fee disclosure and signing note, and the qualified tax note.
- `POST /api/donations` (create) no longer exists. Tax note: "Potentially deductible charitable contribution. Consult a tax professional. Tax treatment depends on your circumstances and applicable law."
### Launches (db) - Slice 11 (configuration only)
`POST /api/launches` and `PUT /api/launches/:id` take the SAME strict body (unknown fields, including `status`, `userId`, `fingerprint`, `deployment`, `mintAddress`, are `400`):
```json
{ "name": "Example Token", "symbol": "EXMPL", "description": "...", "totalSupply": "1000000000", "decimals": 6, "network": "devnet",
  "imageUri": "https://...", "website": "https://...", "socials": { "twitter": null, "telegram": null, "discord": null, "github": null },
  "creatorAllocationPercent": "8", "creatorWallet": "<your wallet address>", "mintAuthority": "disabled", "freezeAuthority": "disabled", "updateAuthority": "creator",
  "liquidityConfiguration": { "initialLiquidityUsdc": "50000", "supplyPercentage": "40", "lockDays": 30 },
  "feeSplit": { "creator": 6000, "taxReserve": 1500, "charity": 1500, "protocol": 1000 },
  "charityConfiguration": { "charityId": "<registry uuid>" },
  "taxReserveConfiguration": { "destinationType": "creator_controlled", "destinationAddress": "<your wallet address>" } }
```
- `feeSplit` must equal 6000/1500/1500/1000 exactly (a split that totals 10000 but differs is `400`). `totalSupply` is a positive integer string that, scaled by decimals, fits a u64. Text is plain (no control characters or angle brackets); URLs are https (website: http or https), never fetched. Wallets must be yours (`422 WALLET_NOT_OWNED`); the charity must be a registry id (`422 CHARITY_NOT_FOUND`); `409 LIMIT_REACHED` beyond `MAX_LAUNCHES_PER_USER`.
- Response `Launch`: `{ id, status: DRAFT|CONFIGURED|REVIEW|READY|CANCELLED, statusMeaning, config, review|null, fingerprint, revision, publicVisible, readyAt, deployment:{status:"not_deployed",mintAddress:null,transactionSignature:null,contractAddress:null}, metadata:{source:"USER_PROVIDED",verifiedOnChain:false}, createdAt, updatedAt, dataSource }`. `fingerprint` is derived from the stored configuration (sha256, canonical). `review` carries `passed, errors, warnings, moneyFlowExampleCents (an illustration), fingerprint, charity:{ name, verificationState, verificationSource, lastReviewedAt, dataSource }, allocations`.
- `POST /api/launches/:id/configure` (DRAFT -> CONFIGURED when validation passes; otherwise stays DRAFT with the errors), `/review` (CONFIGURED -> REVIEW), `/ready` body `{ "fingerprint": "<current>", "confirmed": true, "publish": false }` (REVIEW -> READY; `409 FINGERPRINT_MISMATCH` otherwise), `/cancel` body `{ "reason"?: string }`. An action not available from the current status is `409 INVALID_LAUNCH_TRANSITION`; a configuration that changed meanwhile is `409 LAUNCH_CHANGED`. All are `no-store`, write-rate-limited and owner-scoped (foreign and unknown ids are the same 404).
- `GET /api/launches/:id/history` -> `{ launchId, revisions:[{ seq, action, statusAfter, fingerprint, reason, createdAt, prevHash, rowHash }], historyIntact, note }` (owner only).
- `GET /api/public/launches?limit&offset` and `GET /api/public/launches/:id` -> `PublicLaunch`: `{ id, status, statusMeaning, name, symbol, description, network, creator (abbreviated), totalSupply, decimals, feeSplit, allocations, feeSplitLabel, feeSplitEnforcement:"not_enforced", charity (current registry state), fingerprint, metadata, deployment, labels:["CONFIGURED","NOT DEPLOYED","NOT VERIFIED ON-CHAIN"], readyAt, dataSource }`. No session needed; no user, full wallet address, reserve destination or review internals.
- There is no deploy, mint, liquidity, distribution, payout, donation or transfer endpoint, and no DELETE.

### Tokens, proof (demo, public)
`GET /api/tokens` → summaries. `GET /api/tokens/:id/proof` and `GET /api/proof/:id` →
`{ tokenId, name, symbol, contractAddress:null, creatorWallet, liquidity, feeSplit:{ creator, taxReserve, charity, protocol, label:"Configured fee split", enforcement:"not_enforced", mutability:"UNDETERMINED" }, charity, taxReserve, protocol, moneyFlowCents, mintAuthority, freezeAuthority, adminStatus, transparencyChecksReported, evidence:[], notice, dataSource:"demo", verifiedOnChain:false }`
`evidence` is empty on purpose: no explorer links exist for fictional tokens.

### Discover (demo, public)
`GET /api/discover?sort=volume&minMarketCap=&maxMarketCap=&minLiquidity=&minVolume=&minHolders=&verifiedTransparency=true&limit=25&offset=0`
- `sort`: `volume` (default), `liquidity`, `holders`, `marketCap`, `newest`, `trending`, `charity`, `lowestCreatorConcentration`. The response includes `ranking.rule` stating exactly how it ranks.
- `min*/max*` are whole US dollars; `minHolders` an integer. Unknown parameters are rejected.
- `verifiedTransparency=true` means all 9 disclosure checks are **reported** (demo). It is a disclosure filter, not a safety rating, and no real badge is awarded.
- No boosts, paid placement, or synthetic metrics exist in the code path. `trending` is unfiltered (no wash-trade detection yet) and says so.

## Security controls (what exists)
Zod validation on every body/query/param; strict objects (unknown keys rejected); 64 KB body limit; helmet headers; CORS allowlist (exact origins, no wildcard, GET/POST only, credentials only for those origins); Origin check on state-changing requests (CSRF); HttpOnly session cookie; global rate limit plus stricter write limit (in-memory); structured errors with no stack traces; log redaction for `Authorization`/`Cookie`; response validation against the contract; parameterized SQL only; localhost bind by default.
See `docs/THREAT_MODEL.md` for gaps.

### Manual cost basis (Slice 7)
All routes: session, wallet ownership checked in SQL (`user_id` AND `wallet_id`), strict Zod bodies (unknown fields 400), write rate limit, Origin/CSRF guard. Demo wallets: `409 MANUAL_BASIS_UNSUPPORTED`. A record id never grants access on its own; another user's, another wallet's or an unknown record is `404`.
- `POST /api/wallets/:id/manual-basis` body `{ asset: "native"|<mint>, decimals?, quantity: "1.5", acquiredAt: "2023-05-17T14:30:00Z", costBasis: "1234.56", currency: "USD", reason: EXCHANGE_PURCHASE|PRIOR_WALLET|GIFT_RECEIVED|INCOME_OR_REWARD|OTHER, signature?, notes? }`. `quantity` is whole tokens as an exact decimal; **more decimals than the asset has is an error, never rounded**; `decimals` is required only for a mint the system has not seen (a contradicting value is refused). Cost basis: at most 2 decimals. `201` returns the record (`source: "USER_PROVIDED"`, `verifiedOnChain: false`, `quantity`, `quantityRaw`, `costBasis`, `costBasisCents`, `revision`, `status`, `review`). Limit 500 records per account (`409 LIMIT_REACHED`).
- `GET /api/wallets/:id/manual-basis?includeVoided=true|false` -> `{ records[], source }`; `review` is the latest tax calculation's state for each record.
- `GET .../:basisId` -> `{ record, history[], historyIntact }`.
- `POST .../:basisId/revisions` body = the editable fields + `changeReason` (3-300 chars, required) + `expectedRevision` + `acknowledgeOverlap`. Asset and wallet are fixed (void and re-add to change them). `409 STALE_REVISION` if the record moved on; `409 BASIS_VOIDED` after a void.
- `POST .../:basisId/void` body `{ changeReason, expectedRevision }` -> a `void` revision; the record stays visible with `includeVoided=true` and stops counting.
- Review states in `review.state`: `OK`, `POTENTIAL_DUPLICATE`, `OVERLAPPING_BASIS`, `DECIMALS_MISMATCH`, with `included`, `acknowledged`, `linkedEventId`, `conflicts[]`, `explanation`.
- Tax: `GET /api/tax/:walletId[/details]` accept only `taxYear`, `method`, `swapTreatment` (rates in a URL are `400`). `POST /api/tax/:walletId/calculate` takes `{ taxYear?, method?, swapTreatment?, rates? }` and returns `{ tax, details }` from one calculation; `POST /api/tax-reserve/:walletId/calculate` likewise. Details add `manualBasisReview[]`; events carry `origin` (`CHAIN|USER_PROVIDED`) and `manualBasisId`; realized slices carry `acquisitionOrigin`; counts include `MANUAL_BASIS`; requirement kind `BASIS_REVIEW`.

### Tax report and export (Slice 8)
- `GET /api/tax/:walletId/report?taxYear=&method=FIFO|LIFO|HIFO&swapTreatment=DISPOSAL_AND_ACQUISITION|NOT_ASSESSED` -> `TaxReportResponse` (see TAX_ENGINE.md for fields). Unknown query fields, tax rates and out-of-range years are `400`. Demo wallets get a labeled demo report (aggregate figures only). Never-synced real wallets: `status: "UNAVAILABLE"`, `summary: null`.
- `POST /api/tax/:walletId/report/export` body `{ format: "csv"|"json", taxYear?, method?, swapTreatment? }` (strict; unknown fields `400`; body limit 64 KB, larger is `413`). Returns the file with `Content-Disposition: attachment; filename="estimated-tax-report-<year>-<method>-<hex12>.<ext>"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`; CORS exposes only `Content-Disposition` so the browser can read the filename. `413 EXPORT_TOO_LARGE` if the report lists more than `REPORT_MAX_ROWS` disposals (never truncated). Parameters travel in the body (not a URL).
- Errors: `401`, `404` (not your wallet; identical for unknown), `400`, `429 TAX_IN_PROGRESS` (too many of your calculations already running), `503 TAX_BUSY` (process-wide limit), `500` generic (no stack, path or message).
