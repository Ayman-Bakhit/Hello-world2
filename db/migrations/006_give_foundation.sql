-- 006_give_foundation: charity registry vs verification evidence vs donation record vs receipt. Additive except where noted.
-- NO money movement exists in this slice: nothing here can create a transfer, and a donation can only be 'confirmed'
-- with a recorded on-chain transaction from the indexer (chain data). Fixture (data_source 'demo') rows can never look
-- confirmed or verified-by-a-real-source.

-- ---------- charity registry ----------
ALTER TABLE charities
  ADD COLUMN slug text,
  ADD COLUMN logo_url text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN verification_state text,
  ADD COLUMN verification_source text,        -- source_type of the evidence the state rests on
  ADD COLUMN verification_checked_at timestamptz,
  ADD COLUMN verification_notes text;         -- ADMIN ONLY: never returned by a public or user endpoint

UPDATE charities SET verification_state = CASE verification_status::text
  WHEN 'verified' THEN 'VERIFIED' WHEN 'pending' THEN 'PENDING_REVIEW' WHEN 'rejected' THEN 'UNVERIFIED' WHEN 'revoked' THEN 'SUSPENDED' END;
UPDATE charities SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'));
-- fixture rows that were 'verified' by the old model rest on a FIXTURE evidence row (inserted below), never on a real source
UPDATE charities SET verification_source = CASE WHEN verification_state = 'VERIFIED' THEN 'FIXTURE' END,
                     verification_checked_at = CASE WHEN verification_state = 'VERIFIED' THEN COALESCE(verified_at, now()) END;

ALTER TABLE charities
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN verification_state SET NOT NULL,
  ALTER COLUMN verification_state SET DEFAULT 'UNVERIFIED',
  ADD CONSTRAINT charities_state_check CHECK (verification_state IN ('UNVERIFIED','PENDING_REVIEW','VERIFIED','SUSPENDED')),
  ADD CONSTRAINT charities_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
  ADD CONSTRAINT charities_source_check CHECK (verification_source IS NULL OR verification_source IN ('REGISTRY_LOOKUP','OFFICIAL_DOCUMENT','ADMIN_REVIEW','FIXTURE')),
  ADD CONSTRAINT charities_verified_has_provenance CHECK (verification_state <> 'VERIFIED' OR (verification_source IS NOT NULL AND verification_checked_at IS NOT NULL)),
  ADD CONSTRAINT charities_fixture_source_only_for_demo CHECK ((verification_source = 'FIXTURE') = (verification_source IS NOT NULL AND data_source = 'demo')),
  ADD CONSTRAINT charities_urls_check CHECK ((website IS NULL OR (website ~ '^https?://[^[:space:]]+$' AND website !~ '^https?://[^/?#]*@' AND length(website) <= 500))
                                            AND (logo_url IS NULL OR (logo_url ~ '^https://[^[:space:]]+$' AND logo_url !~ '^https://[^/?#]*@' AND length(logo_url) <= 500))),
  ADD CONSTRAINT charities_notes_len CHECK (verification_notes IS NULL OR length(verification_notes) <= 2000);
CREATE UNIQUE INDEX charities_slug_idx ON charities (slug);

-- the single source of truth is now verification_state; the old enum column and the admin pointer columns are replaced by evidence rows
ALTER TABLE charities DROP COLUMN verification_status, DROP COLUMN verified_by, DROP COLUMN verified_at;

