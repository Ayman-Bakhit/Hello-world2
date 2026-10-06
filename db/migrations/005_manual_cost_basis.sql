-- 005_manual_cost_basis: USER_PROVIDED cost basis with an immutable, hash-chained revision history. Additive.
-- Identity and every revision are append-only (triggers); "current" is a VIEW over the latest revision. There is no
-- hard delete: voiding is a new revision. Nothing here is blockchain data and nothing here is "verified".

CREATE TABLE manual_cost_basis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  asset text NOT NULL CHECK (asset = 'native' OR asset ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),   -- 'native' = SOL, else a mint
  decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 38),
  source text NOT NULL DEFAULT 'USER_PROVIDED' CHECK (source = 'USER_PROVIDED'),
  created_auth_method text NOT NULL CHECK (created_auth_method IN ('wallet_signature','dev_insecure')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX manual_cost_basis_user_idx ON manual_cost_basis (user_id);
CREATE INDEX manual_cost_basis_wallet_asset_idx ON manual_cost_basis (wallet_id, asset);
CREATE TRIGGER manual_cost_basis_immutable BEFORE UPDATE OR DELETE ON manual_cost_basis FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE manual_cost_basis_revisions (
  id bigserial PRIMARY KEY,
  basis_id uuid NOT NULL REFERENCES manual_cost_basis(id),
  revision integer NOT NULL CHECK (revision >= 1),
  action text NOT NULL CHECK (action IN ('create','revise','void')),
  status text NOT NULL CHECK (status IN ('active','voided')),
  quantity numeric(40,0) NOT NULL CHECK (quantity > 0),                 -- raw base units, exact
  acquired_at timestamptz NOT NULL CHECK (acquired_at >= TIMESTAMPTZ '2009-01-03 00:00:00+00'),
  cost_basis_cents numeric(40,0) NOT NULL CHECK (cost_basis_cents >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  reason text NOT NULL CHECK (reason IN ('EXCHANGE_PURCHASE','PRIOR_WALLET','GIFT_RECEIVED','INCOME_OR_REWARD','OTHER')),
  signature text CHECK (signature IS NULL OR signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,90}$'),
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  acknowledged_overlap boolean NOT NULL DEFAULT false,
  change_reason text CHECK (change_reason IS NULL OR length(change_reason) BETWEEN 3 AND 300),
  prev_hash text,                                                        -- row_hash of the previous revision (NULL for revision 1)
  row_hash text NOT NULL,                                                -- sha256 over this row's canonical fields + prev_hash (computed by the API)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (basis_id, revision),
  CHECK ((action = 'create' AND revision = 1 AND change_reason IS NULL AND prev_hash IS NULL)
      OR (action <> 'create' AND revision > 1 AND change_reason IS NOT NULL AND prev_hash IS NOT NULL)),
  CHECK ((action = 'void') = (status = 'voided'))
);
CREATE INDEX manual_cost_basis_revisions_basis_idx ON manual_cost_basis_revisions (basis_id, revision DESC);
CREATE TRIGGER manual_cost_basis_revisions_immutable BEFORE UPDATE OR DELETE ON manual_cost_basis_revisions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE VIEW manual_cost_basis_current AS
  SELECT b.id, b.user_id, b.wallet_id, b.asset, b.decimals, b.source, b.created_auth_method, b.created_at AS record_created_at,
         r.revision, r.action, r.status, r.quantity, r.acquired_at, r.cost_basis_cents, r.currency, r.reason, r.signature, r.notes,
         r.acknowledged_overlap, r.change_reason, r.row_hash, r.created_at AS revised_at
  FROM manual_cost_basis b
  JOIN LATERAL (SELECT * FROM manual_cost_basis_revisions WHERE basis_id = b.id ORDER BY revision DESC LIMIT 1) r ON true;
