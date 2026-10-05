# Testing
- `pnpm test` runs vitest (shared package: fee split, tax engine, copy lint).
- DB: `db/schema.sql` must load on PG16 with `ON_ERROR_STOP=1`; to be automated in CI.
- Planned: API integration tests (auth replay/expiry), indexer idempotency, contract unit/invariant/fuzz tests, Playwright e2e for the seven flows in the spec.
- Web (`apps/web`): vitest covers formatting, fee-draft parsing (100.01% / 99.99% rejected via shared math), launch validation, mock-data consistency (totals, tax exposure recomputed with the shared engine), and a copy lint over all frontend source (banned phrases, positive safety claims).
- Browser checks used in Slice 3 (not yet automated in CI): every route loads, no horizontal overflow at 390px and 1440px, wallet modal, fee-split blocking, signing summary, Discover filters, table sort, zero console errors. Playwright e2e is planned.
