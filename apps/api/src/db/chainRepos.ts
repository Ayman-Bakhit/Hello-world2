import type { PoolClient } from "pg";
import type { OnchainTokenMetadata } from "@project-name/shared";
import type { Pool } from "./pool";

/** SQL for indexed (chain) data. Parameterized; wallet scoping is done by the caller after an ownership check. */
type Q = Pick<Pool, "query"> | PoolClient;

const iso = (d: Date | string | null) => (d === null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString());
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// ---------- assets ----------
export async function upsertAsset(q: Q, a: { address: string; decimals: number }): Promise<{ id: string; decimals: number }> {
  const native = a.address === "native";
  await q.query(
    `INSERT INTO assets (chain, address, symbol, name, decimals, kind, data_source)
     VALUES ('solana', $1, $2, $3, $4, $5, 'chain') ON CONFLICT (chain, address) DO NOTHING`,
    [a.address, native ? "SOL" : null, native ? "Solana" : null, a.decimals, native ? "native" : "spl"],
  );
  const r = await q.query("SELECT id, decimals FROM assets WHERE chain = 'solana' AND address = $1", [a.address]);
  return { id: r.rows[0].id as string, decimals: Number(r.rows[0].decimals) };
}

export async function assetsNeedingMetadata(q: Q, assetIds: string[], retryAfterHours = 24): Promise<{ id: string; mint: string }[]> {
  if (assetIds.length === 0) return [];
  const r = await q.query(
    `SELECT a.id, a.address FROM assets a LEFT JOIN asset_metadata m ON m.asset_id = a.id
     WHERE a.id = ANY($1::uuid[]) AND a.kind = 'spl' AND (m.asset_id IS NULL OR (m.status = 'unavailable' AND m.attempted_at < now() - make_interval(hours => $2)))
     ORDER BY a.address`,
    [assetIds, retryAfterHours],
  );
  return r.rows.map((x) => ({ id: x.id as string, mint: x.address as string }));
}

export async function saveMetadata(q: Q, assetId: string, m: OnchainTokenMetadata | null, source: string): Promise<void> {
  await q.query(
    `INSERT INTO asset_metadata (asset_id, status, name, symbol, uri, source, attempted_at, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6, now(), $7)
     ON CONFLICT (asset_id) DO UPDATE SET status = EXCLUDED.status, name = EXCLUDED.name, symbol = EXCLUDED.symbol, uri = EXCLUDED.uri,
       source = EXCLUDED.source, attempted_at = now(), fetched_at = EXCLUDED.fetched_at`,
    [assetId, m ? "resolved" : "unavailable", m?.name ?? null, m?.symbol ?? null, m?.uri ?? null, source, m ? new Date() : null],
  );
}

// ---------- sync runs / state ----------
export interface RunRow {
  id: string;
  status: "running" | "succeeded" | "partial" | "failed";
  trigger: "login" | "manual" | "background";
  startedAt: string;
  finishedAt: string | null;
  slot: number | null;
  counts: Record<string, number>;
  error: { code: string; message: string } | null;
}
const runOf = (r: Record<string, unknown>): RunRow => ({
  id: r.id as string,
  status: r.status as RunRow["status"],
  trigger: r.trigger as RunRow["trigger"],
  startedAt: iso(r.started_at as Date)!,
  finishedAt: iso(r.finished_at as Date | null),
  slot: num(r.slot),
  counts: (r.counts as Record<string, number>) ?? {},
  error: r.error_code ? { code: r.error_code as string, message: (r.error_message as string | null) ?? "" } : null,
});

