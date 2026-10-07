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

### 004_tax_data (additive)
| Change | Why |
|---|---|
| `price_observations.kind` (`spot`/`historical`/`fixture`), `.confidence` (`observed`/`fixture`) | provenance of a price travels to the tax result |
| CHECK `price_micro_usd > 0` (NOT VALID: new rows only) | a zero price is "no price" |
| trigger forbidding UPDATE on `price_observations` | a rewritten price would silently change past tax figures. DELETE stays allowed (it only removes a price, giving "PRICE DATA UNAVAILABLE") |
| partial index `transactions(wallet_id, occurred_at) WHERE data_source='chain'` | tax reads |
**No tax tables were added.** Tax events, lots and realized slices are derived on demand from `transactions`, `transaction_asset_deltas` (which trace to immutable `raw_transactions`) and `price_observations`. Each response carries an input fingerprint (sha256 over transactions, classifier versions, prices used, method, year), so a result can be reproduced and a change in source data is detectable. The baseline `cost_basis_lots` / `realized_events` tables remain unused; persisting snapshots is a later decision.

### 005_manual_cost_basis (additive)
| Table | Purpose |
|---|---|
| `manual_cost_basis` | identity of a user-provided basis record: user, wallet, asset (`native` or mint, format CHECK), decimals, `source` (CHECK = `USER_PROVIDED`), creating auth method, created time. **Immutable** (update/delete trigger) |
| `manual_cost_basis_revisions` | every version: revision number, action (`create|revise|void`), status (`active|voided`), `quantity` numeric(40,0) > 0 (exact raw units), `acquired_at` >= 2009-01-03, `cost_basis_cents` numeric(40,0) >= 0, currency (CHECK USD), reason (CHECK enum), optional signature (base58 CHECK) and notes (<= 1000), `acknowledged_overlap`, `change_reason` (3-300 chars, required for revise/void), `prev_hash`, `row_hash`. **Append-only** (trigger), `UNIQUE(basis_id, revision)`, CHECKs tie action to revision/status/reason/hash-link |
| view `manual_cost_basis_current` | latest revision per record. "Current" is derived, never stored, so there is no mutable copy to tamper with |
No hard delete exists anywhere: voiding is a new revision. The API computes `row_hash = sha256(basis id, revision, action, status, quantity, time, cost, currency, reason, signature, notes, acknowledgement, change reason, prev_hash)`, and `GET .../manual-basis/:id` recomputes the chain (`historyIntact`). Triggers stop the application; the hash chain makes a direct superuser edit **detectable** (tested by disabling the trigger and editing a row). It is not tamper-proof against someone who can also rewrite every later hash. Access is always filtered by user AND wallet in SQL.

## Slice 9: Give foundation (`db/migrations/006_give_foundation.sql`, additive except as noted)
- `charities`: + `slug` (unique), `logo_url`, `updated_at`, `verification_state` (`UNVERIFIED|PENDING_REVIEW|VERIFIED|SUSPENDED`), `verification_source`, `verification_checked_at`, `verification_notes` (admin only). **Replaces** the old `verification_status` enum column and `verified_by` / `verified_at` (existing `verified` rows become `VERIFIED` with a labeled `FIXTURE` evidence row; `pending`->`PENDING_REVIEW`, `rejected`->`UNVERIFIED`, `revoked`->`SUSPENDED`). Constraints: VERIFIED needs source and review time; `FIXTURE` source only for demo rows; URL, slug and length checks.
- `charity_verification_evidence` (new, append-only): `source_type` (`REGISTRY_LOOKUP|OFFICIAL_DOCUMENT|WEBSITE_CLAIM|ADMIN_REVIEW|FIXTURE`), `source_ref`, `source_url`, `status` (`SUPPORTS|DOES_NOT_SUPPORT|INCONCLUSIVE`), `checked_at`, `verifier_user_id` and `internal_notes` (admin only), `public_summary`, `data_source`. FIXTURE evidence iff demo data and matching the charity's data source. A deferred constraint trigger requires supporting evidence (not `WEBSITE_CLAIM`) for any VERIFIED charity.
- `donations`: `usd_value_cents` now nullable; + `donated_at`, `updated_at`, `usd_reference_source`, `provenance` (`DEMO_FIXTURE|USER_PLAN|CHAIN_INDEXED`); status adds `draft` and `cancelled` (`demo` kept as the explicit fixture marker). Constraints: confirmed => chain data, chain provenance, `donated_at`, a transaction; demo status <=> demo data <=> fixture provenance; a trigger requires the confirming transaction to be an indexed chain transaction of the donor wallet.
- `donation_receipts`: + `charity_receipt_reference`, `document_url` (https), `receipt_hash` (sha256 hex), `verification_state`, `provenance_note`, `data_source`, `created_at`. Triggers: receipt data source = donation data source; a non-fixture receipt needs a confirmed donation; a fixture receipt is never VERIFIED. Still append-only.

## Slice 10: tax reserve foundation (`db/migrations/007_tax_reserve_foundation.sql`, additive)
- **USER CONFIGURATION (persisted)**: `tax_reserves` gained `target_source` (`USER_SET | SYSTEM_RECOMMENDED`, default `USER_SET`) and `enabled`. One row per user (unchanged), USDC only, `rule` `FIXED_PERCENT` (percent of realized gains) or `MANUAL_TARGET` (integer cents). The API only writes `USER_SET`; `SYSTEM_RECOMMENDED` exists so a future "adopt the recommendation" feature has a provenance value (that feature needs a decision: snapshot vs live-tracking).
- `tax_reserve_target_events` (new, append-only, UPDATE/DELETE rejected): one row per save with the rule, percent or cents, source, enabled, auth method. Configuration history only: no tax figure, no balance.
- **DERIVED CALCULATION (never persisted)**: tax estimate, recommendation, coverage, remaining. A test asserts no reserve table has an exposure / recommendation / coverage / balance column.
- `tax_reserve_transactions` (the baseline placeholder for a future reserve ledger) is write-locked by trigger `tax_reserve_transactions_not_enabled`: no row can exist, so no deposit can be fabricated and read as a balance. Remove the trigger only together with a reviewed funding and reconciliation design.
- Money: target amounts are `bigint` cents, at most 12 digits of dollars and 2 decimals at the API; responses carry integer strings. No floating point.
