import {
  ATTEMPT_STATES, ATTEMPT_TRANSITIONS, ExecutionDisabledError, assertExecutionDisabled, attemptEventHash, attemptStateRecordable, canTransition, validateMintPublicKey,
  type AttemptState, type DeploymentPlan, type FailureCategory,
} from "@project-name/shared";
import type { Pool } from "./pool";

/**
 * Deployment ATTEMPTS. Reads are used by the API. The two writers exist for a future privileged execution slice and for tests; no route
 * imports them (a test asserts that). While real execution is disabled they can record only PLAN_BUILT, FAILED and CANCELLED: anything
 * implying a signature, a send or a confirmation throws, and the database refuses it as well. No signature, key or confirmation is ever stored.
 */
export interface AttemptView {
  id: string; attemptNumber: number; configFingerprint: string; planHash: string; policyHash: string; environment: string; mintPublicKey: string | null;
  status: AttemptState; failureCategory: FailureCategory | null; createdAt: string; historyIntact: boolean; events: number;
}

export async function listAttempts(pool: Pool, launchId: string): Promise<AttemptView[]> {
  const a = (await pool.query("SELECT * FROM deployment_attempts WHERE launch_id = $1 ORDER BY attempt_number", [launchId])).rows as Array<Record<string, unknown>>;
  const out: AttemptView[] = [];
  for (const r of a) {
    const ev = (await pool.query("SELECT seq, status, failure_category, note, prev_hash, row_hash FROM deployment_attempt_events WHERE attempt_id = $1 ORDER BY seq", [r.id])).rows as Array<Record<string, unknown>>;
    let intact = ev.length > 0, prev: string | null = null;
    ev.forEach((e, i) => {
      if (Number(e.seq) !== i + 1 || (e.prev_hash ?? null) !== prev || attemptEventHash({ attemptId: r.id as string, seq: i + 1, status: e.status as AttemptState, failureCategory: (e.failure_category as FailureCategory | null) ?? null, note: (e.note as string | null) ?? null, prevHash: prev }) !== e.row_hash) intact = false;
      prev = e.row_hash as string;
    });
    const last = ev[ev.length - 1];
    out.push({
      id: r.id as string, attemptNumber: Number(r.attempt_number), configFingerprint: r.config_fingerprint as string, planHash: r.plan_hash as string, policyHash: r.policy_hash as string, environment: r.environment as string,
      mintPublicKey: (r.mint_public_key as string | null) ?? null, status: (last?.status as AttemptState) ?? "PLAN_BUILT", failureCategory: ((last?.failure_category as FailureCategory | null) ?? null), createdAt: (r.created_at as Date).toISOString(),
      historyIntact: intact, events: ev.length,
    });
  }
  return out;
}

/** PRIVILEGED, not reachable from any route. Starts an attempt at PLAN_BUILT from a built plan. Stores the mint PUBLIC key only. */
export async function createAttempt(pool: Pool, a: { launchId: string; userId: string; plan: DeploymentPlan; mintPublicKey?: unknown }): Promise<string> {
  let mint: string | null = null;
  if (a.mintPublicKey !== undefined && a.mintPublicKey !== null) {
    const reserved = a.plan.destinations.flatMap((d) => (d.address ? [d.address] : []));
    const k = validateMintPublicKey(a.mintPublicKey, reserved);
    if (!k.ok) throw new Error(`mint public key refused: ${k.code}`); // the value itself is never included in the message
    mint = k.address;
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM launch_configurations WHERE id = $1 FOR UPDATE", [a.launchId]);
    const n = Number((await c.query("SELECT coalesce(max(attempt_number), 0) + 1 AS n FROM deployment_attempts WHERE launch_id = $1", [a.launchId])).rows[0].n);
    const r = await c.query(
      `INSERT INTO deployment_attempts (launch_id, attempt_number, config_fingerprint, plan_hash, policy_hash, environment, mint_public_key, expected_state, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [a.launchId, n, a.plan.identity.configFingerprint, a.plan.identity.planHash, a.plan.identity.policyHash, a.plan.environment.cluster, mint, JSON.stringify(a.plan.expectedState), a.userId],
    );
    const id = r.rows[0].id as string;
    const hash = attemptEventHash({ attemptId: id, seq: 1, status: "PLAN_BUILT", failureCategory: null, note: null, prevHash: null });
    await c.query("INSERT INTO deployment_attempt_events (attempt_id, seq, status, failure_category, note, prev_hash, row_hash) VALUES ($1,1,'PLAN_BUILT',NULL,NULL,NULL,$2)", [id, hash]);
    await c.query("COMMIT");
    return id;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

/** PRIVILEGED, not reachable from any route. Appends a state. Anything that implies execution is refused while execution is disabled. */
export async function appendAttemptEvent(pool: Pool, attemptId: string, to: AttemptState, o: { failureCategory?: FailureCategory; note?: string } = {}): Promise<void> {
  if (!(ATTEMPT_STATES as readonly string[]).includes(to)) throw new Error("unknown attempt state");
  if (!attemptStateRecordable(to)) assertExecutionDisabled(`record attempt state ${to}`);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM deployment_attempts WHERE id = $1 FOR UPDATE", [attemptId]);
    const last = (await c.query("SELECT seq, status, row_hash FROM deployment_attempt_events WHERE attempt_id = $1 ORDER BY seq DESC LIMIT 1", [attemptId])).rows[0] as { seq: number; status: AttemptState; row_hash: string } | undefined;
    if (!last) throw new Error("attempt has no history");
    if (!canTransition(last.status, to)) throw new Error(`invalid attempt transition ${last.status} -> ${to}`);
    void ATTEMPT_TRANSITIONS;
    const seq = last.seq + 1, fc = o.failureCategory ?? (to === "CANCELLED" ? "CANCELLED_BY_USER" : null), note = o.note ?? null;
    const hash = attemptEventHash({ attemptId, seq, status: to, failureCategory: fc, note, prevHash: last.row_hash });
    await c.query("INSERT INTO deployment_attempt_events (attempt_id, seq, status, failure_category, note, prev_hash, row_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)", [attemptId, seq, to, fc, note, last.row_hash, hash]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
export { ExecutionDisabledError };