/** null when a run is already in progress for the wallet (enforced by a partial unique index, so it holds across processes). */
export async function beginRun(pool: Pool, walletId: string, trigger: RunRow["trigger"], limits: Record<string, number>): Promise<RunRow | null> {
  try {
    const r = await pool.query("INSERT INTO wallet_sync_runs (wallet_id, trigger, status, limits) VALUES ($1,$2,'running',$3) RETURNING *", [walletId, trigger, JSON.stringify(limits)]);
    return runOf(r.rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return null;
    throw e;
  }
}

export async function finishRun(
  pool: Pool, runId: string,
  f: { status: "succeeded" | "partial" | "failed"; slot: bigint | null; counts: Record<string, number>; error?: { code: string; message: string } | null },
): Promise<void> {
  await pool.query(
    "UPDATE wallet_sync_runs SET status = $2, finished_at = now(), slot = $3, counts = $4, error_code = $5, error_message = $6 WHERE id = $1",
    [runId, f.status, f.slot === null ? null : f.slot.toString(), JSON.stringify(f.counts), f.error?.code ?? null, f.error?.message.slice(0, 300) ?? null],
  );
}

export async function runningRun(pool: Pool, walletId: string): Promise<RunRow | null> {
  const r = await pool.query("SELECT * FROM wallet_sync_runs WHERE wallet_id = $1 AND status = 'running'", [walletId]);
  return r.rows[0] ? runOf(r.rows[0]) : null;
}
export async function latestRun(pool: Pool, walletId: string): Promise<RunRow | null> {
  const r = await pool.query("SELECT * FROM wallet_sync_runs WHERE wallet_id = $1 ORDER BY started_at DESC, id LIMIT 1", [walletId]);
  return r.rows[0] ? runOf(r.rows[0]) : null;
}
export async function lastStartedAt(pool: Pool, walletId: string): Promise<Date | null> {
  const r = await pool.query("SELECT max(started_at) AS t FROM wallet_sync_runs WHERE wallet_id = $1", [walletId]);
  return (r.rows[0]?.t as Date | null) ?? null;
}
/** A process that died mid-sync leaves a 'running' row; close those so the wallet is not locked forever. */
export async function failStaleRuns(pool: Pool, olderThanSeconds: number): Promise<number> {
  const r = await pool.query(
    `UPDATE wallet_sync_runs SET status = 'failed', finished_at = now(), error_code = 'SYNC_INTERRUPTED', error_message = 'Sync did not finish (process stopped or timed out)'
     WHERE status = 'running' AND started_at < now() - make_interval(secs => $1)`,
    [olderThanSeconds],
  );
  return r.rowCount ?? 0;
}

export interface SyncState {
  newestSignature: string | null;
  newestSlot: number | null;
  oldestSlot: number | null;
  historyComplete: boolean;
  hasGap: boolean;
  lastSuccessAt: string | null;
}
export async function getSyncState(q: Q, walletId: string): Promise<SyncState | null> {
  const r = await q.query("SELECT * FROM wallet_sync_state WHERE wallet_id = $1", [walletId]);
  const x = r.rows[0];
  if (!x) return null;
  return {
    newestSignature: x.newest_signature ?? null, newestSlot: num(x.newest_slot), oldestSlot: num(x.oldest_slot),
    historyComplete: x.history_complete as boolean, hasGap: x.has_gap as boolean, lastSuccessAt: iso(x.last_success_at as Date | null),
  };
}
export async function saveSyncState(
  q: Q, walletId: string,
  s: { newest?: { signature: string; slot: bigint }; oldest?: { signature: string; slot: bigint }; historyComplete?: boolean; hasGap?: boolean; success: boolean; slot: bigint | null },
): Promise<void> {
  await q.query(
    `INSERT INTO wallet_sync_state (wallet_id, newest_signature, newest_slot, oldest_signature, oldest_slot, history_complete, has_gap, last_success_at, last_slot)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,false),COALESCE($7,false), CASE WHEN $8 THEN now() END, $9)
     ON CONFLICT (wallet_id) DO UPDATE SET
       newest_signature = COALESCE($2, wallet_sync_state.newest_signature), newest_slot = COALESCE($3, wallet_sync_state.newest_slot),
       oldest_signature = COALESCE(wallet_sync_state.oldest_signature, $4), oldest_slot = COALESCE(wallet_sync_state.oldest_slot, $5),
       history_complete = COALESCE($6, wallet_sync_state.history_complete), has_gap = wallet_sync_state.has_gap OR COALESCE($7,false),
       last_success_at = CASE WHEN $8 THEN now() ELSE wallet_sync_state.last_success_at END, last_slot = COALESCE($9, wallet_sync_state.last_slot)`,
    [walletId, s.newest?.signature ?? null, s.newest?.slot.toString() ?? null, s.oldest?.signature ?? null, s.oldest?.slot.toString() ?? null,
      s.historyComplete ?? null, s.hasGap ?? null, s.success, s.slot === null ? null : s.slot.toString()],
  );
}

// ---------- balances ----------
export async function insertBalanceObservation(
  q: Q, o: { walletId: string; assetId: string; tokenAccount: string | null; amount: bigint; decimals: number; slot: bigint; runId: string },
): Promise<void> {
  await q.query(
    `INSERT INTO balance_observations (wallet_id, asset_id, token_account, amount, decimals, slot, sync_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    [o.walletId, o.assetId, o.tokenAccount, o.amount.toString(), o.decimals, o.slot.toString(), o.runId],
  );
}

/** DERIVED current holdings: replaced as a whole inside one transaction so a reader never sees a half-written set. */
export async function replaceHoldings(
  pool: Pool, walletId: string,
  holdings: { assetId: string; balance: bigint; slot: bigint; tokenAccounts: number }[], runId: string,
): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const h of holdings) {
      await c.query(
        `INSERT INTO token_holdings (wallet_id, asset_id, balance, as_of_slot, observed_at, token_account_count, last_sync_run_id)
         VALUES ($1,$2,$3,$4, now(), $5, $6)
         ON CONFLICT (wallet_id, asset_id) DO UPDATE SET balance = EXCLUDED.balance, as_of_slot = EXCLUDED.as_of_slot,
           observed_at = EXCLUDED.observed_at, token_account_count = EXCLUDED.token_account_count, last_sync_run_id = EXCLUDED.last_sync_run_id`,
        [walletId, h.assetId, h.balance.toString(), h.slot.toString(), h.tokenAccounts, runId],
      );
    }
    await c.query("DELETE FROM token_holdings WHERE wallet_id = $1 AND NOT (asset_id = ANY($2::uuid[]))", [walletId, holdings.map((h) => h.assetId)]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

// ---------- transactions ----------
export async function rawTransactionId(q: Q, signature: string): Promise<string | null> {
  const r = await q.query("SELECT id FROM raw_transactions WHERE chain = 'solana' AND signature = $1", [signature]);
  return (r.rows[0]?.id as string | undefined) ?? null;
}
export async function hasNormalized(q: Q, walletId: string, rawId: string): Promise<boolean> {
  const r = await q.query("SELECT 1 FROM transactions WHERE wallet_id = $1 AND raw_transaction_id = $2", [walletId, rawId]);
  return r.rows.length > 0;
}

/** Inserts the immutable raw record (no-op if it exists) and returns its id. */
export async function insertRawTransaction(q: Q, t: { signature: string; slot: bigint; blockTime: number | null; payloadJson: string }): Promise<string> {
  await q.query(
    `INSERT INTO raw_transactions (chain, signature, slot, block_time, payload)
     VALUES ('solana', $1, $2, CASE WHEN $3::bigint IS NULL THEN NULL ELSE to_timestamp($3::bigint) END, $4::jsonb) ON CONFLICT (chain, signature) DO NOTHING`,
    [t.signature, t.slot.toString(), t.blockTime === null ? null : String(t.blockTime), t.payloadJson],
  );
  return (await rawTransactionId(q, t.signature))!;
}

export async function insertNormalizedTransaction(
  q: Q,
  t: {
    rawId: string; walletId: string; kind: string; failed: boolean; feeLamports: bigint; slot: bigint; blockTime: number | null;
    reason: string; version: string; programIds: string[]; deltas: { assetId: string; delta: bigint; decimals: number }[];
  },
): Promise<boolean> {
  const ins = await q.query(
    `INSERT INTO transactions (raw_transaction_id, wallet_id, kind, occurred_at, status, fee_lamports, slot, classification_reason, classifier_version, program_ids, data_source)
     VALUES ($1,$2,$3, CASE WHEN $4::bigint IS NULL THEN NULL ELSE to_timestamp($4::bigint) END, $5,$6,$7,$8,$9,$10,'chain')
     ON CONFLICT (wallet_id, raw_transaction_id) DO NOTHING RETURNING id`,
    [t.rawId, t.walletId, t.kind, t.blockTime === null ? null : String(t.blockTime), t.failed ? "failed" : "success", t.feeLamports.toString(), t.slot.toString(), t.reason, t.version, t.programIds],
  );
  if (!ins.rows[0]) return false; // already indexed: idempotent
  for (const d of t.deltas) {
    await q.query("INSERT INTO transaction_asset_deltas (transaction_id, asset_id, delta, decimals) VALUES ($1,$2,$3,$4)", [ins.rows[0].id, d.assetId, d.delta.toString(), d.decimals]);
  }
  return true;
}

// ---------- reads for the API ----------
export interface HoldingRow {
  mint: string | null; kind: "native" | "spl"; symbol: string | null; name: string | null; decimals: number; balance: bigint; slot: number; observedAt: string | null; tokenAccounts: number;
  meta: { status: string; name: string | null; symbol: string | null; uri: string | null; source: string } | null;
  price: { priceMicroUsd: bigint; source: string; observedAt: string } | null;
}

export async function loadHoldings(pool: Pool, walletId: string): Promise<HoldingRow[]> {
  const r = await pool.query(
    `SELECT a.address, a.kind, a.symbol, a.name, a.decimals, h.balance, h.as_of_slot, h.observed_at, h.token_account_count,
            m.status AS m_status, m.name AS m_name, m.symbol AS m_symbol, m.uri AS m_uri, m.source AS m_source,
            p.price_micro_usd, p.provider AS p_provider, p.observed_at AS p_at
     FROM token_holdings h JOIN assets a ON a.id = h.asset_id
     LEFT JOIN asset_metadata m ON m.asset_id = a.id
     LEFT JOIN LATERAL (SELECT price_micro_usd, provider, observed_at FROM price_observations WHERE asset_id = a.id ORDER BY observed_at DESC LIMIT 1) p ON true
     WHERE h.wallet_id = $1 AND a.data_source = 'chain'
     ORDER BY (a.kind = 'native') DESC, a.address`,
    [walletId],
  );
  return r.rows.map((x) => ({
    mint: x.kind === "native" ? null : (x.address as string), kind: x.kind, symbol: x.symbol ?? null, name: x.name ?? null, decimals: Number(x.decimals),
    balance: BigInt(x.balance), slot: Number(x.as_of_slot), observedAt: iso(x.observed_at as Date | null), tokenAccounts: Number(x.token_account_count),
    meta: x.m_status ? { status: x.m_status, name: x.m_name ?? null, symbol: x.m_symbol ?? null, uri: x.m_uri ?? null, source: x.m_source } : null,
    price: x.price_micro_usd === null ? null : { priceMicroUsd: BigInt(x.price_micro_usd), source: x.p_provider, observedAt: iso(x.p_at as Date)! },
  }));
}

export async function savePrice(q: Q, assetId: string, provider: string, observedAt: Date, priceMicroUsd: bigint): Promise<void> {
  await q.query("INSERT INTO price_observations (asset_id, provider, observed_at, price_micro_usd) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [assetId, provider, observedAt, priceMicroUsd.toString()]);
}

export interface TxRow {
  id: string; signature: string; kind: string; occurredAt: string | null; status: "success" | "failed" | null; feeLamports: string | null; slot: number | null;
  reason: string | null; version: string | null; programIds: string[];
  deltas: { address: string; kind: "native" | "spl"; decimals: number; delta: bigint }[];
}

export async function loadTransactions(pool: Pool, walletId: string, limit: number, offset: number): Promise<{ rows: TxRow[]; total: number }> {
  const total = await pool.query("SELECT count(*)::int AS n FROM transactions WHERE wallet_id = $1 AND data_source = 'chain'", [walletId]);
  const r = await pool.query(
    `SELECT t.id, rt.signature, t.kind, t.occurred_at, t.status, t.fee_lamports, t.slot, t.classification_reason, t.classifier_version, t.program_ids,
       COALESCE((SELECT json_agg(json_build_object('address', a.address, 'kind', a.kind, 'decimals', d.decimals, 'delta', d.delta::text) ORDER BY a.address)
                 FROM transaction_asset_deltas d JOIN assets a ON a.id = d.asset_id WHERE d.transaction_id = t.id), '[]') AS deltas
     FROM transactions t JOIN raw_transactions rt ON rt.id = t.raw_transaction_id
     WHERE t.wallet_id = $1 AND t.data_source = 'chain'
     ORDER BY t.slot DESC NULLS LAST, rt.signature LIMIT $2 OFFSET $3`,
    [walletId, limit, offset],
  );
  return {
    total: total.rows[0].n as number,
    rows: r.rows.map((x) => ({
      id: x.id, signature: x.signature, kind: x.kind, occurredAt: iso(x.occurred_at as Date | null), status: x.status ?? null,
      feeLamports: x.fee_lamports === null ? null : String(x.fee_lamports), slot: num(x.slot), reason: x.classification_reason ?? null,
      version: x.classifier_version ?? null, programIds: x.program_ids ?? [],
      deltas: (x.deltas as { address: string; kind: "native" | "spl"; decimals: number; delta: string }[]).map((d) => ({ ...d, delta: BigInt(d.delta) })),
    })),
  };
}

export async function indexedTransactionCount(pool: Pool, walletId: string): Promise<number> {
  const r = await pool.query("SELECT count(*)::int AS n FROM transactions WHERE wallet_id = $1 AND data_source = 'chain'", [walletId]);
  return r.rows[0].n as number;
}
