# MVP Implementation Plan

One vertical slice at a time. After each: tests, typecheck, lint, build, docs.

| Slice | Contents | Exit criteria |
|---|---|---|
| 0 (done) | Monorepo, shared math (fee split, tax engine), schema, docs | 33 tests green, schema loads |
| 3 (done, pulled forward) | Next.js frontend, all 10 demo screens, mock data layer, DEMO DATA labeling | build/typecheck/lint/tests green, every route loads, mobile OK. See FRONTEND.md |
| 1 (done) | API foundation: Fastify, Zod, pg, env validation, migrations + demo seed, 13 route groups, session boundary, typed web client with mock/api switch | 97 API tests on real Postgres, typecheck/lint/build green. Wallet sign-in NOT done (slice 2). See API.md |
| 2 | Wallet auth: nonce, ed25519 verify, sessions, rate limit | replay/expiry/wrong-key tests |
| 3b | Replace the mock wallet with Wallet Standard adapters + server-verified sign-in (depends on slice 2) | real connect on devnet |
| 4 | Portfolio: RPC balances, price service interface + one provider, mock fallback labeled DEMO | real balances on devnet/mainnet read-only |
| 5 | Transaction indexer to raw_transactions, normalizer, history view | idempotent, reorg-safe |
| 6 | Tax Center: wire engine to indexed data, realized P&L, estimate with user assumptions | numbers trace to signatures |
| 7 | Tax reserve (USDC): non-custodial deposit flow, signing summary | devnet only |
| 8 | Give: charity registry (admin-verified), donate, receipt | receipts immutable |
| 9 | Launch (devnet): SPL token create, fee split config UI, authority display | review gate before any program |
| 10 | Proof page + Discover (real data only) | each number links to explorer |
| 11 | Hardening: CSP, CSRF, rate limits, audit prep | external review |

First demo screens (spec #72): Landing, Connect, Portfolio, Tax Center, Tax Reserve, Give, Launch, Launch Config, Proof, Discover. Mock data is always visibly badged DEMO DATA and replaced service by service.

## Gates
- No contract deploy until architecture and tests reviewed.
- No mainnet until independent audit and legal review.
- Legal review (money transmission, securities, charitable solicitation, tax reporting, sanctions) before any public launch.
