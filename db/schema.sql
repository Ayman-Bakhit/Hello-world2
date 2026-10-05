-- PROJECT_NAME schema v0. PostgreSQL 16.
-- Rules: money = bigint minor units (USD cents / token base units). No floats.
-- Raw chain data is append-only (see immutability triggers at bottom). Derived tables are rebuildable.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE chain AS ENUM ('solana');  -- extend with EVM chains in V3
CREATE TYPE verification_status AS ENUM ('pending','verified','rejected','revoked');
CREATE TYPE mutability AS ENUM ('IMMUTABLE','ADMIN_CONTROLLED');

-- ===== identity / auth =====
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text,                       -- optional, user-chosen, public only if user opts in
  is_display_name_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  chain chain NOT NULL,
  address text NOT NULL,
  label text,
  ownership_verified_at timestamptz,       -- set only after signature verification
  removed_at timestamptz,                  -- soft delete; history is retained
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain, address)
);

CREATE TABLE auth_nonces (
  nonce text PRIMARY KEY,                  -- >=128 bits random
  chain chain NOT NULL,
  address text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,                 -- single use: replay protection
  CHECK (expires_at > issued_at)
);

CREATE TABLE sessions (
  id_hash bytea PRIMARY KEY,               -- sha256 of session token; token itself never stored
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

-- ===== assets / prices =====
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain chain NOT NULL,
  address text NOT NULL,                   -- mint address; 'native' for SOL
  symbol text NOT NULL,
  name text,
  decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 38),
  UNIQUE (chain, address)
);

CREATE TABLE price_observations (
  id bigserial PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES assets(id),
  provider text NOT NULL,
  observed_at timestamptz NOT NULL,
  price_micro_usd bigint NOT NULL CHECK (price_micro_usd >= 0),
  liquidity_cents bigint,
  UNIQUE (asset_id, provider, observed_at)
);

-- ===== transactions: immutable raw + derived =====
CREATE TABLE raw_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain chain NOT NULL,
  signature text NOT NULL,                 -- tx hash
  slot bigint NOT NULL,
  block_time timestamptz NOT NULL,
  payload jsonb NOT NULL,                  -- original RPC/indexer response, never edited
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain, signature)
);

CREATE TABLE transactions (               -- normalized view of raw_transactions, rebuildable
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_transaction_id uuid NOT NULL REFERENCES raw_transactions(id),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  kind text NOT NULL CHECK (kind IN ('transfer_in','transfer_out','swap','lp_add','lp_remove','fee_in','donation','vault_deposit','vault_withdrawal','other')),
  asset_in_id uuid REFERENCES assets(id),
  amount_in numeric(40,0),
  asset_out_id uuid REFERENCES assets(id),
  amount_out numeric(40,0),
  usd_value_cents bigint,
  price_observation_id bigint REFERENCES price_observations(id),
  is_taxable_disposal boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX ON transactions (wallet_id, occurred_at);

CREATE TABLE token_holdings (
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  balance numeric(40,0) NOT NULL CHECK (balance >= 0),
  as_of_slot bigint NOT NULL,
  PRIMARY KEY (wallet_id, asset_id)
);

-- ===== tax =====
CREATE TABLE cost_basis_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  source_transaction_id uuid NOT NULL REFERENCES transactions(id),
  quantity numeric(40,0) NOT NULL CHECK (quantity > 0),
  remaining_quantity numeric(40,0) NOT NULL CHECK (remaining_quantity >= 0 AND remaining_quantity <= quantity),
  cost_basis_cents bigint NOT NULL CHECK (cost_basis_cents >= 0),
  acquired_at timestamptz NOT NULL
);

CREATE TABLE realized_events (            -- mirrors RealizedEvent in packages/shared
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  transaction_id uuid NOT NULL REFERENCES transactions(id),
  lot_id uuid NOT NULL REFERENCES cost_basis_lots(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  quantity numeric(40,0) NOT NULL CHECK (quantity > 0),
  acquisition_timestamp timestamptz NOT NULL,
  acquisition_price_micro bigint NOT NULL,
  disposal_timestamp timestamptz NOT NULL,
  disposal_price_micro bigint NOT NULL,
  cost_basis_cents bigint NOT NULL,
  proceeds_cents bigint NOT NULL,
  gain_loss_cents bigint NOT NULL,
  holding_period text NOT NULL CHECK (holding_period IN ('SHORT_TERM','LONG_TERM')),
  classification text NOT NULL CHECK (classification IN ('CAPITAL_GAIN','CAPITAL_LOSS','BREAKEVEN')),
  cost_basis_method text NOT NULL CHECK (cost_basis_method IN ('FIFO','LIFO','HIFO')),
  CHECK (gain_loss_cents = proceeds_cents - cost_basis_cents)
);

CREATE TABLE tax_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  tax_year smallint NOT NULL,
  assumptions jsonb NOT NULL,              -- full TaxAssumptions snapshot
  estimated_exposure_cents bigint NOT NULL CHECK (estimated_exposure_cents >= 0),
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tax_reserves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  vault_address text,                      -- user-controlled; platform has no withdrawal authority
  rule text NOT NULL CHECK (rule IN ('FIXED_PERCENT','MANUAL_TARGET')),
  percent_bps integer CHECK (percent_bps BETWEEN 0 AND 10000),
  target_cents bigint CHECK (target_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tax_reserve_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_reserve_id uuid NOT NULL REFERENCES tax_reserves(id),
  raw_transaction_id uuid NOT NULL REFERENCES raw_transactions(id),
  direction text NOT NULL CHECK (direction IN ('deposit','withdrawal')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0)
);

-- ===== charity =====
CREATE TABLE charities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  website text,
  country char(2),
  category text,
  verification_status verification_status NOT NULL DEFAULT 'pending',
  legal_entity_identifier text,            -- e.g. US EIN; verified by admin review
  verified_by uuid,                        -- admin user id
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (verification_status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);

CREATE TABLE charity_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charity_id uuid NOT NULL REFERENCES charities(id),
  chain chain NOT NULL,
  address text NOT NULL,
  supported_assets text[] NOT NULL DEFAULT '{}',
  verification_status verification_status NOT NULL DEFAULT 'pending',  -- wallet verified separately from org
  verification_evidence text,
  UNIQUE (chain, address)
);

