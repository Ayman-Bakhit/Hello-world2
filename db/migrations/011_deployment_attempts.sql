-- 011_deployment_attempts: the foundation for auditable deployment ATTEMPTS (Slice 14). Additive.
-- A deployment attempt is NOT the launch configuration state: a creator can have a READY launch with no attempt, and a failed attempt
-- never rewrites the launch. NOTHING in the application creates these rows in production: real execution is disabled, no route writes
-- them, and the database itself refuses any state that implies a signature, a send or a confirmation (the status vocabulary is
-- restricted below, and no signature can be stored). A future slice that enables execution must widen these constraints in its own
-- reviewed migration. No private key, secret key or seed phrase can be stored: there is no such column.

CREATE TABLE deployment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES launch_configurations(id),
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  config_fingerprint text NOT NULL CHECK (config_fingerprint ~ '^[0-9a-f]{64}$'),
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  policy_hash text NOT NULL CHECK (policy_hash ~ '^[0-9a-f]{64}$'),
  environment text NOT NULL CHECK (environment IN ('devnet','mainnet-beta')),
  -- the client-reported mint PUBLIC key. 32 bytes of base58 at most 44 characters: a 64-byte secret key cannot fit this shape.
  mint_public_key text CHECK (mint_public_key IS NULL OR mint_public_key ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  expected_state jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (launch_id, attempt_number),
  CHECK (expected_state->>'provenance' = 'EXPECTED_NOT_OBSERVED'),
  CHECK (expected_state->>'planHash' = plan_hash),
  CHECK (expected_state->>'configFingerprint' = config_fingerprint),
  CHECK (expected_state->>'cluster' = environment)
);
CREATE TRIGGER deployment_attempts_immutable BEFORE UPDATE OR DELETE ON deployment_attempts FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION deployment_attempts_check_launch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l launch_configurations%ROWTYPE;
BEGIN
  SELECT * INTO l FROM launch_configurations WHERE id = NEW.launch_id;
  IF l.status IS DISTINCT FROM 'READY' THEN RAISE EXCEPTION 'a deployment attempt requires a READY launch'; END IF;
  IF l.config_fingerprint IS DISTINCT FROM NEW.config_fingerprint THEN RAISE EXCEPTION 'the attempt was not built from the launch''s current configuration fingerprint'; END IF;
  IF l.creator_user_id IS DISTINCT FROM NEW.created_by THEN RAISE EXCEPTION 'only the launch owner can start an attempt'; END IF;
  IF (l.config->>'network') IS DISTINCT FROM NEW.environment THEN RAISE EXCEPTION 'the attempt environment must equal the launch network'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deployment_attempts_launch_check BEFORE INSERT ON deployment_attempts FOR EACH ROW EXECUTE FUNCTION deployment_attempts_check_launch();

-- Append-only, hash-chained status history of an attempt. Tamper-evident auditability, not a blockchain proof.
CREATE TABLE deployment_attempt_events (
  id bigserial PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES deployment_attempts(id),
  seq integer NOT NULL CHECK (seq >= 1),
  -- ONLY states that involve no signature, send or confirmation can be stored. AWAITING_SIGNATURE through VERIFIED are not representable yet.
  status text NOT NULL CHECK (status IN ('PLAN_BUILT','FAILED','CANCELLED')),
  failure_category text CHECK (failure_category IS NULL OR failure_category IN ('BUILD_ERROR','READINESS_BLOCKED','SIGNING_ERROR','SUBMISSION_ERROR','CONFIRMATION_ERROR','RECONCILIATION_ERROR','CANCELLED_BY_USER')),
  note text CHECK (note IS NULL OR length(note) <= 300),
  -- always empty in this version: a signature cannot be recorded because nothing can be signed
  signatures text[] NOT NULL DEFAULT '{}' CHECK (cardinality(signatures) = 0),
  prev_hash text,
  row_hash text NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, seq),
  CHECK ((seq = 1) = (prev_hash IS NULL)),
  CHECK (status <> 'FAILED' OR failure_category IS NOT NULL),
  CHECK (status = 'FAILED' OR status = 'CANCELLED' OR failure_category IS NULL)
);
CREATE TRIGGER deployment_attempt_events_immutable BEFORE UPDATE OR DELETE ON deployment_attempt_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- seq 1 must be PLAN_BUILT; afterwards only one terminal event (FAILED or CANCELLED) can follow PLAN_BUILT
CREATE FUNCTION deployment_attempt_events_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev text;
BEGIN
  IF NEW.seq = 1 THEN
    IF NEW.status <> 'PLAN_BUILT' THEN RAISE EXCEPTION 'an attempt starts at PLAN_BUILT'; END IF;
  ELSE
    SELECT status INTO prev FROM deployment_attempt_events WHERE attempt_id = NEW.attempt_id AND seq = NEW.seq - 1;
    IF prev IS DISTINCT FROM 'PLAN_BUILT' OR NEW.status NOT IN ('FAILED','CANCELLED') THEN RAISE EXCEPTION 'invalid attempt transition'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deployment_attempt_events_transition BEFORE INSERT ON deployment_attempt_events FOR EACH ROW EXECUTE FUNCTION deployment_attempt_events_check();
