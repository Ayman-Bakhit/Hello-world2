# API (Slice 1)

Fastify 5 + Zod + PostgreSQL. Package: `apps/api`. Contracts (Zod schemas) live in `packages/shared/src/api/schemas.ts` and are used by the API for request validation, by the API for response validation, and by the web client for response validation.

Base URL (local): `http://localhost:4000`. All routes are under `/api`; `GET /health` is also served at the root.

## Read this first
- **Nothing here is on-chain data.** No indexer, RPC, or price provider exists yet. Every response that carries balances, transactions, tax, reserve balance, or token facts is `"dataSource": "demo"` and `"verifiedOnChain": false`. Treat both fields as part of the contract.
- **Non-custodial.** No endpoint moves funds, builds a transaction, requests a signature, or accepts a key/seed/secret. Wallet records contain public information only.
- **Authentication is NOT production-ready.** Sessions are real (hashed, expiring, revocable) but the only way to obtain one is a dev-only endpoint with no wallet signature. See [Authentication](#authentication).
- Money: integer USD cents as strings (`"1842000"` = $18,420.00). Token amounts: base units as strings. Rates: integer basis points. No floats.
- Tax language: fields are `estimated*`. There is no tax-bill field anywhere.

## Endpoint summary
Capability: **demo** = fixture-backed (not real data). **db** = stored in PostgreSQL. **prod-capable** = logic is real and would not change when real data arrives.

| Method & route | Auth | Data source | Status |
|---|---|---|---|
| `GET /health`, `GET /api/health` | public | none | production-capable (liveness) |
| `GET /api/auth/status` | public | none | production-capable |
| `POST /api/auth/nonce`, `POST /api/auth/verify` | public | none | **501 not implemented** |
| `POST /api/auth/dev-session` | public, only when `AUTH_MODE=dev-insecure` | db (sessions) | **dev only**, absent otherwise |
| `GET /api/wallets` | session | db (`demo` rows) | db-backed; demo seed data |
| `GET /api/wallets/:id` | session + owner | db | db-backed |
| `GET /api/portfolio/:walletId` | session + owner | demo | **demo** |
| `GET /api/transactions/:walletId` | session + owner | demo | **demo** |
| `GET /api/tax/:walletId` | session + owner | demo (shared tax engine) | **demo** (engine is real) |
| `GET /api/tax-reserve/:walletId` | session + owner | target: db; balance/exposure: demo | mixed |
| `POST /api/tax-reserve/:walletId/target` | session + owner | db | production-capable (config only, moves no funds) |
| `GET /api/charities`, `GET /api/charities/:id` | public | db (`demo` rows) | db-backed |
| `GET /api/donations/:walletId` | session + owner | db | db-backed |
| `POST /api/donations` | session + owner | db | creates `demo` record only; no transfer |
| `POST /api/launches` | session | db | production-capable (config only) |
| `GET /api/launches`, `GET /api/launches/:id` | session + owner | db | production-capable |
| `POST /api/launches/:id/review` | session + owner | db | production-capable (validation only; never deployable) |
| `GET /api/tokens` | public | demo | **demo** |
| `GET /api/tokens/:id/proof`, `GET /api/proof/:id` | public | demo | **demo** |
| `GET /api/discover` | public | demo | **demo** (filter/sort logic is real) |

Common error body (all errors):
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "fields": { "feeSplit": ["fee split totals 10001 basis points; it must be exactly 10000"] } } }
```
Codes: `VALIDATION_ERROR` 400, `BAD_REQUEST` 400/413, `UNAUTHENTICATED` 401 (with `WWW-Authenticate: Bearer`), `NOT_FOUND` 404, `LIMIT_REACHED` 409, `DEMO_DATA_MISSING` 409, `CHARITY_NOT_VERIFIED` 422, `WALLET_NOT_OWNED` 422, `RATE_LIMITED` 429, `NOT_IMPLEMENTED` 501, `INTERNAL_ERROR` 500 (no internals leaked).
A resource owned by another user is reported as `404`, not `403`, so existence is not revealed.

## Authentication
- Header: `Authorization: Bearer <token>`. Tokens are 256-bit random values; only a SHA-256 hash is stored (`sessions.id_hash`). Sessions expire and can be revoked.
- **Wallet sign-in (nonce, signature, replay protection) is not implemented.** `POST /api/auth/nonce` and `/verify` return 501. The required design and checklist is in `apps/api/src/auth/walletAuth.ts` and `docs/SECURITY.md`.
- `AUTH_MODE=disabled` (default): there is no way to get a session; every protected route returns 401.
- `AUTH_MODE=dev-insecure`: registers `POST /api/auth/dev-session`, which issues a session for the seeded **demo user** with no proof of wallet control. It cannot target any other user. Startup is refused if `NODE_ENV=production`.

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

### Portfolio (demo)
`GET /api/portfolio/:walletId` → `{ walletId, totalValueCents, costBasisCents, realizedPnlCents, unrealizedPnlCents, assets:[{ symbol, name, decimals, balance, priceMicroUsd, valueCents, costBasisCents, unrealizedPnlCents, realizedPnlCents, allocationBps, isFictionalToken }], dataSource:"demo", verifiedOnChain:false }`
A non-demo wallet returns `404` (no fabricated balances).

### Transactions (demo)
`GET /api/transactions/:walletId?limit=25&offset=0` (limit 1-100) → `{ walletId, transactions:[{ id, signature, timestamp, type, asset, decimals, amount, usdValueCents, taxTreatment, source:"demo", explorerUrl:null }], pagination:{ limit, offset, total, nextOffset }, dataSource, verifiedOnChain }`
`signature` is a `DEMO-SIG-*` placeholder. Records with `source:"chain"` will exist only after the indexer.

### Tax (demo)
`GET /api/tax/:walletId` → `{ scope:"user", taxYear, costBasisMethod, estimatedRealizedGainsCents, estimatedRealizedLossesCents, estimatedShortTermNetCents, estimatedLongTermNetCents, estimatedTaxableEvents, estimatedTaxExposureCents, assumptions, methodology:{ name, version, limitations[] }, disclaimer[], dataSource:"demo", verifiedOnChain:false }`
Computed by the shared tax engine from synthetic events. Disclaimer: "Estimated tax exposure is a tax planning estimate, not a tax bill or tax advice."

### Tax reserve
`GET /api/tax-reserve/:walletId` → `{ scope:"user", currency:"USDC", currentReserveCents, reserveDataSource:"demo", estimatedTaxExposureCents, coverageBps, recommendedAdditionalReserveCents, target:{ targetType, targetPercentage, targetAmount, currency, updatedAt }|null, resolvedTargetCents, targetDataSource, custody:"none", disclaimer[], dataSource, verifiedOnChain }`
`POST /api/tax-reserve/:walletId/target` body, one of:
```json
{ "targetType": "percentage", "targetPercentage": "30", "currency": "USDC" }
{ "targetType": "amount", "targetAmount": "10000.00", "currency": "USDC" }
```
Percent: above 0, at most 100, at most 2 decimals. Amount: at most 2 decimals, above 0. Unknown fields rejected. Writes one row in `tax_reserves`; **moves no money** (tests assert no other table changes). Returns the same body as GET.

### Charities (db, demo rows)
`GET /api/charities?verified=true|false` → `{ charities:[{ id, name, description, website, country, category, verificationStatus, legalEntityIdentifier, wallets:[{ id, chain, address, verificationStatus, supportedAssets }], dataSource, createdAt }] }`
`GET /api/charities/:id`. Seed charities are fictional, `dataSource:"demo"`. Real onboarding needs admin verification (not built).

### Donations (db)
`GET /api/donations/:walletId` → `{ walletId, donations:[{ id, walletId, charityId, asset, amountUsdCents, status, transactionSignature, receiptReference, destinationAddress, createdAt, dataSource, taxNote }], confirmedTotalCents, demoTotalCents, taxNote, dataSource, verifiedOnChain }`
`POST /api/donations` body `{ "walletId": uuid, "charityId": uuid, "asset": "USDC", "amount": "25.50" }` → `201 { donation, notice }`
- Creates a row with `status:"demo"`. No transaction is created, signed, or sent. The client cannot choose a status (unknown fields rejected).
- `confirmed` requires a recorded transaction; the database enforces this (`donations_confirmed_requires_tx`). Nothing in the API can produce `confirmed` yet.
- Charity and its wallet must be verified and support the asset, else `422 CHARITY_NOT_VERIFIED`.
- Tax note: "Potentially deductible charitable contribution. Consult a tax professional. Tax treatment depends on your circumstances and applicable law."

### Launches (db)
`POST /api/launches` body:
```json
{
  "name": "Example Token", "symbol": "EXMPL", "description": "", "totalSupply": "1000000000", "decimals": 6,
  "creatorAllocationPercent": "8", "creatorWallet": "<one of your wallet addresses>",
  "mintAuthority": "disabled", "freezeAuthority": "disabled", "updateAuthority": "creator",
  "liquidityConfiguration": { "initialLiquidityUsdc": "50000", "supplyPercentage": "40", "lockDays": 30 },
  "feeSplit": { "creator": 6000, "taxReserve": 1500, "charity": 1500, "protocol": 1000 },
  "charityConfiguration": { "charityId": "<uuid>" },
  "taxReserveConfiguration": { "destinationType": "creator_controlled", "destinationAddress": "<your wallet address>" }
}
```
→ `201 Launch { id, status:"draft", config, review:null, deployment:{status:"not_deployed",contractAddress:null}, createdAt, updatedAt, dataSource:"database" }`
- `feeSplit`: integer basis points, validated by the shared `validateFeeSplit` (exactly 10000). Floats, negatives, strings, extra or missing keys are rejected. The DB also has a CHECK (`launch_fee_split_is_10000_bps`).
- `creatorWallet` must be one of your registered wallets (`422 WALLET_NOT_OWNED`). Max 50 configurations per account.
- `GET /api/launches?limit&offset`, `GET /api/launches/:id`: your own only.
- `POST /api/launches/:id/review`: re-validates server-side (fee split, wallet ownership, charity verified with a verified wallet, supply not oversubscribed), stores the result, sets `review_passed` or `review_failed`. Response includes `review.errors[]`, `warnings[]`, a $1,000 money-flow example, `feeSplitLabel:"Configured fee split"`, `feeSplitEnforcement:"not_enforced"`, `deployable:false`. Nothing is deployed and the word "immutable" is never used.

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
Zod validation on every body/query/param; strict objects (unknown keys rejected); 64 KB body limit; helmet headers; CORS allowlist (exact origins, no wildcard, GET/POST only, no credentials); global rate limit plus stricter write limit (in-memory); structured errors with no stack traces; log redaction for `Authorization`/`Cookie`; response validation against the contract; parameterized SQL only; localhost bind by default.
See `docs/THREAT_MODEL.md` for gaps.
