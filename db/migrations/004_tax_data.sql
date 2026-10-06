-- 004_tax_data: tax data foundation. Additive. Tax events and lots are DERIVED on demand from transactions,
-- transaction_asset_deltas and price_observations; nothing derived is stored here. This migration only hardens
-- the price source those calculations read.

-- Provenance of a price. Default 'spot' / 'observed' describe what Slice 5 already writes.
ALTER TABLE price_observations ADD COLUMN kind text NOT NULL DEFAULT 'spot' CHECK (kind IN ('spot','historical','fixture'));
ALTER TABLE price_observations ADD COLUMN confidence text NOT NULL DEFAULT 'observed' CHECK (confidence IN ('observed','fixture'));

-- A zero price is "no price", never a price. NOT VALID: enforced for new rows without failing on legacy rows.
ALTER TABLE price_observations ADD CONSTRAINT price_observations_positive CHECK (price_micro_usd > 0) NOT VALID;

-- Historical prices must not be rewritten in place (a changed price silently changes past tax figures).
-- Deleting a row only removes a price (results then say PRICE DATA UNAVAILABLE), so DELETE stays allowed.
CREATE TRIGGER price_observations_no_update BEFORE UPDATE ON price_observations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Tax reads: all of a wallet's chain transactions in time order.
CREATE INDEX IF NOT EXISTS transactions_wallet_occurred_idx ON transactions (wallet_id, occurred_at) WHERE data_source = 'chain';
