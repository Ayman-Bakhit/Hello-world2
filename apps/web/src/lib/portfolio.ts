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

export interface PortfolioRow {
  symbol: string;
  name: string;
  isDemoToken: boolean;
  balanceDisplay: string;
  balanceNum: number;
  priceMicro: bigint;
  valueCents: bigint;
  costBasisCents: bigint;
  unrealizedCents: bigint;
  realizedCents: bigint;
  allocationBps: number;
}

export function portfolioRows(p: Portfolio): PortfolioRow[] {
  const total = portfolioTotals(p).valueCents;
  return p.holdings.map((h) => {
    const value = holdingValueCents(h);
    return {
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
