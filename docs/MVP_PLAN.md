# MVP Implementation Plan

One vertical slice at a time. After each: tests, typecheck, lint, build, docs.

| Slice | Contents | Exit criteria |
|---|---|---|
| 0 (done) | Monorepo, shared math (fee split, tax engine), schema, docs | 33 tests green, schema loads |
| 3 (done, pulled forward) | Next.js frontend, all 10 demo screens, mock data layer, DEMO DATA labeling | build/typecheck/lint/tests green, every route loads, mobile OK. See FRONTEND.md |
| 1 (done) | API foundation: Fastify, Zod, pg, env validation, migrations + demo seed, 13 route groups, session boundary, typed web client with mock/api switch | 97 API tests on real Postgres, typecheck/lint/build green. Wallet sign-in NOT done (slice 2). See API.md |
| 2 (done) | Wallet auth: nonce, ed25519 verify, user/wallet lookup-or-create, HttpOnly cookie sessions, logout, rotation, CSRF origin checks, real frontend flow (CONNECTED vs AUTHENTICATED) | replay/expiry/wrong-key/modified-message tests (149 API tests), mutation-checked, 22-check browser run. See SECURITY.md |
| 3b (done in slice 2) | Mock wallet replaced by Wallet Standard connect + server-verified sign-in when `NEXT_PUBLIC_API_MODE=api` (mock stays the default) | real connect + sign in a browser |
| 3c (done as Slice 4) | UI screens read the API client in both modes; AUTH states in the shell; NO_LIVE_DATA empty states; launch = PREPARE LAUNCH (save + server review); reserve = target only; donations = information + records only | 332 tests, 47-check API-mode and 82-check mock-mode browser runs. See FRONTEND.md |
| 3d | Wallet linking (add a 2nd wallet via signature); wallet labels | link requires a fresh signature from the new wallet |
| 4 + 5 (done as "Slice 5") | Read-only Solana indexing: RPC provider abstraction, SOL + SPL balances, untrusted metadata, bounded idempotent transaction sync into immutable raw records, conservative classification, price abstraction (SOL only), live Portfolio/Transactions with SYNC WALLET, demo/live separation | 209 API / 91 shared / 134 web tests (post-audit), deterministic fake RPC, 60-check API-mode browser run against a fake RPC, 82-check mock run. NOT verified against a real network (sandbox blocks RPC; see INDEXING.md "Verification status") and `smoke:rpc`. Not done: reorg handling for `confirmed`, price history, SPL prices, full-history backfill |
| 6 (done: data foundation) | Tax data model, conservative tax-event adapter, FIFO/LIFO/HIFO over indexed data, price-provider abstraction (fixture + price_observations), transfer matching (same-signature only), explicit calculation status, tax and reserve API + Tax Center wiring | 131 shared tests (40 new tax-data), 230 API tests (21 new tax), 144 web; incomplete input can never read COMPLETE (property test + mutation checks). **Fixture-backed**: no real prices, no verified chain data, no manual cost basis yet. See TAX_ENGINE.md |
| 7a (done: manual cost basis) | USER_PROVIDED basis: immutable hash-chained revisions, ownership-scoped API, engine integration (wallet-scoped lots, transfer linking, duplicate/overlap review), Tax Center workflow, rates moved to POST bodies | 162 shared / 256 API / 157 web tests, mutation checks, 78-check API-mode and 82-check mock-mode browser runs. Fixture-backed; chain data and prices unverified. See TAX_ENGINE.md |
| 8 (done: reporting) | Estimated tax report over the existing calculation (explicit UTC year, status never improved, provenance per row, manual-basis disclosure), deterministic CSV and JSON export, bounded work (rows, transactions, concurrency), Tax Center TAX REPORT | 191 shared / 280 API / 163 web tests, six mutation checks, 85-check API-mode and 82-check mock-mode browser runs. Fixture-backed; no real prices or verified chain data. See TAX_ENGINE.md |
| 10a (done: reserve foundation) | Reserve layer over the existing tax result (estimate, recommendation, user target, balance, coverage kept separate; status never upgraded), explicit-confirmation target save, append-only target history, reserve ledger write-locked, Tax Reserve Center on API and mock | 236 shared / 339 API / 200 web, 103-check API browser, 100-check mock browser; NO money movement; reserve balance UNAVAILABLE for real wallets |
| 10b | Tax reserve funding (USDC): non-custodial deposit flow, signing summary, ledger, reconciliation | devnet only; needs the custody, wallet-architecture and legal decisions listed in docs/TAX_ENGINE.md |
| 9a (done: Give foundation) | Charity registry with explicit verification states, append-only verification evidence (source, checked-at, public summary vs admin-only notes), donation records and receipts as separate models (confirmed needs an indexed chain transaction; fixtures never look confirmed), ownership-scoped read APIs, stateless donation review with the final action disabled, Give Center wired to API and mock mode | 207 shared / 311 API / 184 web, 94-check API browser, 90-check mock browser; NO money movement; fixture verification is not real-world verification |
| 9b | Give: real donation transfer (non-custodial, user-signed), receipt issuance | needs the decisions listed in docs/CHARITY.md |
| 9 | Launch (devnet): SPL token create, fee split config UI, authority display | review gate before any program |
| 10 | Proof page + Discover (real data only) | each number links to explorer |
| 11 | Hardening: CSP, CSRF, rate limits, audit prep | external review |

First demo screens (spec #72): Landing, Connect, Portfolio, Tax Center, Tax Reserve, Give, Launch, Launch Config, Proof, Discover. Mock data is always visibly badged DEMO DATA and replaced service by service.

## Gates
- No contract deploy until architecture and tests reviewed.
- No mainnet until independent audit and legal review.
- Legal review (money transmission, securities, charitable solicitation, tax reporting, sanctions) before any public launch.
