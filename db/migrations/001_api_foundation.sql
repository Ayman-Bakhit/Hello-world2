-- 001_api_foundation: additive changes for the Slice 1 API.
-- Non-destructive: adds columns/tables/constraints, replaces one CHECK to allow status 'demo'.
-- No data is dropped. Fails loudly (does not rewrite data) if existing rows violate a new constraint.

-- Provenance: every record says whether it is demo, user-entered (database), or chain-indexed.
ALTER TABLE users    ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE wallets  ADD COLUMN data_source text NOT NULL DEFAULT 'database' CHECK (data_source IN ('demo','database','chain'));
ALTER TABLE charities ADD COLUMN data_source text NOT NULL DEFAULT 'database' CHECK (data_source IN ('demo','database','chain'));
ALTER TABLE donations ADD COLUMN data_source text NOT NULL DEFAULT 'database' CHECK (data_source IN ('demo','database','chain'));

-- Donations: allow 'demo'; 'confirmed' requires a verifiable transaction; 'demo' must have none.
ALTER TABLE donations DROP CONSTRAINT donations_status_check;
ALTER TABLE donations ADD CONSTRAINT donations_status_check CHECK (status IN ('pending','demo','confirmed','failed'));
ALTER TABLE donations ADD CONSTRAINT donations_confirmed_requires_tx CHECK (status <> 'confirmed' OR raw_transaction_id IS NOT NULL);
ALTER TABLE donations ADD CONSTRAINT donations_demo_has_no_tx CHECK (status <> 'demo' OR raw_transaction_id IS NULL);

-- Tax reserve target: one per user, USDC only in V1, rule fields must be consistent. Never holds funds.
ALTER TABLE tax_reserves ADD COLUMN currency text NOT NULL DEFAULT 'USDC' CHECK (currency = 'USDC');
ALTER TABLE tax_reserves ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tax_reserves ADD CONSTRAINT tax_reserves_rule_fields CHECK (
  (rule = 'FIXED_PERCENT' AND percent_bps IS NOT NULL AND percent_bps > 0) OR
  (rule = 'MANUAL_TARGET' AND target_cents IS NOT NULL AND target_cents > 0)
);
CREATE UNIQUE INDEX tax_reserves_user_uidx ON tax_reserves (user_id);

-- Launch configurations (drafts + review). Deployment does not exist yet.
CREATE TABLE launch_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL REFERENCES users(id),
  creator_wallet_id uuid NOT NULL REFERENCES wallets(id),
  name text NOT NULL,
  symbol text NOT NULL,
  config jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review_passed','review_failed')),
  review jsonb,
  data_source text NOT NULL DEFAULT 'database' CHECK (data_source IN ('demo','database','chain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Defense in depth: the API validates with the shared fee-split code; the DB refuses anything but exactly 10000 bps.
  CONSTRAINT launch_fee_split_is_10000_bps CHECK (
    (config->'feeSplit'->>'creator')::int + (config->'feeSplit'->>'taxReserve')::int +
    (config->'feeSplit'->>'charity')::int + (config->'feeSplit'->>'protocol')::int = 10000
  )
);
CREATE INDEX launch_configurations_user_idx ON launch_configurations (creator_user_id, created_at DESC);

CREATE INDEX sessions_user_idx ON sessions (user_id);
