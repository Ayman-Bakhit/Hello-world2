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

### Tax reserve foundation (Slice 10): planning only, no money movement
```
tax calculation (existing engine, user-supplied rates in a POST body)
  -> tax estimate        COMPLETE | PARTIAL | DATA_REQUIRED | UNAVAILABLE, never authoritative
  -> recommendation      a policy over the estimate (today the identity, EXPOSURE_1X); an estimate
  -> user target         USER_SET configuration (a number the user chose), persisted
  -> reserve balance     UNAVAILABLE (NOT_CONNECTED) for real wallets; a labeled DEMO_FIXTURE for the demo wallet only
  -> coverage, remaining balance / target; unavailable whenever either side is
  -> future funding intent (not built)
```
- `packages/shared/src/reserve.ts` (`buildReserveState`) is a pure layer over the SAME tax result: no second tax engine and no rate of its own. API and mock mode share it.
- The recommendation never upgrades certainty: exposure is shown only for COMPLETE or PARTIAL status and user-supplied rates; DATA_REQUIRED withholds the recommendation and lists what is missing; UNAVAILABLE and "no rates" show no number.
- A fixture balance is refused by the builder unless the tax estimate itself is a demo fixture, so a real wallet cannot show one.
- Only the target configuration (and an append-only history of changes) is stored. The recommendation, coverage and remaining amount are computed on demand and never persisted.
- Interfaces for the future (NOT implemented): reserve account, explicit user signature, transaction, confirmation, reserve ledger, reconciliation. The future balance must come from independently verifiable transaction or ledger data. The target is never the balance and the recommendation is never a funded amount. `tax_reserve_transactions` (the future ledger) is write-locked by a trigger until a reviewed design exists.
- Decisions deliberately NOT made (documented in docs/TAX_ENGINE.md): reserve custody, reserve wallet architecture, transfer mechanism, who owns the reserve, jurisdiction policies, legal treatment of reserves.

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

## Tax data foundation (Slice 6)
```
transactions + transaction_asset_deltas (Slice 5, derived from immutable raw_transactions)   price_observations
        \                                                                                      /
         loadTaxInputs (all of ONE user's non-demo wallets + sync coverage)      HistoricalPriceProvider -> PriceAt
                              \                                                  /
                               computeTax (packages/shared/src/taxdata, pure)
                      events -> transfer matching -> pricing -> lots/disposals -> engine realize() -> estimate
                               -> requirements -> status (COMPLETE|PARTIAL|DATA_REQUIRED|UNAVAILABLE)
                                              |
         GET /api/tax/:walletId, /details, /api/tax-reserve/:walletId  (session + ownership; demo wallets -> labeled fixtures)
                                              |
                        Tax Center / Tax Reserve screens (status, method, requirements, unresolved, missing data)
```
Scope is the user (all their real wallets pooled per asset), matching the existing engine. Demo and real never mix: demo wallets get fixtures labeled DEMO DATA, real wallets get only derived data or `UNAVAILABLE`. Fixture-backed: the calculation logic and all test data. Dependent on future live verification: the indexed transactions, a real historical price source, and (later) user-supplied cost basis. No money movement exists: the reserve view exposes an estimate and a stored target only.

## Launch configuration foundation (Slice 11): configuration only
```
creator (session) -> launch configuration (DRAFT)
  -> server validation (shared schema + registry + wallet ownership) -> CONFIGURED
  -> submit for review (fingerprint + charity registry state recorded) -> REVIEW
  -> explicit confirmation of that exact fingerprint -> READY (ready for a FUTURE deployment flow)
  -> optional public read-only view
```
- One transition function (`planLaunchAction`) is shared by the API (which persists it under a row lock) and mock mode (in memory), so both behave identically. A client never supplies a status.
- The fee split is a fixed, server-validated configuration (60/15/15/10); the launch tax reserve allocation is separate from the user's personal Tax Reserve (Slice 10); the selected charity comes from the Slice 9 registry; nothing here moves money or touches a chain.
- `launchFingerprint` + the hash-chained `launch_configuration_revisions` give auditability and the anchor a future deployment slice compares against. They are not blockchain proofs.
- Deployment, minting, liquidity, fee routing, payouts and custody are explicitly out of scope and undecided (docs/LAUNCHPAD.md).

## Token proof (Slice 12): derive, never declare
```
launch configuration (READY) + deployment record (none today) + observation history (none today)
  -> evaluateProof (shared, the ONLY verification rule) -> status + per-check PASS/FAIL/UNKNOWN/UNAVAILABLE/NOT_APPLICABLE
  -> buildLaunchProof (owner or redacted public) -> read-only API -> web renders what the server derived
```
- The frontend never decides verification; the server derives `verifiedOnChain` / `verifiedTransparency` from check state; no client field or endpoint can set them.
- A FIXTURE observation can never pass `OBSERVATION_FROM_CHAIN`, so it can never yield VERIFIED. Observations are append-only and hash-chained (tamper-evident auditability, not a blockchain proof).
- `TokenSummary` / `TokenProof` carry a server-computed `verifiedTransparency` (false for demo tokens); the old frontend-decided badge is gone. Details: docs/TOKEN_PROOF.md.

## Deployment plan (Slice 13): build and review only
```
READY launch (server) -> buildDeploymentPlan (pure, deterministic) -> plan + hash -> review (same plan) -> [Slice 14: sign, send, confirm] -> reconcile -> Token Proof
```
BUILD != SIGN != SEND != CONFIRM != RECONCILE != VERIFY. Only BUILD and REVIEW exist. The plan's expected state is the bridge to Slice 12's observed-state proof. See docs/DEPLOYMENT_PLAN.md.

## Execution readiness (Slice 14)
```
stored launch + registry charity + DEPLOYMENT_POLICY (17 decisions) + recorded plan state
  -> evaluateExecutionReadiness (server, pure) -> 23 gates -> BLOCKED | EXECUTION_DISABLED   (executionPermitted: false)
deployment attempts: separate append-only record; PLAN_BUILT / FAILED / CANCELLED only while execution is disabled
```
Launch configuration state, deployment plan, readiness and deployment attempt are four different things. See docs/DEPLOYMENT_DECISIONS.md.
