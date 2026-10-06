-- 003_solana_indexing: read-only Solana indexing. Additive: new tables/columns/indexes/constraints.
-- Nothing is dropped. Two CHECK constraints are replaced by wider ones; three NOT NULLs are loosened so the
-- schema can represent "unknown" honestly instead of forcing a made-up value.

-- ===== assets: a real SPL mint may have no known symbol. Never fabricate one. =====
ALTER TABLE assets ALTER COLUMN symbol DROP NOT NULL;
ALTER TABLE assets ADD COLUMN kind text NOT NULL DEFAULT 'spl' CHECK (kind IN ('native','spl'));
ALTER TABLE assets ADD COLUMN data_source text NOT NULL DEFAULT 'chain' CHECK (data_source IN ('demo','database','chain'));
UPDATE assets SET kind = 'native' WHERE address = 'native';
UPDATE assets SET data_source = 'demo' WHERE address LIKE 'DEMO%';
CREATE INDEX assets_kind_idx ON assets (kind);

-- Token metadata is UNTRUSTED text written by token authorities. It lives apart from asset identity.
CREATE TABLE asset_metadata (
  asset_id uuid PRIMARY KEY REFERENCES assets(id),
  status text NOT NULL CHECK (status IN ('resolved','unavailable')),
  name text,
  symbol text,
  uri text,
  source text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  fetched_at timestamptz
);

-- ===== sync bookkeeping =====
CREATE TABLE wallet_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  trigger text NOT NULL CHECK (trigger IN ('login','manual','background')),
  status text NOT NULL CHECK (status IN ('running','succeeded','partial','failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  slot bigint,
  limits jsonb NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  CHECK (status = 'running' OR finished_at IS NOT NULL)
);
-- At most one running sync per wallet (concurrency guard that survives restarts).
CREATE UNIQUE INDEX wallet_sync_runs_one_running_uidx ON wallet_sync_runs (wallet_id) WHERE status = 'running';
CREATE INDEX wallet_sync_runs_wallet_idx ON wallet_sync_runs (wallet_id, started_at DESC);

CREATE TABLE wallet_sync_state (
  wallet_id uuid PRIMARY KEY REFERENCES wallets(id),
  /** newest signature such that everything at or below it (inside the indexed window) is indexed */
  newest_signature text,
  newest_slot bigint,
  oldest_signature text,
  oldest_slot bigint,
  history_complete boolean NOT NULL DEFAULT false,
  has_gap boolean NOT NULL DEFAULT false,
  last_success_at timestamptz,
  last_slot bigint
);

-- ===== raw observations (immutable) =====
-- block_time can be unknown to a node; do not force a timestamp.
ALTER TABLE raw_transactions ALTER COLUMN block_time DROP NOT NULL;
CREATE INDEX raw_transactions_slot_idx ON raw_transactions (slot);
-- (raw_transactions already has UNIQUE (chain, signature) and the append-only trigger.)

-- Balance observations: what an RPC node reported for a wallet's SOL / token account at a slot. Append-only.
CREATE TABLE balance_observations (
  id bigserial PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  token_account text,                          -- NULL for native SOL
  amount numeric(40,0) NOT NULL CHECK (amount >= 0),
  decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 38),
  slot bigint NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  sync_run_id uuid REFERENCES wallet_sync_runs(id),
  -- the same observation (same account, same slot) can never be inserted twice
  UNIQUE NULLS NOT DISTINCT (wallet_id, asset_id, token_account, slot)
);
CREATE INDEX balance_observations_wallet_idx ON balance_observations (wallet_id, asset_id, slot DESC);
CREATE INDEX balance_observations_token_account_idx ON balance_observations (token_account);
CREATE TRIGGER balance_observations_append_only BEFORE UPDATE OR DELETE ON balance_observations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Current holdings (DERIVED from the latest observations; safe to rebuild).
ALTER TABLE token_holdings ADD COLUMN observed_at timestamptz;
ALTER TABLE token_holdings ADD COLUMN token_account_count integer NOT NULL DEFAULT 0 CHECK (token_account_count >= 0);
ALTER TABLE token_holdings ADD COLUMN last_sync_run_id uuid REFERENCES wallet_sync_runs(id);
CREATE INDEX token_holdings_asset_idx ON token_holdings (asset_id);

-- ===== normalized (derived) transactions =====
ALTER TABLE transactions DROP CONSTRAINT transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK (kind IN (
  'transfer_in','transfer_out','swap','lp_add','lp_remove','fee_in','donation','vault_deposit','vault_withdrawal','other',
  'transfer','token_receipt','token_send','fee','unknown'));
ALTER TABLE transactions ALTER COLUMN occurred_at DROP NOT NULL;
ALTER TABLE transactions ADD COLUMN status text CHECK (status IN ('success','failed'));
ALTER TABLE transactions ADD COLUMN fee_lamports bigint CHECK (fee_lamports >= 0);
ALTER TABLE transactions ADD COLUMN slot bigint;
ALTER TABLE transactions ADD COLUMN classification_reason text;
ALTER TABLE transactions ADD COLUMN classifier_version text;
ALTER TABLE transactions ADD COLUMN program_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE transactions ADD COLUMN data_source text NOT NULL DEFAULT 'chain' CHECK (data_source IN ('demo','database','chain'));
-- A wallet has at most one normalized row per raw transaction: re-indexing cannot duplicate.
CREATE UNIQUE INDEX transactions_wallet_raw_uidx ON transactions (wallet_id, raw_transaction_id);
CREATE INDEX transactions_wallet_slot_idx ON transactions (wallet_id, slot DESC);
CREATE INDEX transactions_raw_idx ON transactions (raw_transaction_id);

-- What moved for the wallet in a transaction, per asset (traceable to the raw payload through transactions.raw_transaction_id).
CREATE TABLE transaction_asset_deltas (
  transaction_id uuid NOT NULL REFERENCES transactions(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  delta numeric(40,0) NOT NULL CHECK (delta <> 0),   -- signed raw units; native SOL excludes the network fee
  decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 38),
  PRIMARY KEY (transaction_id, asset_id)
);
CREATE INDEX transaction_asset_deltas_asset_idx ON transaction_asset_deltas (asset_id);

-- ===== prices =====
CREATE INDEX price_observations_asset_time_idx ON price_observations (asset_id, observed_at DESC);
