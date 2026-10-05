# Architecture

## Principles
1. Non-custodial. The platform never holds user keys or funds. No withdrawal authority over user vaults.
2. Verify, don't trust. Every number on a public page links to chain evidence where possible.
3. Money is integers: USD cents (bigint), token base units (bigint), prices micro-USD, rates basis points. No floats.
4. Raw chain data is immutable; everything else is derived and rebuildable.
5. UI claims must match contract behavior (IMMUTABLE vs ADMIN_CONTROLLED is read from chain, not typed in by hand).

## Components
```
Browser (Next.js, Wallet Standard adapters)
   | HTTPS, session cookie
API (Node/TS)  --- Redis (rate limit, cache)
   | SQL
PostgreSQL <--- Workers: indexer, prices, portfolio, tax, reports, notifications
                   |
              Solana RPC / indexer / price providers (server-side keys only)
```
- **web**: renders; builds unsigned transactions; wallet signs client-side. Shows "WHAT YOU ARE SIGNING" before every signature.
- **api**: auth, reads, tx building and simulation, admin. Validates all input (zod). Holds no signing keys.
- **workers**: idempotent jobs. Indexer writes `raw_transactions` then derives `transactions`. Tax worker reruns the pure engine in `packages/shared`.
- **packages/shared**: pure functions only (fee split, tax engine, copy). Same code runs in API and tests; frontend may display but numbers shown are API-computed.

## Auth
Wallet-first. API issues a random nonce (128+ bit, 5 min expiry, single use) bound to address. Client signs a structured sign-in message (domain, nonce, issued/expiry, statement). API verifies the ed25519 signature, consumes nonce, creates session (random token, only sha256 stored, httpOnly Secure SameSite cookie). Signature is a login proof, never a password.

## Price service
`PriceProvider` interface: `getTokenPrice`, `getHistoricalPrice`, `getUSDValue`, `getLiquidity`, `getMarketData`. Observations stored in `price_observations` with provider and timestamp. Tax calcs reference the stored observation so results are reproducible.

## Chains
Solana first. `chain` enum in DB and a `ChainAdapter` boundary in the indexer keep EVM possible (V3).

## Launchpad and contracts
- Token: standard SPL Token / Token-2022 via audited libraries. No custom token logic.
- Fee split: needs on-chain routing to be verifiable. Options, to decide at architecture review: (a) established splitter program, audited; (b) minimal custom splitter. **No custom program touches funds until independently audited.** V1 on devnet only.
- Tax-reserve destination in V1 launch = a creator-controlled address, disclosed publicly. Not an automated vault.
- UI label rule: `IMMUTABLE` only if the program has no upgrade authority and no setter; otherwise `ADMIN_CONTROLLED`. The label is derived from on-chain upgrade authority / config, not stored by hand.

## Tax reserve (user)
USDC only in V1. User-controlled vault; deposits explicitly signed. No auto-conversion. Platform has zero withdrawal power. Contract choice (SPL token account owned by user vs program vault) deferred to architecture review; simplest non-custodial option is a user-owned dedicated token account, tracked and labeled.

## Decisions log
| # | Decision | Why |
|---|---|---|
| 1 | pnpm monorepo, TS strict | shared pure math package |
| 2 | bigint + bps everywhere | exactness, mirrors on-chain math |
| 3 | Dust in fee split goes to protocol | deterministic, documented, mirrorable on-chain |
| 4 | Simplified US netting (ST/LT cross-offset) | MVP estimate; real rules (wash-sale status for crypto, NIIT, brackets) are out of scope and labeled |
| 5 | Rates are inputs, not constants | spec forbids hardcoded tax % |

## API layer (Slice 1)
`apps/api` (Fastify 5). Routes grouped by domain under `/api`; contracts are Zod schemas in `packages/shared/src/api`, shared by API and web client. See `API.md`.
- **Provenance is part of the contract.** Every data response says `dataSource` (`demo` | `database` | `chain`) and `verifiedOnChain`. In this slice nothing is `chain`, and nothing may be presented as on-chain fact.
- **Demo-backed vs database-backed.** Wallets, charities, donations, tax-reserve target, launch configurations, sessions are PostgreSQL. Portfolio, transactions, tax, tokens, proof, discover are pure builders over `shared/src/demo` fixtures (same builders power the web client's mock mode, so shapes cannot drift). The seed uses the same fixtures.
- **Single implementation of the math.** Fee split (`validateFeeSplit`, `splitAmount`), tax (`estimateTax`, `reserveStatus`), launch review (`reviewLaunchConfig`), discover filters all live in `packages/shared`. The API calls them; it re-implements nothing.
- **Auth boundary.** `requireAuth` resolves a bearer session to a user id; repositories filter by that id. Session issuance via wallet signature is an unimplemented interface (`auth/walletAuth.ts`); the dev-only session endpoint exists solely under `AUTH_MODE=dev-insecure` and is refused in production.
- **No fund movement.** There is no route or function that builds a transaction, asks for a signature, or transfers value. Donations are records (`demo`), reserve is a target, launches are configurations.
- **Web client** (`apps/web/src/lib/api`): `NEXT_PUBLIC_API_MODE=mock|api`. UI components do not use it yet; switching screens over is later work.
- Bundling: `tsup` inlines `@project-name/shared` (shipped as TS source) into `dist/` for `node dist/server.js`.
