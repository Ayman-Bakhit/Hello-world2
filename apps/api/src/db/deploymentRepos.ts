import type { DeploymentPlan } from "@project-name/shared";
import type { Pool } from "./pool";

/**
 * Deployment plan RECORDS. Append-only (database trigger). Recording a plan executes nothing, signs nothing and moves nothing.
 * No unsigned transaction bytes and no key material are ever stored.
 */
export async function recordDeploymentPlan(pool: Pool, a: { launchId: string; userId: string; plan: DeploymentPlan }): Promise<{ created: boolean }> {
  const p = a.plan;
  const r = await pool.query(
    `INSERT INTO deployment_plans (launch_id, plan_version, builder_version, config_fingerprint, plan_hash, status, plan, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (launch_id, plan_hash) DO NOTHING RETURNING id`,
    [a.launchId, p.identity.planVersion, p.identity.builderVersion, p.identity.configFingerprint, p.identity.planHash, p.status, JSON.stringify(p), a.userId],
  );
  return { created: r.rowCount === 1 };
}

export async function planState(pool: Pool, launchId: string, planHash: string): Promise<{ recorded: boolean; supersededPlans: number }> {
  const r = await pool.query("SELECT count(*) FILTER (WHERE plan_hash = $2)::int AS same, count(*) FILTER (WHERE plan_hash <> $2)::int AS other FROM deployment_plans WHERE launch_id = $1", [launchId, planHash]);
  return { recorded: r.rows[0].same > 0, supersededPlans: r.rows[0].other as number };
}
