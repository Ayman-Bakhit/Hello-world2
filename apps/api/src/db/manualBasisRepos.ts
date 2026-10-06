import { createHash } from "node:crypto";
import type { ManualBasisInput, NormalizedManualBasis } from "@project-name/shared";
import type { Pool } from "./pool";

export const MAX_MANUAL_RECORDS_PER_USER = 500;

export interface RevisionRow {
  revision: number;
  action: "create" | "revise" | "void";
  status: "active" | "voided";
  quantity: bigint;
  acquiredAt: number;
  costBasisCents: bigint;
  currency: "USD";
  reason: string;
  signature: string | null;
  notes: string | null;
  acknowledgedOverlap: boolean;
  changeReason: string | null;
  prevHash: string | null;
  rowHash: string;
  createdAt: string;
}
export interface BasisRow {
  id: string;
  walletId: string;
  asset: string;
  decimals: number;
  createdAt: string;
  current: RevisionRow;
}

export class RepoError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "STALE_REVISION" | "VOIDED" | "LIMIT_REACHED", message: string) {
    super(message);
  }
}

const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();
const unix = (d: Date | string) => Math.floor((d instanceof Date ? d : new Date(d)).getTime() / 1000);

/** Tamper evidence: each revision's hash covers its own fields and the previous revision's hash. */
export function revisionHash(basisId: string, r: Omit<RevisionRow, "rowHash" | "createdAt"> & { prevHash: string | null }): string {
  const canon = JSON.stringify([
    basisId, r.revision, r.action, r.status, r.quantity.toString(), r.acquiredAt, r.costBasisCents.toString(), r.currency, r.reason, r.signature, r.notes, r.acknowledgedOverlap, r.changeReason, r.prevHash,
  ]);
  return createHash("sha256").update(canon).digest("hex");
}

const revOf = (x: Record<string, unknown>): RevisionRow => ({
  revision: Number(x.revision), action: x.action as RevisionRow["action"], status: x.status as RevisionRow["status"], quantity: BigInt(x.quantity as string),
  acquiredAt: unix(x.acquired_at as Date), costBasisCents: BigInt(x.cost_basis_cents as string), currency: "USD", reason: x.reason as string,
  signature: (x.signature as string | null) ?? null, notes: (x.notes as string | null) ?? null, acknowledgedOverlap: x.acknowledged_overlap as boolean,
  changeReason: (x.change_reason as string | null) ?? null, prevHash: (x.prev_hash as string | null) ?? null, rowHash: x.row_hash as string, createdAt: iso((x.created_at ?? x.revised_at) as Date),
});

const CURRENT_SQL = "SELECT * FROM manual_cost_basis_current";
const basisOf = (x: Record<string, unknown>): BasisRow => ({
  id: x.id as string, walletId: x.wallet_id as string, asset: x.asset as string, decimals: Number(x.decimals), createdAt: iso(x.record_created_at as Date),
  current: revOf({ ...x, created_at: x.revised_at }),
});

export async function knownDecimals(pool: Pool, asset: string): Promise<number | null> {
  if (asset === "native") return 9;
  const r = await pool.query("SELECT decimals FROM assets WHERE chain = 'solana' AND address = $1", [asset]);
  return r.rows[0] ? Number(r.rows[0].decimals) : null;
}

export async function createBasis(pool: Pool, a: { userId: string; walletId: string; authMethod: string; n: NormalizedManualBasis }): Promise<BasisRow> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const cnt = await c.query("SELECT count(*)::int AS n FROM manual_cost_basis WHERE user_id = $1", [a.userId]);
    if (cnt.rows[0].n >= MAX_MANUAL_RECORDS_PER_USER) throw new RepoError("LIMIT_REACHED", `At most ${MAX_MANUAL_RECORDS_PER_USER} cost basis records per account`);
    const id = (await c.query("INSERT INTO manual_cost_basis (user_id, wallet_id, asset, decimals, created_auth_method) VALUES ($1,$2,$3,$4,$5) RETURNING id", [a.userId, a.walletId, a.n.asset, a.n.decimals, a.authMethod])).rows[0].id as string;
    const rev = { revision: 1, action: "create" as const, status: "active" as const, quantity: a.n.quantityRaw, acquiredAt: a.n.acquiredAt, costBasisCents: a.n.costBasisCents, currency: "USD" as const, reason: a.n.reason, signature: a.n.signature, notes: a.n.notes, acknowledgedOverlap: false, changeReason: null, prevHash: null };
    await insertRevision(c, id, rev);
    await c.query("COMMIT");
    return (await getBasis(pool, a.userId, a.walletId, id))!;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
