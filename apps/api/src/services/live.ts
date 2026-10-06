import {
  CLASSIFIER_VERSION, formatUnits, valueCents,
  type PortfolioAsset, type PortfolioResponse, type TransactionsResponse,
} from "@project-name/shared";
import type { HoldingRow, TxRow } from "../db/chainRepos";

const SOL = "SOL";
type Transaction = TransactionsResponse["transactions"][number];

/**
 * Builds the live portfolio from indexed holdings. Rules:
 *  - balances are on-chain observations; prices are separate claims from a named source; value = balance x price
 *  - a missing price is NEVER zero: the asset is "price_unavailable" and has no value
 *  - the total is only reported when every shown asset has a price; otherwise only a labeled partial sum
 *  - SPL names/symbols are untrusted token-authority text, kept in `metadata`, never promoted to top-level fields
 */
export function buildLivePortfolio(a: {
  walletId: string; holdings: HoldingRow[]; cluster: string; lastSyncedAt: string | null; nowMs: number; priceMaxAgeSeconds: number; slot: number | null; complete: boolean;
}): PortfolioResponse {
  const shown = a.holdings.filter((h) => h.balance > 0n);
  const staleBefore = a.nowMs - a.priceMaxAgeSeconds * 1000;
  const rows = shown.map((h) => {
    const priced = h.price !== null && h.price.priceMicroUsd > 0n;
    const stale = priced && new Date(h.price!.observedAt).getTime() < staleBefore;
    const value = priced ? valueCents(h.balance, h.decimals, h.price!.priceMicroUsd) : null;
    return { h, priced, stale, value };
  });
  const pricedRows = rows.filter((r) => r.priced);
  const partial = pricedRows.length ? pricedRows.reduce((s, r) => s + r.value!, 0n) : null;
  // A total is only claimed when the asset list itself is complete and every asset is priced.
  const allPriced = a.complete && (rows.length > 0 ? pricedRows.length === rows.length : true);
  const total = allPriced ? (partial ?? 0n) : null;

  const assets: PortfolioAsset[] = rows.map(({ h, priced, stale, value }) => {
    const native = h.kind === "native";
    return {
      kind: h.kind,
      mint: h.mint,
      symbol: native ? SOL : null,
      name: native ? (h.name ?? "Solana") : null,
      decimals: h.decimals,
      balance: h.balance.toString(),
      quantity: formatUnits(h.balance, h.decimals),
      tokenAccounts: h.tokenAccounts,
      priceMicroUsd: priced ? h.price!.priceMicroUsd.toString() : null,
      valuation: !priced ? "price_unavailable" : stale ? "stale_price" : "priced",
      price: priced ? { source: h.price!.source, observedAt: h.price!.observedAt } : null,
      valueCents: value === null ? null : value.toString(),
      costBasisCents: null,
      unrealizedPnlCents: null,
      realizedPnlCents: null,
      allocationBps: total !== null && total > 0n && value !== null ? Number((value * 10_000n) / total) : null,
      isFictionalToken: false,
      metadata: native
        ? { status: "not_applicable", name: null, symbol: null, uri: null, source: null, verified: false }
        : h.meta?.status === "resolved"
          ? { status: "resolved", name: h.meta.name, symbol: h.meta.symbol, uri: h.meta.uri, source: h.meta.source, verified: false }
          : { status: "unavailable", name: null, symbol: null, uri: null, source: h.meta?.source ?? null, verified: false },
      observedSlot: h.slot,
      observedAt: h.observedAt,
    };
  });

  const status = rows.length === 0 ? (a.complete ? "complete" : "unavailable") : pricedRows.length === 0 ? "unavailable" : pricedRows.length < rows.length || !a.complete ? "partial" : rows.some((r) => r.stale) ? "stale" : "complete";
  return {
    walletId: a.walletId,
    totalValueCents: total === null ? null : total.toString(),
    partialValueCents: partial === null ? null : partial.toString(),
    costBasisCents: null, realizedPnlCents: null, unrealizedPnlCents: null,
    valuation: { status, pricedAssets: pricedRows.length, unpricedAssets: rows.length - pricedRows.length },
    source: { kind: "solana_rpc", cluster: a.cluster, slot: a.slot, observedAt: a.holdings[0]?.observedAt ?? null, lastSyncedAt: a.lastSyncedAt, holdingsComplete: a.complete },
    assets,
    dataSource: "chain",
    // Observed from an RPC node we do not independently verify; "verified" claims need an objective source.
    verifiedOnChain: false,
  };
}

export function explorerUrl(signature: string, cluster: string): string {
  return `https://explorer.solana.com/tx/${signature}${cluster === "mainnet" ? "" : `?cluster=${cluster}`}`;
}

export function buildLiveTransactions(a: {
  walletId: string; rows: TxRow[]; total: number; limit: number; offset: number; cluster: string;
  window: TransactionsResponse["window"];
}): TransactionsResponse {
  const transactions: Transaction[] = a.rows.map((t) => {
    const deltas = t.deltas.map((d) => ({
      asset: d.kind === "native" ? SOL : d.address, mint: d.kind === "native" ? null : d.address, symbol: d.kind === "native" ? SOL : null,
      amount: d.delta.toString(), decimals: d.decimals,
    }));
    const tokens = t.deltas.filter((d) => d.kind !== "native").sort((x, y) => { const ax = x.delta < 0n ? -x.delta : x.delta, ay = y.delta < 0n ? -y.delta : y.delta; return ax === ay ? 0 : ax < ay ? 1 : -1; });
    const primary = tokens[0] ?? t.deltas.find((d) => d.kind === "native");
    return {
      id: t.id, signature: t.signature, timestamp: t.occurredAt, type: t.kind as Transaction["type"],
      asset: primary ? (primary.kind === "native" ? SOL : primary.address) : SOL,
      decimals: primary?.decimals ?? 9,
      amount: primary ? primary.delta.toString() : "0",
      usdValueCents: null, taxTreatment: "not_assessed", source: "chain", explorerUrl: explorerUrl(t.signature, a.cluster),
      status: t.status, feeLamports: t.feeLamports, slot: t.slot,
      classification: { kind: t.kind, reason: t.reason ?? "", version: t.version ?? CLASSIFIER_VERSION },
      programIds: t.programIds, deltas,
    };
  });
  const next = a.offset + a.limit < a.total ? a.offset + a.limit : null;
  return {
    walletId: a.walletId, transactions, pagination: { limit: a.limit, offset: a.offset, total: a.total, nextOffset: next },
    window: a.window, dataSource: "chain", verifiedOnChain: false,
  };
}
