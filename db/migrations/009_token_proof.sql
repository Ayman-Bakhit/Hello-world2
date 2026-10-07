-- 009_token_proof: token proof records and chain observations. Additive. Preserves Slice 11.
-- NOTHING in the application writes these tables in production: there is no deployment, no observer and no endpoint that can create a
-- proof or an observation. They exist so a future privileged observer has an append-only, tamper-evident place to record what a chain
-- read said. A row here is a RECORD, never verification: the verification status is derived at read time by the shared evaluator.

CREATE TABLE token_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL UNIQUE REFERENCES launch_configurations(id),
  network text NOT NULL CHECK (network IN ('devnet','mainnet-beta')),
  mint_address text NOT NULL CHECK (mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  deployment_signature text CHECK (deployment_signature IS NULL OR deployment_signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,90}$'),
  deployed_fingerprint text CHECK (deployed_fingerprint IS NULL OR deployed_fingerprint ~ '^[0-9a-f]{64}$'),
  data_source text NOT NULL CHECK (data_source IN ('demo','chain')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- A proof record is never edited or removed. (Append-only and tamper-evident; not "immutable" against a database superuser.)
CREATE TRIGGER token_proofs_immutable BEFORE UPDATE OR DELETE ON token_proofs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A proof may only attach to a READY configuration, on the network that configuration chose.
CREATE FUNCTION token_proofs_check_launch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l launch_configurations%ROWTYPE;
BEGIN
  SELECT * INTO l FROM launch_configurations WHERE id = NEW.launch_id;
  IF l.status IS DISTINCT FROM 'READY' THEN RAISE EXCEPTION 'a token proof requires a READY launch configuration'; END IF;
  IF (l.config->>'network') IS DISTINCT FROM NEW.network THEN RAISE EXCEPTION 'proof network must equal the launch configuration network'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER token_proofs_launch_check BEFORE INSERT ON token_proofs FOR EACH ROW EXECUTE FUNCTION token_proofs_check_launch();

CREATE TABLE token_proof_observations (
  id bigserial PRIMARY KEY,
  proof_id uuid NOT NULL REFERENCES token_proofs(id),
  seq integer NOT NULL CHECK (seq >= 1),
  source text NOT NULL CHECK (source IN ('FIXTURE','RPC')),
  -- the observation's own timestamp (what the observer says it read), never "now", and never later than the row's creation
  observed_at timestamptz NOT NULL,
  observation jsonb NOT NULL,
  prev_hash text,
  row_hash text NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proof_id, seq),
  CHECK ((seq = 1) = (prev_hash IS NULL)),
  CHECK (observed_at <= created_at + interval '5 minutes'),
  CHECK (observation->>'source' = source)
);
CREATE TRIGGER token_proof_observations_immutable BEFORE UPDATE OR DELETE ON token_proof_observations FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A FIXTURE observation can only attach to a demo proof, and a demo proof only takes FIXTURE observations: fixture data can never
-- flow into a production proof.
CREATE FUNCTION token_proof_observations_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p token_proofs%ROWTYPE;
BEGIN
  SELECT * INTO p FROM token_proofs WHERE id = NEW.proof_id;
  IF (NEW.source = 'FIXTURE') IS DISTINCT FROM (p.data_source = 'demo') THEN RAISE EXCEPTION 'FIXTURE observations belong to demo proofs only'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER token_proof_observations_source_check BEFORE INSERT ON token_proof_observations FOR EACH ROW EXECUTE FUNCTION token_proof_observations_check();
