-- 010_deployment_plans: append-only RECORDS of deployment plans (Slice 13). Additive.
-- A plan is a description of what a user's wallet WOULD be asked to sign. Recording one executes nothing: there is no mint, no
-- signature, no transaction and no key material here (no unsigned transaction bytes are stored either; they would need a mint
-- public key and blockhash that do not exist yet). A plan is never edited: a changed launch produces a new row with a new hash,
-- and rows for older hashes stay as history, no longer current.
CREATE TABLE deployment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES launch_configurations(id),
  plan_version integer NOT NULL CHECK (plan_version >= 1),
  builder_version text NOT NULL,
  config_fingerprint text NOT NULL CHECK (config_fingerprint ~ '^[0-9a-f]{64}$'),
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('BLOCKED','READY_FOR_REVIEW')),
  plan jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (launch_id, plan_hash),
  CHECK (plan->>'executionEnabled' = 'false'),
  CHECK (plan->'identity'->>'planHash' = plan_hash),
  CHECK (plan->'identity'->>'configFingerprint' = config_fingerprint),
  CHECK (plan->'mint'->>'address' IS NULL),
  CHECK (plan->'signingBoundary'->>'serverSigns' = 'false')
);
CREATE TRIGGER deployment_plans_immutable BEFORE UPDATE OR DELETE ON deployment_plans FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A plan may only be recorded against a READY launch whose CURRENT fingerprint it was built from.
CREATE FUNCTION deployment_plans_check_launch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l launch_configurations%ROWTYPE;
BEGIN
  SELECT * INTO l FROM launch_configurations WHERE id = NEW.launch_id;
  IF l.status IS DISTINCT FROM 'READY' THEN RAISE EXCEPTION 'a deployment plan requires a READY launch'; END IF;
  IF l.config_fingerprint IS DISTINCT FROM NEW.config_fingerprint THEN RAISE EXCEPTION 'the plan was not built from the launch''s current configuration fingerprint'; END IF;
  IF l.creator_user_id IS DISTINCT FROM NEW.created_by THEN RAISE EXCEPTION 'only the launch owner can record its plan'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deployment_plans_launch_check BEFORE INSERT ON deployment_plans FOR EACH ROW EXECUTE FUNCTION deployment_plans_check_launch();
