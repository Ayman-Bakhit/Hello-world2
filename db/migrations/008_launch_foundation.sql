-- 008_launch_foundation: launch CONFIGURATION lifecycle, fingerprint and revision history. Additive except the status vocabulary.
-- Nothing here deploys anything: there is no mint, liquidity, transaction or fee-routing column, and DEPLOYING / LIVE / FAILED are
-- not representable (constraint below). A future deployment slice must widen the constraint with its own reviewed migration.

-- statuses: draft / review_passed / review_failed become DRAFT / CONFIGURED / DRAFT. Old stored reviews lack the new fields: cleared.
ALTER TABLE launch_configurations DROP CONSTRAINT launch_configurations_status_check;
UPDATE launch_configurations SET status = CASE status WHEN 'review_passed' THEN 'CONFIGURED' ELSE 'DRAFT' END, review = NULL;
ALTER TABLE launch_configurations
  ALTER COLUMN status SET DEFAULT 'DRAFT',
  ADD COLUMN config_fingerprint text CHECK (config_fingerprint IS NULL OR config_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD COLUMN reviewed_fingerprint text CHECK (reviewed_fingerprint IS NULL OR reviewed_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  ADD COLUMN public_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN ready_at timestamptz,
  ADD CONSTRAINT launch_status_reachable CHECK (status IN ('DRAFT','CONFIGURED','REVIEW','READY','CANCELLED')),
  -- READY needs a reviewed fingerprint equal to the current one: the reviewed configuration IS the configuration.
  ADD CONSTRAINT launch_ready_matches_review CHECK (status <> 'READY' OR (config_fingerprint IS NOT NULL AND reviewed_fingerprint IS NOT NULL AND reviewed_fingerprint = config_fingerprint AND ready_at IS NOT NULL)),
  ADD CONSTRAINT launch_review_has_fingerprint CHECK (status <> 'REVIEW' OR (config_fingerprint IS NOT NULL AND reviewed_fingerprint IS NOT NULL AND reviewed_fingerprint = config_fingerprint)),
  -- only a READY configuration can be public, and only when its creator published it
  ADD CONSTRAINT launch_public_only_when_ready CHECK (NOT public_visible OR status = 'READY');

-- new rows must carry the canonical 60/15/15/10 split and a supported network (older rows are not rewritten)
ALTER TABLE launch_configurations
  ADD CONSTRAINT launch_fee_split_canonical CHECK (
    (config->'feeSplit'->>'creator')::int = 6000 AND (config->'feeSplit'->>'taxReserve')::int = 1500 AND
    (config->'feeSplit'->>'charity')::int = 1500 AND (config->'feeSplit'->>'protocol')::int = 1000
  ) NOT VALID,
  ADD CONSTRAINT launch_network_supported CHECK (config->>'network' IN ('devnet','mainnet-beta')) NOT VALID;

-- Configuration history: one row per action. Append-only (UPDATE/DELETE rejected) and hash-chained, so an edit made outside the API
-- is DETECTABLE. This is tamper-evident auditability for operators, not a cryptographic guarantee and not a blockchain proof.
CREATE TABLE launch_configuration_revisions (
  id bigserial PRIMARY KEY,
  launch_id uuid NOT NULL REFERENCES launch_configurations(id),
  seq integer NOT NULL CHECK (seq >= 1),
  action text NOT NULL CHECK (action IN ('create','update','configure','review','ready','cancel')),
  status_after text NOT NULL CHECK (status_after IN ('DRAFT','CONFIGURED','REVIEW','READY','CANCELLED')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  config jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_auth_method text NOT NULL CHECK (created_auth_method IN ('wallet_signature','dev_insecure')),
  reason text CHECK (reason IS NULL OR length(reason) <= 200),
  prev_hash text,
  row_hash text NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (launch_id, seq),
  CHECK ((seq = 1) = (prev_hash IS NULL)),
  CHECK ((seq = 1) = (action = 'create'))
);
CREATE TRIGGER launch_revisions_immutable BEFORE UPDATE OR DELETE ON launch_configuration_revisions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
