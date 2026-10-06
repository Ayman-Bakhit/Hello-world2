# PROJECT_NAME

Non-custodial crypto financial OS (track, tax estimate, give) plus a transparent token launchpad on Solana. Principle: **verify, don't trust.**

Working name is `PROJECT_NAME` until branding is final.

## Status

Phase 1 in progress. Nothing is deployed. No mainnet, no custody, no production keys.

| Area | State |
|---|---|
| Fee split math (bps) | Done, tested |
| Tax engine (lots, FIFO/LIFO/HIFO, estimate, reserve) | Done, tested |
| Approved copy + banned-phrase lint | Done |
| Postgres schema | Done, loads on PG16 |
| Web (Next.js): 10 demo screens, mock data, responsive | Done (all data is DEMO) |
| API (Fastify + Zod + Postgres): 13 route groups, demo-backed, session boundary | Done (Slice 1). Not production-ready |
| Solana wallet-signature sign-in, HttpOnly cookie sessions, logout, CSRF origin checks | Done (Slice 2) |
| Frontend wired to the API: auth states, empty/loading/error/demo states, PREPARE LAUNCH, reserve target | Done (Slice 4) |
| Read-only Solana indexing: RPC abstraction, SOL + SPL balances, transactions with conservative classification, live Portfolio (SYNC WALLET), SOL price abstraction | Done (Slice 5), tested against a fake RPC only; NOT verified on a real network (see docs/INDEXING.md) |
| Tax data foundation: events, FIFO/LIFO/HIFO over indexed data, status model, Tax Center wiring | Done (Slice 6), fixture-backed; no real prices, no verified chain data |
| Real historical prices, manual cost basis, reserve/donation/launch on-chain flows | Not started |
| Smart contracts | Not started (blocked on architecture review) |

## Layout

```
apps/web         Next.js frontend (demo build, mock data)
apps/api         Fastify API (demo-backed; see docs/API.md)
packages/shared  Pure TS: fee split, tax engine, copy. No I/O.
db/schema.sql    PostgreSQL schema
docs/            Architecture, threat model, plan, etc.
```

## Dev

```
pnpm install
pnpm dev         # frontend only, http://localhost:3000 (demo data)
pnpm dev:all     # frontend + API (needs Postgres, see docs/ENVIRONMENT.md)
                 # real wallet sign-in + API-backed screens: set NEXT_PUBLIC_API_MODE=api in apps/web/.env.local
                 # (api mode: a real wallet has no indexed data yet, so wallet screens show NO LIVE DATA YET;
                 #  default mock mode shows populated, clearly labeled DEMO DATA)
pnpm test        # all unit tests
pnpm typecheck
```

Docs: [ARCHITECTURE](docs/ARCHITECTURE.md), [DATABASE](docs/DATABASE.md), [THREAT_MODEL](docs/THREAT_MODEL.md), [MVP_PLAN](docs/MVP_PLAN.md), [API](docs/API.md), [SECURITY](docs/SECURITY.md), [FRONTEND](docs/FRONTEND.md), [TAX_ENGINE](docs/TAX_ENGINE.md), [LEGAL](docs/LEGAL_CONSIDERATIONS.md).
