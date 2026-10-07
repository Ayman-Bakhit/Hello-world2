import {
  STATUS_MEANING, launchFingerprint, planLaunchAction, revisionRowHash, type Launch, type LaunchAction, type LaunchConfig, type LaunchReview,
} from "@project-name/shared";
import { LaunchConfigSchema as ConfigSchema } from "@project-name/shared";
import type { PoolClient } from "pg";
import type { Pool } from "./pool";

/**
 * Launch CONFIGURATIONS only. Every read filters by creator_user_id in SQL (that filter IS the authorization boundary: a foreign and
 * an unknown id are indistinguishable). Every change appends a hash-chained revision in the same transaction. Nothing here deploys
 * anything; the status vocabulary the database accepts stops at READY (+ CANCELLED).
 */
const iso = (d: Date) => d.toISOString();
type Row = Record<string, unknown>;

export function launchOf(r: Row): Launch {
  // the stored config is parsed again so a legacy row gets the same defaults (network, metadata fields) as a new one
  const config = ConfigSchema.parse(r.config);
  const status = r.status as Launch["status"];
  return {
    id: r.id as string,
    status,
    statusMeaning: STATUS_MEANING[status],
    config,
    review: (r.review as LaunchReview | null) ?? null,
    // derived from the stored configuration, never trusted from a column
    fingerprint: launchFingerprint(config),
    revision: Number(r.revision),
    publicVisible: r.public_visible as boolean,
    readyAt: r.ready_at ? iso(r.ready_at as Date) : null,
    deployment: { status: "not_deployed", mintAddress: null, transactionSignature: null, contractAddress: null },
    metadata: { source: "USER_PROVIDED", verifiedOnChain: false },
    createdAt: iso(r.created_at as Date),
    updatedAt: iso(r.updated_at as Date),
    dataSource: r.data_source as Launch["dataSource"],
  };
}

export async function countLaunches(pool: Pool, userId: string): Promise<number> {
  return Number((await pool.query("SELECT count(*) FROM launch_configurations WHERE creator_user_id = $1", [userId])).rows[0].count);
}

