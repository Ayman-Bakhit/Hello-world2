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
| Real wallet sign-in, indexer, price service | Not started |
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
pnpm test        # all unit tests
pnpm typecheck
```

Docs: [ARCHITECTURE](docs/ARCHITECTURE.md), [DATABASE](docs/DATABASE.md), [THREAT_MODEL](docs/THREAT_MODEL.md), [MVP_PLAN](docs/MVP_PLAN.md), [API](docs/API.md), [FRONTEND](docs/FRONTEND.md), [TAX_ENGINE](docs/TAX_ENGINE.md), [SECURITY](docs/SECURITY.md), [LEGAL](docs/LEGAL_CONSIDERATIONS.md).
