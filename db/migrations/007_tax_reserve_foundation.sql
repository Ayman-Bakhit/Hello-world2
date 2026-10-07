-- 007_tax_reserve_foundation: reserve TARGET configuration provenance + an append-only history of target changes. Additive.
-- Nothing here holds, moves or records funds. Derived values (recommendation, coverage, remaining) are NEVER stored: they are
-- computed on demand from the current tax calculation and the stored target. Two kinds of data stay apart:
--   USER CONFIGURATION  tax_reserves, tax_reserve_target_events
--   DERIVED CALCULATION nothing is persisted

ALTER TABLE tax_reserves
  ADD COLUMN target_source text NOT NULL DEFAULT 'USER_SET' CHECK (target_source IN ('USER_SET','SYSTEM_RECOMMENDED')),
  ADD COLUMN enabled boolean NOT NULL DEFAULT true;

-- History of what the user configured and when (configuration only: no tax figures, no balances).
CREATE TABLE tax_reserve_target_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  rule text NOT NULL CHECK (rule IN ('FIXED_PERCENT','MANUAL_TARGET')),
  percent_bps integer CHECK (percent_bps BETWEEN 1 AND 10000),
  target_cents bigint CHECK (target_cents > 0),
  currency text NOT NULL DEFAULT 'USDC' CHECK (currency = 'USDC'),
  target_source text NOT NULL CHECK (target_source IN ('USER_SET','SYSTEM_RECOMMENDED')),
  enabled boolean NOT NULL,
  created_auth_method text NOT NULL CHECK (created_auth_method IN ('wallet_signature','dev_insecure','demo_seed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((rule = 'FIXED_PERCENT' AND percent_bps IS NOT NULL AND target_cents IS NULL) OR (rule = 'MANUAL_TARGET' AND target_cents IS NOT NULL AND percent_bps IS NULL))
);
CREATE INDEX tax_reserve_target_events_user_idx ON tax_reserve_target_events (user_id, id DESC);
CREATE TRIGGER tax_reserve_target_events_immutable BEFORE UPDATE OR DELETE ON tax_reserve_target_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- The baseline reserve ledger table is a placeholder for FUTURE funding. Until a verifiable funding flow exists, no row may be
-- written: a fabricated deposit would otherwise be able to look like a real reserve balance. Remove this trigger only together
-- with a reviewed funding/reconciliation design.
CREATE FUNCTION tax_reserve_ledger_not_enabled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'reserve funding is not enabled: tax_reserve_transactions cannot be written in this release';
END $$;
CREATE TRIGGER tax_reserve_transactions_not_enabled BEFORE INSERT OR UPDATE OR DELETE ON tax_reserve_transactions FOR EACH ROW EXECUTE FUNCTION tax_reserve_ledger_not_enabled();