CREATE TABLE donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  charity_id uuid NOT NULL REFERENCES charities(id),
  charity_wallet_id uuid NOT NULL REFERENCES charity_wallets(id),
  source_wallet_id uuid NOT NULL REFERENCES wallets(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  amount numeric(40,0) NOT NULL CHECK (amount > 0),
  usd_value_cents bigint NOT NULL,         -- at donation time
  raw_transaction_id uuid REFERENCES raw_transactions(id),
  status text NOT NULL CHECK (status IN ('pending','confirmed','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE donation_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id uuid NOT NULL UNIQUE REFERENCES donations(id),
  receipt_reference text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now()
);

-- ===== launchpad =====
CREATE TABLE creator_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  public_name text,
  bio text,
  disclosed_wallets text[] NOT NULL DEFAULT '{}'   -- team wallets must be disclosed
);

CREATE TABLE tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL REFERENCES users(id),
  chain chain NOT NULL,
  mint_address text,                       -- null until deployed
  name text NOT NULL,
  symbol text NOT NULL,
  description text,
  image_uri text,
  total_supply numeric(40,0) NOT NULL CHECK (total_supply > 0),
  decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 18),
  mint_authority text,                     -- null = disabled; mirrored from chain by indexer
  freeze_authority text,
  update_authority text,
  creator_allocation_bps integer CHECK (creator_allocation_bps BETWEEN 0 AND 10000),
  verified_transparency boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain, mint_address)
);

CREATE TABLE token_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL REFERENCES tokens(id),
  raw_transaction_id uuid NOT NULL REFERENCES raw_transactions(id),
  cluster text NOT NULL CHECK (cluster IN ('devnet','testnet','mainnet-beta')),
  deployed_at timestamptz NOT NULL
);

CREATE TABLE token_fee_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL REFERENCES tokens(id),
  creator_bps integer NOT NULL CHECK (creator_bps >= 0),
  tax_reserve_bps integer NOT NULL CHECK (tax_reserve_bps >= 0),
  charity_bps integer NOT NULL CHECK (charity_bps >= 0),
  protocol_bps integer NOT NULL CHECK (protocol_bps >= 0),
  creator_destination text NOT NULL,
  tax_reserve_destination text NOT NULL,
  charity_destination text NOT NULL,
  protocol_destination text NOT NULL,
  mutability mutability NOT NULL,          -- must match actual contract behavior
  effective_from timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT split_sums_to_100pct CHECK (creator_bps + tax_reserve_bps + charity_bps + protocol_bps = 10000)
);

CREATE TABLE liquidity_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL REFERENCES tokens(id),
  pool_address text NOT NULL,
  liquidity_cents bigint NOT NULL,
  lock_until timestamptz,                  -- null = not locked
  lock_proof_tx text,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE creator_fee_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL REFERENCES tokens(id),
  raw_transaction_id uuid NOT NULL REFERENCES raw_transactions(id),
  bucket text NOT NULL CHECK (bucket IN ('creator','tax_reserve','charity','protocol')),
  asset_id uuid NOT NULL REFERENCES assets(id),
  amount numeric(40,0) NOT NULL CHECK (amount >= 0),
  usd_value_cents bigint,
  occurred_at timestamptz NOT NULL
);

CREATE TABLE protocol_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_transaction_id uuid NOT NULL REFERENCES raw_transactions(id),
  kind text NOT NULL CHECK (kind IN ('revenue','expense')),
  asset_id uuid NOT NULL REFERENCES assets(id),
  amount numeric(40,0) NOT NULL CHECK (amount > 0),
  usd_value_cents bigint,
  memo text
);

-- ===== governance / ops =====
CREATE TABLE admins (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  role text NOT NULL,                      -- every role + its powers documented in SECURITY.md
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  reason text NOT NULL CHECK (length(reason) > 0),
  ip_hash bytea,                           -- hashed; raw IP only if legally required
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE risk_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL REFERENCES tokens(id),
  flag text NOT NULL,
  evidence text,
  raised_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('tax_summary','transactions_csv','donations_report','creator_income','reserve_report','token_fee_report')),
  tax_year smallint,
  storage_key text NOT NULL,
  sha256 bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== immutability: raw data and audit log are append-only =====
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;

CREATE TRIGGER raw_transactions_append_only BEFORE UPDATE OR DELETE ON raw_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER donation_receipts_append_only BEFORE UPDATE OR DELETE ON donation_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