-- ---------- verification evidence (append-only) ----------
CREATE TABLE charity_verification_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charity_id uuid NOT NULL REFERENCES charities(id),
  source_type text NOT NULL CHECK (source_type IN ('REGISTRY_LOOKUP','OFFICIAL_DOCUMENT','WEBSITE_CLAIM','ADMIN_REVIEW','FIXTURE')),
  source_ref text NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 500),   -- registry id, document reference, or URL
  source_url text CHECK (source_url IS NULL OR (source_url ~ '^https?://[^[:space:]]+$' AND source_url !~ '^https?://[^/?#]*@' AND length(source_url) <= 500)),
  status text NOT NULL CHECK (status IN ('SUPPORTS','DOES_NOT_SUPPORT','INCONCLUSIVE')),
  checked_at timestamptz NOT NULL,
  verifier_user_id uuid REFERENCES users(id),                              -- admin identity; never exposed to ordinary users
  public_summary text NOT NULL CHECK (length(public_summary) BETWEEN 1 AND 500),
  internal_notes text CHECK (internal_notes IS NULL OR length(internal_notes) <= 2000),   -- ADMIN ONLY
  data_source text NOT NULL DEFAULT 'database' CHECK (data_source IN ('demo','database','chain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_fixture_iff_demo CHECK ((source_type = 'FIXTURE') = (data_source = 'demo'))
);
CREATE INDEX charity_evidence_charity_idx ON charity_verification_evidence (charity_id, checked_at DESC);
CREATE TRIGGER charity_evidence_immutable BEFORE UPDATE OR DELETE ON charity_verification_evidence FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- fixture evidence must belong to a demo charity, and a demo charity can only have fixture evidence
CREATE FUNCTION evidence_matches_charity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ds text;
BEGIN
  SELECT data_source INTO ds FROM charities WHERE id = NEW.charity_id;
  IF ds IS DISTINCT FROM NEW.data_source THEN RAISE EXCEPTION 'evidence data_source must match the charity data_source'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER charity_evidence_matches BEFORE INSERT ON charity_verification_evidence FOR EACH ROW EXECUTE FUNCTION evidence_matches_charity();

-- VERIFIED requires at least one SUPPORTING evidence row from a source that can support it. A WEBSITE_CLAIM never can.
-- Deferred so a charity and its evidence can be inserted in one transaction.
CREATE FUNCTION charity_verified_needs_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.verification_state = 'VERIFIED' AND NOT EXISTS (
    SELECT 1 FROM charity_verification_evidence e
    WHERE e.charity_id = NEW.id AND e.status = 'SUPPORTS' AND e.source_type IN ('REGISTRY_LOOKUP','OFFICIAL_DOCUMENT','ADMIN_REVIEW','FIXTURE')
  ) THEN RAISE EXCEPTION 'a VERIFIED charity requires supporting evidence from a registry, an official document, an admin review or a labeled fixture'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER charity_verified_evidence AFTER INSERT OR UPDATE OF verification_state ON charities
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION charity_verified_needs_evidence();

-- legacy rows that were 'verified' get one explicit, labeled FIXTURE evidence row so the state is never provenance-free
INSERT INTO charity_verification_evidence (charity_id, source_type, source_ref, status, checked_at, public_summary, data_source)
SELECT id, 'FIXTURE', 'demo-fixture', 'SUPPORTS', COALESCE(verification_checked_at, now()),
       'Fixture record for development. This is not a real-world verification.', 'demo'
FROM charities WHERE verification_state = 'VERIFIED' AND data_source = 'demo';

-- ---------- donation records ----------
ALTER TABLE donations
  ALTER COLUMN usd_value_cents DROP NOT NULL,                       -- a reference value is optional
  ADD COLUMN donated_at timestamptz,                                -- set only when the on-chain transaction is known
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN usd_reference_source text CHECK (usd_reference_source IS NULL OR usd_reference_source IN ('FIXTURE','USER_ENTERED_USDC_PAR','PRICE_OBSERVATION')),
  ADD COLUMN provenance text NOT NULL DEFAULT 'USER_PLAN' CHECK (provenance IN ('DEMO_FIXTURE','USER_PLAN','CHAIN_INDEXED'));

UPDATE donations SET provenance = 'DEMO_FIXTURE', usd_reference_source = 'FIXTURE' WHERE data_source = 'demo';

ALTER TABLE donations DROP CONSTRAINT donations_status_check;
ALTER TABLE donations
  ADD CONSTRAINT donations_status_check CHECK (status IN ('draft','pending','confirmed','failed','cancelled','demo')),
  ADD CONSTRAINT donations_confirmed_is_chain CHECK (status <> 'confirmed' OR (data_source = 'chain' AND provenance = 'CHAIN_INDEXED' AND donated_at IS NOT NULL)),
  ADD CONSTRAINT donations_demo_is_fixture CHECK ((status = 'demo') = (data_source = 'demo') AND (data_source = 'demo') = (provenance = 'DEMO_FIXTURE')),
  ADD CONSTRAINT donations_chain_provenance_needs_tx CHECK (provenance <> 'CHAIN_INDEXED' OR raw_transaction_id IS NOT NULL),
  ADD CONSTRAINT donations_usd_nonneg CHECK (usd_value_cents IS NULL OR usd_value_cents >= 0),
  ADD CONSTRAINT donations_usd_has_source CHECK (usd_value_cents IS NULL OR usd_reference_source IS NOT NULL);

-- a confirming transaction must be a real indexed transaction that belongs to the donor's own wallet
CREATE FUNCTION donation_tx_belongs_to_wallet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.raw_transaction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM transactions t WHERE t.raw_transaction_id = NEW.raw_transaction_id AND t.wallet_id = NEW.source_wallet_id AND t.data_source = 'chain'
  ) THEN RAISE EXCEPTION 'donation transaction must be an indexed chain transaction of the donor wallet'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER donations_tx_wallet BEFORE INSERT OR UPDATE OF raw_transaction_id, source_wallet_id ON donations FOR EACH ROW EXECUTE FUNCTION donation_tx_belongs_to_wallet();

-- ---------- receipts ----------
ALTER TABLE donation_receipts
  ADD COLUMN charity_receipt_reference text CHECK (charity_receipt_reference IS NULL OR length(charity_receipt_reference) BETWEEN 1 AND 200),
  ADD COLUMN document_url text CHECK (document_url IS NULL OR (document_url ~ '^https://[^[:space:]]+$' AND document_url !~ '^https://[^/?#]*@' AND length(document_url) <= 500)),
  ADD COLUMN receipt_hash text CHECK (receipt_hash IS NULL OR receipt_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN verification_state text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_state IN ('UNVERIFIED','CHARITY_REPORTED','VERIFIED')),
  ADD COLUMN provenance_note text CHECK (provenance_note IS NULL OR length(provenance_note) <= 500),
  ADD COLUMN data_source text NOT NULL DEFAULT 'database' CHECK (data_source IN ('demo','database','chain')),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT receipts_demo_never_verified CHECK (data_source <> 'demo' OR verification_state = 'UNVERIFIED');

-- a receipt follows its donation: same data source, and a real receipt needs a confirmed donation
CREATE FUNCTION receipt_matches_donation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record;
BEGIN
  SELECT status, data_source INTO d FROM donations WHERE id = NEW.donation_id;
  IF d.data_source IS DISTINCT FROM NEW.data_source THEN RAISE EXCEPTION 'receipt data_source must match its donation'; END IF;
  IF NEW.data_source <> 'demo' AND d.status <> 'confirmed' THEN RAISE EXCEPTION 'a non-fixture receipt requires a confirmed donation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER receipts_match_donation BEFORE INSERT OR UPDATE OF donation_id, data_source ON donation_receipts FOR EACH ROW EXECUTE FUNCTION receipt_matches_donation();