async function insertRevision(q: Q, basisId: string, r: Omit<RevisionRow, "rowHash" | "createdAt">): Promise<void> {
  const rowHash = revisionHash(basisId, r);
  await q.query(
    `INSERT INTO manual_cost_basis_revisions (basis_id, revision, action, status, quantity, acquired_at, cost_basis_cents, currency, reason, signature, notes, acknowledged_overlap, change_reason, prev_hash, row_hash)
     VALUES ($1,$2,$3,$4,$5,to_timestamp($6),$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [basisId, r.revision, r.action, r.status, r.quantity.toString(), r.acquiredAt, r.costBasisCents.toString(), r.currency, r.reason, r.signature, r.notes, r.acknowledgedOverlap, r.changeReason, r.prevHash, rowHash],
  );
}

/** Scoped by BOTH user and wallet: a record id alone never grants access (IDOR-safe). */
export async function getBasis(pool: Pool, userId: string, walletId: string, id: string): Promise<BasisRow | null> {
  const r = await pool.query(`${CURRENT_SQL} WHERE id = $1 AND user_id = $2 AND wallet_id = $3`, [id, userId, walletId]);
  return r.rows[0] ? basisOf(r.rows[0]) : null;
}

export async function listBasis(pool: Pool, userId: string, walletId: string, includeVoided: boolean): Promise<BasisRow[]> {
  const r = await pool.query(`${CURRENT_SQL} WHERE user_id = $1 AND wallet_id = $2 ${includeVoided ? "" : "AND status = 'active'"} ORDER BY record_created_at, id`, [userId, walletId]);
  return r.rows.map(basisOf);
}

export async function history(pool: Pool, basisId: string): Promise<RevisionRow[]> {
  const r = await pool.query("SELECT * FROM manual_cost_basis_revisions WHERE basis_id = $1 ORDER BY revision", [basisId]);
  return r.rows.map(revOf);
}

/** Recomputes the hash chain. False if any stored revision does not match its recorded hash or the chain is broken. */
export function historyIntact(basisId: string, rows: RevisionRow[]): boolean {
  let prev: string | null = null;
  for (const [i, r] of rows.entries()) {
    if (r.revision !== i + 1 || r.prevHash !== prev || revisionHash(basisId, r) !== r.rowHash) return false;
    prev = r.rowHash;
  }
  return true;
}

export interface ReviseFields {
  quantity: bigint; acquiredAt: number; costBasisCents: bigint; reason: string; signature: string | null; notes: string | null; acknowledgeOverlap: boolean; changeReason: string; expectedRevision: number;
}
async function append(pool: Pool, a: { userId: string; walletId: string; id: string; expectedRevision: number; build: (cur: RevisionRow) => Omit<RevisionRow, "rowHash" | "createdAt"> }): Promise<BasisRow> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // lock the identity row: concurrent revisions of one record are serialized
    const own = await c.query("SELECT id FROM manual_cost_basis WHERE id = $1 AND user_id = $2 AND wallet_id = $3 FOR UPDATE", [a.id, a.userId, a.walletId]);
    if (!own.rows[0]) throw new RepoError("NOT_FOUND", "Cost basis record not found");
    const cur = revOf((await c.query("SELECT * FROM manual_cost_basis_revisions WHERE basis_id = $1 ORDER BY revision DESC LIMIT 1", [a.id])).rows[0]!);
    if (cur.status === "voided") throw new RepoError("VOIDED", "This record has been voided; add a new record instead");
    if (cur.revision !== a.expectedRevision) throw new RepoError("STALE_REVISION", `This record is at revision ${cur.revision}, not ${a.expectedRevision}. Reload and try again.`);
    await insertRevision(c, a.id, a.build(cur));
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
  return (await getBasis(pool, a.userId, a.walletId, a.id))!;
}

export const reviseBasis = (pool: Pool, a: { userId: string; walletId: string; id: string; f: ReviseFields }) =>
  append(pool, {
    ...a, expectedRevision: a.f.expectedRevision,
    build: (cur) => ({
      revision: cur.revision + 1, action: "revise", status: "active", quantity: a.f.quantity, acquiredAt: a.f.acquiredAt, costBasisCents: a.f.costBasisCents, currency: "USD",
      reason: a.f.reason, signature: a.f.signature, notes: a.f.notes, acknowledgedOverlap: a.f.acknowledgeOverlap, changeReason: a.f.changeReason, prevHash: cur.rowHash,
    }),
  });

export const voidBasis = (pool: Pool, a: { userId: string; walletId: string; id: string; changeReason: string; expectedRevision: number }) =>
  append(pool, {
    ...a,
    build: (cur) => ({ ...cur, revision: cur.revision + 1, action: "void", status: "voided", changeReason: a.changeReason, prevHash: cur.rowHash }),
  });

/** Active records of the user's non-demo wallets, as engine input. */
export async function loadManualForTax(pool: Pool, userId: string): Promise<ManualBasisInput[]> {
  const r = await pool.query(
    `SELECT c.* FROM manual_cost_basis_current c JOIN wallets w ON w.id = c.wallet_id
     WHERE c.user_id = $1 AND c.status = 'active' AND w.removed_at IS NULL AND w.data_source <> 'demo' ORDER BY c.record_created_at, c.id`, [userId]);
  return r.rows.map((x) => {
    const b = basisOf(x);
    return { id: b.id, walletId: b.walletId, asset: b.asset, decimals: b.decimals, quantity: b.current.quantity, acquiredAt: b.current.acquiredAt, costBasisCents: b.current.costBasisCents, revision: b.current.revision, createdAt: new Date(b.createdAt).getTime(), signature: b.current.signature, reason: b.current.reason, acknowledgedOverlap: b.current.acknowledgedOverlap };
  });
}
