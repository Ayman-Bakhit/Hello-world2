import type { TaxCoverage, TaxTxInput } from "@project-name/shared";
import { getSyncState, holdingsComplete } from "./chainRepos";
import type { Pool } from "./pool";

export interface TaxInputs {
  txs: TaxTxInput[];
  coverage: TaxCoverage;
  walletsIncluded: number;
  /** more transactions exist than the cap: the calculation is on a truncated set */
  truncated: boolean;
}

/**
 * Everything the tax calculation reads, for ONE user, from the derived transaction layer. Demo wallets are never
 * included (their data is fixture-only and handled by the demo builders). Read-only.
 */
export async function loadTaxInputs(pool: Pool, userId: string, maxTransactions: number): Promise<TaxInputs> {
  const w = await pool.query("SELECT id FROM wallets WHERE user_id = $1 AND removed_at IS NULL AND data_source <> 'demo' ORDER BY created_at, id", [userId]);
  const walletIds = w.rows.map((r) => r.id as string);
  let synced = false, historyComplete = walletIds.length > 0, hasGap = false, holds = walletIds.length > 0;
  for (const id of walletIds) {
    const st = await getSyncState(pool, id);
    if (st?.lastSuccessAt) synced = true;
    // a wallet that has never synced contributes unknown history and unknown holdings
    if (!st?.lastSuccessAt || !st.historyComplete) historyComplete = false;
    if (st?.hasGap) hasGap = true;
    if (!st?.lastSuccessAt || !(await holdingsComplete(pool, id))) holds = false;
  }
  if (walletIds.length === 0) return { txs: [], coverage: { synced: false, historyComplete: false, hasGap: false, holdingsComplete: false }, walletsIncluded: 0, truncated: false };

  const r = await pool.query(
    `SELECT t.id, rt.signature, t.wallet_id, extract(epoch from t.occurred_at)::bigint AS at, t.status, t.kind, t.classification_reason, t.classifier_version, t.fee_lamports,
       COALESCE((SELECT json_agg(json_build_object('asset', a.address, 'decimals', d.decimals, 'delta', d.delta::text) ORDER BY a.address)
                 FROM transaction_asset_deltas d JOIN assets a ON a.id = d.asset_id WHERE d.transaction_id = t.id), '[]') AS deltas
     FROM transactions t JOIN raw_transactions rt ON rt.id = t.raw_transaction_id
     WHERE t.wallet_id = ANY($1::uuid[]) AND t.data_source = 'chain'
     ORDER BY t.occurred_at NULLS LAST, rt.signature, t.id
     LIMIT $2`,
    [walletIds, maxTransactions + 1],
  );
  const truncated = r.rows.length > maxTransactions;
  const txs: TaxTxInput[] = r.rows.slice(0, maxTransactions).map((x) => ({
    id: x.id as string, signature: x.signature as string, walletId: x.wallet_id as string,
    occurredAt: x.at === null ? null : Number(x.at), status: (x.status ?? "success") as "success" | "failed", kind: x.kind as string,
    reason: (x.classification_reason as string | null) ?? "", classifierVersion: (x.classifier_version as string | null) ?? "",
    feeLamports: x.fee_lamports === null ? null : BigInt(x.fee_lamports),
    deltas: (x.deltas as { asset: string; decimals: number; delta: string }[]).map((d) => ({ asset: d.asset, decimals: Number(d.decimals), delta: BigInt(d.delta) })),
  }));
  return { txs, coverage: { synced, historyComplete: historyComplete && !truncated, hasGap, holdingsComplete: holds }, walletsIncluded: walletIds.length, truncated };
}
