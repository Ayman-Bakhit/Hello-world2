# Database

Source of truth: `db/schema.sql` (PostgreSQL 16). Verified to load clean.

## Conventions
- USD = bigint cents. Prices = bigint micro-USD per whole token. Token amounts = `numeric(40,0)` base units. Rates = integer bps.
- Raw/immutable: `raw_transactions`, `audit_logs`, `donation_receipts` have triggers that reject UPDATE/DELETE.
- Derived/rebuildable: `transactions`, `token_holdings`, `cost_basis_lots`, `realized_events`, `tax_estimates`.
- Soft delete for wallets (`removed_at`) so history stays traceable.

## Integrity enforced in the DB
- `token_fee_splits`: four bps columns must sum to exactly 10000 (CHECK). Tested: 10001 is rejected.
- `realized_events.gain_loss = proceeds - cost_basis` (CHECK).
- Charity `verified` requires `verified_by` and `verified_at`. Wallets verified separately from the org.
- Audit log requires non-empty `reason`.
- Auth nonces: expiry after issue; `consumed_at` for single use. Sessions store only a token hash.

## Traceability
swap -> `raw_transactions` (payload as received) -> `transactions` (normalized, price observation ref) -> `cost_basis_lots` / `realized_events` (lot + tx refs). Any tax number walks back to a signature.

## Not yet done
Migrations tool (choose node-pg-migrate or similar), row-level security review, indexes beyond the obvious, retention policy, per-user data export/delete flow.
