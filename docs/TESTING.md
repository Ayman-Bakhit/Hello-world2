# Testing
- `pnpm test` runs vitest (shared package: fee split, tax engine, copy lint).
- DB: `db/schema.sql` must load on PG16 with `ON_ERROR_STOP=1`; to be automated in CI.
- Planned: API integration tests (auth replay/expiry), indexer idempotency, contract unit/invariant/fuzz tests, Playwright e2e for the seven flows in the spec.
