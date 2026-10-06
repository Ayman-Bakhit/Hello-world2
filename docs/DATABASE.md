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

## Migrations (Slice 1)
- `db/schema.sql` is the baseline. `db/migrations/NNN_*.sql` apply in order. Runner: `pnpm db:migrate` (`apps/api/src/db/migrate.ts`). It applies the baseline only to an empty database, records applied files in `schema_migrations`, runs each migration in a transaction, takes an advisory lock, and **never drops, truncates, or resets**. Re-running is a no-op.
- `pnpm db:seed-demo` inserts clearly labeled demo rows (idempotent, refuses in production). It is never run automatically.
- Tests create and drop only a dedicated `pn_api_test` database (name guard in `test/globalSetup.ts`).

### 001_api_foundation (additive)
| Change | Why |
|---|---|
| `users.is_demo`, `wallets/charities/donations.data_source` (`demo`/`database`/`chain`) | provenance on every record; dev sessions limited to demo users |
| `donations.status` CHECK now allows `demo`; new CHECKs: `confirmed` requires `raw_transaction_id`, `demo` forbids it | a donation cannot be "confirmed" without a verifiable transaction |
| `tax_reserves.currency` (USDC only), `updated_at`, unique `(user_id)`, CHECK that rule fields are consistent | one target per user; upsert; no funds stored |
| new `launch_configurations` (+ CHECK `launch_fee_split_is_10000_bps` on the JSON) | launch drafts and review results; DB refuses any split not summing to 10000 |
| index `sessions(user_id)` | session lookups |
Existing data is untouched. The one replaced constraint (`donations_status_check`) only widens allowed values. If existing `tax_reserves` rows had duplicate users, the unique index would fail loudly and roll back; the table was never written before this slice.
Tax reserve mapping: API `percentage` = `rule FIXED_PERCENT` + `percent_bps`; `amount` = `MANUAL_TARGET` + `target_cents`.

### 002_wallet_auth (additive)
| Change | Why |
|---|---|
| `auth_nonces.message`, `.domain`, `.chain_id` (defaults dropped) | store the exact challenge text; verification requires an exact match |
| CHECK `nonce ~ '^[A-Za-z0-9_-]{32}$'`, CHECK consumed_at >= issued_at; indexes on (address, issued_at) and expires_at | nonce format/lifecycle integrity, fast per-address cap and cleanup |
| `sessions.auth_method` (`wallet_signature` \| `dev_insecure`, default dropped), `sessions.wallet_id` | production rejects `dev_insecure`; sessions name the wallet that signed |
| CHECK `wallet_signature` sessions must have `wallet_id` | no wallet session without a wallet |
| CHECK `wallets_demo_never_verified` | demo wallets can never be marked verified |
Pre-existing session rows (only the dev endpoint could have created them) become `dev_insecure`. No data is dropped. Wallet/user creation relies on the existing `UNIQUE(chain, address)`; the sign-in transaction also takes a per-address advisory lock.

### 003_solana_indexing (additive)
| Change | Why |
|---|---|
| `assets.symbol` nullable; `assets.kind` (`native`/`spl`), `assets.data_source` | a real SPL mint can have no known symbol; never fabricate one |
| new `asset_metadata` (status, name, symbol, uri, source, attempted_at) | untrusted token text kept apart from asset identity |
| new `wallet_sync_runs` (+ partial UNIQUE index: one `running` run per wallet), `wallet_sync_state` | run history, concurrency guard that survives restarts, anchor and window (`history_complete`, `has_gap`) |
| `raw_transactions.block_time` nullable; index on `slot` | a node may not know a block time; do not invent one |
| new `balance_observations` (append-only trigger, UNIQUE wallet+asset+token_account+slot NULLS NOT DISTINCT) | what a node reported, at which slot |
| `token_holdings.observed_at`, `token_account_count`, `last_sync_run_id`; index on `asset_id` | derived current holdings with provenance |
| `transactions.kind` CHECK widened (`transfer`, `token_receipt`, `token_send`, `fee`, `unknown`); `occurred_at` nullable; new `status`, `fee_lamports`, `slot`, `classification_reason`, `classifier_version`, `program_ids`, `data_source`; UNIQUE `(wallet_id, raw_transaction_id)`; indexes on `(wallet_id, slot DESC)` and `raw_transaction_id` | re-indexing cannot duplicate; every label is explainable and traceable |
| new `transaction_asset_deltas` (PK transaction+asset) | what moved for the wallet, per asset |
| index `price_observations(asset_id, observed_at DESC)` | latest price lookup |
Nothing is dropped. The replaced constraint (`transactions_kind_check`) only widens allowed values. Derived tables (`transactions`, `transaction_asset_deltas`, `token_holdings`) can be rebuilt from `raw_transactions` and `balance_observations`. The seed's SOL asset insert is `ON CONFLICT DO NOTHING` so it cannot collide with the indexer's native asset.
