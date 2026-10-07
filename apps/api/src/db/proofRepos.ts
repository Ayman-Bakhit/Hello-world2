import { ChainObservationSchema, observationRowHash, type ChainObservation, type DeploymentRecord, type ObservationSource } from "@project-name/shared";
import type { Pool } from "./pool";

/**
 * Token proof storage. READ paths are used by the API; the two WRITE functions (`recordProofRecord`, `appendObservation`) exist for a
 * future privileged observer and for tests. No route imports them (a test asserts that), and no request body can reach them.
 * Observations are append-only (database trigger) and hash-chained: tamper-evident auditability, not a blockchain proof.
 */
export interface ProofState {
  deployment: DeploymentRecord | null;
  dataSource: "demo" | "chain" | null;
  observation: ChainObservation | null;
  observationCount: number;
  historyIntact: boolean;
}

const none: ProofState = { deployment: null, dataSource: null, observation: null, observationCount: 0, historyIntact: true };

/** Loads the proof record and re-verifies the whole observation chain. A broken chain returns historyIntact=false and NO observation. */
export async function getProofState(pool: Pool, launchId: string): Promise<ProofState> {
  const p = await pool.query("SELECT * FROM token_proofs WHERE launch_id = $1", [launchId]);
  if (!p.rows[0]) return none;
  const pr = p.rows[0] as Record<string, unknown>;
  const deployment: DeploymentRecord = {
    network: pr.network as string, mintAddress: pr.mint_address as string, deploymentSignature: (pr.deployment_signature as string | null) ?? null,
    deployedFingerprint: (pr.deployed_fingerprint as string | null) ?? null,
  };
  const dataSource = pr.data_source as "demo" | "chain";
  const rows = (await pool.query("SELECT seq, source, observed_at, observation, prev_hash, row_hash FROM token_proof_observations WHERE proof_id = $1 ORDER BY seq", [pr.id])).rows as Array<Record<string, unknown>>;
  let intact = true;
  let prev: string | null = null;
  let last: ChainObservation | null = null;
  rows.forEach((r, i) => {
    const parsed = ChainObservationSchema.safeParse(r.observation);
    if (!parsed.success || Number(r.seq) !== i + 1 || (r.prev_hash ?? null) !== prev || r.source !== parsed.data.source || new Date(r.observed_at as Date).toISOString() !== new Date(parsed.data.observedAt).toISOString()) {
      intact = false; return;
    }
    const expect = observationRowHash({ proofId: pr.id as string, seq: i + 1, source: r.source as ObservationSource, observedAt: parsed.data.observedAt, observation: parsed.data as ChainObservation, prevHash: prev });
    if (expect !== r.row_hash) intact = false;
    prev = r.row_hash as string;
    last = parsed.data as ChainObservation;
  });
  return { deployment, dataSource, observation: intact ? last : null, observationCount: rows.length, historyIntact: intact };
}

/** PRIVILEGED. Not reachable from any route. Records which mint a launch was deployed as. A record, not proof. */
export async function recordProofRecord(pool: Pool, a: {
  launchId: string; network: string; mintAddress: string; deploymentSignature: string | null; deployedFingerprint: string | null; dataSource: "demo" | "chain";
}): Promise<string> {
  const r = await pool.query(
    "INSERT INTO token_proofs (launch_id, network, mint_address, deployment_signature, deployed_fingerprint, data_source) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [a.launchId, a.network, a.mintAddress, a.deploymentSignature, a.deployedFingerprint, a.dataSource],
  );
  return r.rows[0].id as string;
}

/** PRIVILEGED. Not reachable from any route. Validates the observation against the strict schema, then appends it to the hash chain. */
export async function appendObservation(pool: Pool, proofId: string, input: unknown): Promise<number> {
  const observation = ChainObservationSchema.parse(input) as ChainObservation;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM token_proofs WHERE id = $1 FOR UPDATE", [proofId]);
    const last = (await c.query("SELECT seq, row_hash FROM token_proof_observations WHERE proof_id = $1 ORDER BY seq DESC LIMIT 1", [proofId])).rows[0] as { seq: number; row_hash: string } | undefined;
    const seq = last ? last.seq + 1 : 1;
    const prevHash = last ? last.row_hash : null;
    const rowHash = observationRowHash({ proofId, seq, source: observation.source, observedAt: observation.observedAt, observation, prevHash });
    await c.query(
      "INSERT INTO token_proof_observations (proof_id, seq, source, observed_at, observation, prev_hash, row_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [proofId, seq, observation.source, observation.observedAt, JSON.stringify(observation), prevHash, rowHash],
    );
    await c.query("COMMIT");
    return seq;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
