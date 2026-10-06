import { formatAmount } from "./format";
import type { Holding, Portfolio } from "./types";

export function holdingValueCents(h: Holding): bigint {
  // balance(base units) * priceMicro / 10^decimals -> micro-USD -> cents
  return (h.balance * h.asset.priceMicro) / 10n ** BigInt(h.asset.decimals) / 10_000n;
}

export function unrealizedCents(h: Holding): bigint {
  return holdingValueCents(h) - h.costBasisCents;
}

export interface PortfolioTotals {
  valueCents: bigint;
  costBasisCents: bigint;
  unrealizedCents: bigint;
  realizedCents: bigint;
  assets: number;
}

export function portfolioTotals(p: Portfolio): PortfolioTotals {
  let value = 0n, cost = 0n, realized = 0n;
  for (const h of p.holdings) {
    value += holdingValueCents(h);
    cost += h.costBasisCents;
    realized += h.realizedPnlCents;
  }
  return { valueCents: value, costBasisCents: cost, unrealizedCents: value - cost, realizedCents: realized, assets: p.holdings.length };
}

/** A table row. null money fields mean "unknown" (no price, no cost basis yet) and are shown as such, never as zero. */
export interface PortfolioRow {
  key: string;
  /** SOL / demo symbol, or the shortened mint for a live SPL token (an on-chain symbol is untrusted and shown separately) */
  symbol: string;
  name: string;
  isDemoToken: boolean;
  balanceDisplay: string;
  /** exact on-chain quantity, for tooltips */
  quantityExact?: string;
  balanceNum: number;
  priceMicro: bigint | null;
  valueCents: bigint | null;
  costBasisCents: bigint | null;
  unrealizedCents: bigint | null;
  realizedCents: bigint | null;
  allocationBps: number | null;
  valuation: "priced" | "stale_price" | "price_unavailable";
  /** live SPL tokens only */
  mint?: string | null;
  metadata?: { status: "resolved" | "unavailable" | "not_applicable"; name: string | null; symbol: string | null };
}

export function portfolioRows(p: Portfolio): PortfolioRow[] {
  const total = portfolioTotals(p).valueCents;
  return p.holdings.map((h) => {
    const value = holdingValueCents(h);
    return {
      key: h.asset.symbol,
      valuation: "priced" as const,
      symbol: h.asset.symbol,
      name: h.asset.name,
      isDemoToken: h.asset.isDemoToken,
      balanceDisplay: formatAmount(h.balance, h.asset.decimals, 2),
      balanceNum: Number(h.balance) / 10 ** h.asset.decimals,
      priceMicro: h.asset.priceMicro,
      valueCents: value,
      costBasisCents: h.costBasisCents,
      unrealizedCents: value - h.costBasisCents,
      realizedCents: h.realizedPnlCents,
      allocationBps: total === 0n ? 0 : Number((value * 10_000n) / total),
    };
  });
}