async function appendRevision(c: PoolClient, a: { launchId: string; seq: number; action: LaunchAction; statusAfter: string; fingerprint: string; config: LaunchConfig; userId: string; authMethod: string; reason: string | null; now: Date }) {
  const prev = a.seq === 1 ? null : ((await c.query("SELECT row_hash FROM launch_configuration_revisions WHERE launch_id = $1 AND seq = $2", [a.launchId, a.seq - 1])).rows[0]?.row_hash as string | undefined) ?? null;
  const rowHash = revisionRowHash({ launchId: a.launchId, seq: a.seq, action: a.action, statusAfter: a.statusAfter, fingerprint: a.fingerprint, createdBy: a.userId, reason: a.reason, prevHash: prev, createdAt: iso(a.now) });
  await c.query(
    `INSERT INTO launch_configuration_revisions (launch_id, seq, action, status_after, fingerprint, config, created_by, created_auth_method, reason, prev_hash, row_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [a.launchId, a.seq, a.action, a.statusAfter, a.fingerprint, JSON.stringify(a.config), a.userId, a.authMethod, a.reason, prev, rowHash, a.now],
  );
}

export async function createLaunch(pool: Pool, a: { userId: string; walletId: string; config: LaunchConfig; authMethod: string; now?: Date }): Promise<Launch> {
  const now = a.now ?? new Date();
  const fp = launchFingerprint(a.config);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query(
      "INSERT INTO launch_configurations (creator_user_id, creator_wallet_id, name, symbol, config, status, config_fingerprint, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7,$7) RETURNING *",
      [a.userId, a.walletId, a.config.name, a.config.symbol, JSON.stringify(a.config), fp, now],
    );
    await appendRevision(c, { launchId: r.rows[0].id, seq: 1, action: "create", statusAfter: "DRAFT", fingerprint: fp, config: a.config, userId: a.userId, authMethod: a.authMethod, reason: null, now });
    await c.query("COMMIT");
    return launchOf(r.rows[0]);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export async function listLaunches(pool: Pool, userId: string, limit: number, offset: number): Promise<{ launches: Launch[]; total: number }> {
  const total = await countLaunches(pool, userId);
  const r = await pool.query("SELECT * FROM launch_configurations WHERE creator_user_id = $1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3", [userId, limit, offset]);
  return { launches: r.rows.map(launchOf), total };
}

export async function getLaunch(pool: Pool, userId: string, id: string): Promise<Launch | null> {
  const r = await pool.query("SELECT * FROM launch_configurations WHERE id = $1 AND creator_user_id = $2", [id, userId]);
  return r.rows[0] ? launchOf(r.rows[0]) : null;
}

export type ActionResult = { ok: true; launch: Launch } | { ok: false; code: "NOT_FOUND" | "INVALID_TRANSITION" | "STALE"; from?: string };

/**
 * Applies one named action under a row lock. The server decides the next status from the transition table; the caller never supplies
 * one. `expectedFingerprint` guards against a concurrent edit between the caller's validation and this write.
 * `outcome` carries the pure review the route computed: configure/review/ready only advance when it passed.
 */
export async function applyLaunchAction(pool: Pool, a: {
  userId: string; id: string; action: Exclude<LaunchAction, "create">; authMethod: string; reason?: string | null; now?: Date;
  config?: LaunchConfig; review?: LaunchReview | null; expectedFingerprint?: string; publish?: boolean;
}): Promise<ActionResult> {
  const now = a.now ?? new Date();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const cur = (await c.query("SELECT * FROM launch_configurations WHERE id = $1 AND creator_user_id = $2 FOR UPDATE", [a.id, a.userId])).rows[0] as Row | undefined;
    if (!cur) { await c.query("ROLLBACK"); return { ok: false, code: "NOT_FOUND" }; }
    const from = cur.status as string;
    const currentConfig = ConfigSchema.parse(cur.config);
    const currentFp = launchFingerprint(currentConfig);
    if (a.expectedFingerprint !== undefined && a.expectedFingerprint !== currentFp) { await c.query("ROLLBACK"); return { ok: false, code: "STALE", from }; }

    const plan = planLaunchAction({
      current: { status: from, config: currentConfig, review: (cur.review as LaunchReview | null) ?? null, revision: Number(cur.revision) },
      action: a.action, now,
      ...(a.config ? { config: a.config } : {}), ...(a.review !== undefined ? { review: a.review } : {}), ...(a.publish !== undefined ? { publish: a.publish } : {}),
    });
    if (!plan) { await c.query("ROLLBACK"); return { ok: false, code: "INVALID_TRANSITION", from }; }
    const { config, status, fingerprint: fp, revision: seq } = plan;
    const r = await c.query(
      `UPDATE launch_configurations SET config = $3, name = $4, symbol = $5, status = $6, review = $7, config_fingerprint = $8, reviewed_fingerprint = $9,
         public_visible = $10, ready_at = $11, revision = $12, updated_at = $13 WHERE id = $1 AND creator_user_id = $2 RETURNING *`,
      [a.id, a.userId, JSON.stringify(config), config.name, config.symbol, status, plan.review === null ? null : JSON.stringify(plan.review), fp, plan.reviewedFingerprint, plan.publicVisible, plan.readyAt, seq, now],
    );
    await appendRevision(c, { launchId: a.id, seq, action: a.action, statusAfter: status, fingerprint: fp, config, userId: a.userId, authMethod: a.authMethod, reason: a.reason ?? null, now });
    await c.query("COMMIT");
    return { ok: true, launch: launchOf(r.rows[0]) };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export interface RevisionView { seq: number; action: LaunchAction; statusAfter: Launch["status"]; fingerprint: string; reason: string | null; createdAt: string; prevHash: string | null; rowHash: string }

/** History for the OWNER only. `intact` recomputes every row hash and chain link and checks the last fingerprint against the stored config. */
export async function getLaunchHistory(pool: Pool, userId: string, id: string): Promise<{ revisions: RevisionView[]; intact: boolean } | null> {
  const own = (await pool.query("SELECT config, revision FROM launch_configurations WHERE id = $1 AND creator_user_id = $2", [id, userId])).rows[0] as Row | undefined;
  if (!own) return null;
  const rows = (await pool.query("SELECT * FROM launch_configuration_revisions WHERE launch_id = $1 ORDER BY seq", [id])).rows as Row[];
  let intact = rows.length === Number(own.revision);
  let prev: string | null = null;
  const revisions: RevisionView[] = rows.map((r, i) => {
    const createdAt = iso(r.created_at as Date);
    const expect = revisionRowHash({ launchId: id, seq: Number(r.seq), action: r.action as LaunchAction, statusAfter: r.status_after as string, fingerprint: r.fingerprint as string, createdBy: r.created_by as string, reason: (r.reason as string | null) ?? null, prevHash: prev, createdAt });
    if (expect !== r.row_hash || (r.prev_hash as string | null) !== prev || Number(r.seq) !== i + 1) intact = false;
    prev = r.row_hash as string;
    return { seq: Number(r.seq), action: r.action as LaunchAction, statusAfter: r.status_after as Launch["status"], fingerprint: r.fingerprint as string, reason: (r.reason as string | null) ?? null, createdAt, prevHash: (r.prev_hash as string | null) ?? null, rowHash: r.row_hash as string };
  });
  if (rows.length > 0 && launchFingerprint(ConfigSchema.parse(own.config)) !== rows.at(-1)!.fingerprint) intact = false;
  return { revisions, intact };
}

/** Public: READY and published only. Returns the row's launch plus nothing about the owner except what the caller derives from config. */
export async function listPublicLaunches(pool: Pool, limit: number, offset: number): Promise<{ launches: Launch[]; total: number }> {
  const total = Number((await pool.query("SELECT count(*) FROM launch_configurations WHERE status = 'READY' AND public_visible")).rows[0].count);
  const r = await pool.query("SELECT * FROM launch_configurations WHERE status = 'READY' AND public_visible ORDER BY ready_at DESC, id LIMIT $1 OFFSET $2", [limit, offset]);
  return { launches: r.rows.map(launchOf), total };
}

export async function getPublicLaunch(pool: Pool, id: string): Promise<Launch | null> {
  const r = await pool.query("SELECT * FROM launch_configurations WHERE id = $1 AND status = 'READY' AND public_visible", [id]);
  return r.rows[0] ? launchOf(r.rows[0]) : null;
}

