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

## Auth (implemented in Slice 2; details in SECURITY.md)
Wallet-first. API issues a 192-bit single-use nonce bound to the address (5 min expiry) together with the exact message text (SIWS-style, versioned). The wallet signs that text (never a transaction). The API consumes the nonce atomically, requires the stored text, verifies the ed25519 signature with `@solana/keys`, finds-or-creates the user and wallet under a per-address lock, marks the wallet verified, and creates a session (256-bit random token, only its SHA-256 stored) delivered as an HttpOnly cookie. Logout revokes server-side. A signature is a login proof, never a password.
- Modules: `apps/api/src/auth/{solana,signin,session,plugin}.ts`; message format in `packages/shared/src/auth/message.ts`.
- Two separate states everywhere: CONNECTED (extension exposes an address) vs AUTHENTICATED (server verified a signature).
- Dev-only bearer session (`AUTH_MODE=dev-insecure`) is separate, flagged `dev_insecure`, and rejected in production.

## Price service
Implemented minimally in Slice 5 (`apps/api/src/prices/provider.ts`): `PriceProvider.getPrices(assets)` returns quotes only for assets it can price; `NullPriceProvider` (default) and `CoinGeckoPriceProvider` (SOL/USD, mainnet only). Observations are stored in `price_observations` with provider and timestamp; a missing price is absence, never zero. Historical prices, liquidity and market data are not built. Tax calcs will reference the stored observation so results are reproducible.

## Solana indexing (Slice 5)
Read-only chain access behind a replaceable `SolanaRpc` interface, a bounded idempotent sync into immutable raw records and derived tables, conservative classification, and live Portfolio/Transactions. See INDEXING.md.

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
- **Provenance is part of the contract.** Every data response says `dataSource` (`demo` | `database` | `chain`) and `verifiedOnChain`. Since Slice 5, portfolio and transactions for real wallets are `chain` (read from an RPC node by the indexer) with `verifiedOnChain: false`: observed, not independently verified.
- **Demo-backed vs database-backed.** Wallets, charities, donations, tax-reserve target, launch configurations, sessions are PostgreSQL. Portfolio, transactions, tax, tokens, proof, discover are pure builders over `shared/src/demo` fixtures (same builders power the web client's mock mode, so shapes cannot drift). The seed uses the same fixtures.
- **Single implementation of the math.** Fee split (`validateFeeSplit`, `splitAmount`), tax (`estimateTax`, `reserveStatus`), launch review (`reviewLaunchConfig`), discover filters all live in `packages/shared`. The API calls them; it re-implements nothing.
- **Auth boundary.** `requireAuth` resolves a session (cookie or bearer) to a user id; repositories filter by that id. Sessions are issued by wallet-signature verification (Slice 2); the dev-only session endpoint exists solely under `AUTH_MODE=dev-insecure` and is refused in production. Cookie requests are Origin-checked (CSRF).
- **No fund movement.** There is no route or function that builds a transaction, asks for a signature, or transfers value. Donations are records (`demo`), reserve is a target, launches are configurations.
- **Web client** (`apps/web/src/lib/api`): `NEXT_PUBLIC_API_MODE=mock|api`. UI components do not use it yet; switching screens over is later work.
- Bundling: `tsup` inlines `@project-name/shared` (shipped as TS source) into `dist/` for `node dist/server.js`.

## Frontend wallet layer (Slice 2)
`apps/web/src/state/wallet.tsx` has two modes via `NEXT_PUBLIC_API_MODE`. `api`: Wallet Standard discovery (`@wallet-standard/app`), connect, challenge from the API, `solana:signMessage`, verify, cookie session; status `disconnected -> connected -> signing -> authenticated`. `mock` (default): the Slice 3 demo connection, which never reports authenticated. The browser holds no session secret.

## Frontend <-> API relationship (Slice 4)
```
Browser (Next.js, static shells)
  screens -> useResource -> typed client (lib/api/client.ts) -> fetch(credentials: include) -> Fastify API -> PostgreSQL / demo builders
                              \-> mock mode: same functions answered locally from packages/shared fixtures (+ in-memory saves)
  session: HttpOnly cookie only. GET /api/auth/session on load; 401 anywhere -> session re-check.
```
- **One contract.** Request/response shapes are the Zod schemas in `packages/shared/src/api`; the client validates every response, so UI and server cannot silently drift. In api mode the client parses every response with those schemas; mock mode is built by the same shared builders the API uses, and tests parse its output with the same schemas.
- **The server decides what is demo and what is live.** The UI renders labels from `dataSource` / `verifiedOnChain` and the `NO_LIVE_DATA` error code; it never decides that a number is "real". Demo fixtures are only reachable through demo wallets, so a real signed-in wallet gets empty states.
- **Screens = container + pure view.** `components/screens/*Screen.tsx` load data (`useResource`, `ResourceView`); exported `*View` components are pure and unit-tested by static rendering.
- **Money is strings on the wire, bigint in the UI** (`lib/adapters.ts`). Formatting stays in `lib/format.ts`.
- **What the UI deliberately does not do:** sign or send transactions, move funds, create donation records, deploy anything, rank or filter tokens itself.
- **Slice 5 update:** the Portfolio screen now has SYNC WALLET / REFRESH DATA (`lib/useWalletSync.ts`, `components/SyncPanel.tsx`), shows LIVE DATA for indexed wallets, and distinguishes on-chain balance, price and USD value. Tax, reserve and donations are still `NO_LIVE_DATA` for real wallets.
- **Remaining blockchain integration** (future slices): price history and more price sources; cost-basis lots from indexed transactions -> real tax estimates; verified charity wallets and real donation transactions; reserve vault flows; token deployment and on-chain fee routing; on-chain proof (`verifiedOnChain`) and explorer links. Each replaces a demo-backed builder behind the same endpoints and the same schemas.
