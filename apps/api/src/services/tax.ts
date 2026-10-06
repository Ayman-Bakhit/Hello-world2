import { createHash } from "node:crypto";
import {
  TAX_DATA_VERSION, TAX_DISCLAIMER, centsToUsdString, resolveTargetCents, type StoredTarget, type TaxReserveResponse, TAX_ENGINE_VERSION, TAX_LIMITATIONS, computeTax, type CostBasisMethod, type SwapTreatment, type TaxCalcResult, type TaxDetailsResponse,
  type TaxEvent, type TaxQuery, type TaxResponse,
} from "@project-name/shared";
import { loadTaxInputs, type TaxInputs } from "../db/taxRepos";
import type { Pool } from "../db/pool";
import type { HistoricalPriceProvider } from "../prices/historical";

export interface TaxRun {
  result: TaxCalcResult;
  inputs: TaxInputs;
  methodSource: "requested" | "default";
  rates: { shortTermRateBps: number; longTermRateBps: number; stateRateBps: number } | null;
  fingerprint: string;
  priceSources: string[];
}

/** Loads the user's indexed transactions + prices and runs the shared calculation. Read-only, deterministic. */
export async function runUserTax(
  d: { pool: Pool; prices: HistoricalPriceProvider; maxTransactions: number; now?: () => number },
  userId: string,
  q: TaxQuery,
): Promise<TaxRun> {
  const inputs = await loadTaxInputs(d.pool, userId, d.maxTransactions);
  const assets = [...new Set(inputs.txs.flatMap((t) => t.deltas.map((x) => x.asset)))];
  const priceAt = await d.prices.loadSeries(assets);
  const method: CostBasisMethod = q.method ?? "FIFO";
  const taxYear = q.taxYear ?? new Date((d.now ?? Date.now)()).getUTCFullYear();
  const rates = q.shortTermRateBps === undefined ? null : { shortTermRateBps: q.shortTermRateBps, longTermRateBps: q.longTermRateBps!, stateRateBps: q.stateRateBps! };
  const swapTreatment: SwapTreatment = q.swapTreatment ?? "DISPOSAL_AND_ACQUISITION";
  const result = computeTax({ txs: inputs.txs, method, taxYear, priceAt, swapTreatment, rates, coverage: inputs.coverage });
  const fingerprint = createHash("sha256").update(result.canonicalInput).digest("hex");
  const priceSources = [...new Set(result.events.flatMap((e) => (e.price ? [`${e.price.source}${e.price.confidence === "FIXTURE" ? " (fixture)" : ""}`] : [])))].sort();
  return { result, inputs, methodSource: q.method ? "requested" : "default", rates, fingerprint, priceSources };
}

const str = (n: bigint | null) => (n === null ? null : n.toString());
const iso = (t: number | null) => (t === null ? null : new Date(t * 1000).toISOString());
const mintOf = (asset: string) => (asset === "native" ? null : asset);
const label = (asset: string) => (asset === "native" ? "SOL" : asset);

export function taxResponseOf(walletId: string, run: TaxRun): TaxResponse {
  const { result: r } = run;
  const est = r.estimate;
  return {
    walletId, scope: "user", taxYear: r.taxYear, costBasisMethod: r.method, methodSource: run.methodSource, status: r.status, figuresComplete: r.status === "COMPLETE",
    estimatedRealizedGainsCents: str(est?.totalRealizedGainsCents ?? null), estimatedRealizedLossesCents: str(est?.totalRealizedLossesCents ?? null),
    estimatedShortTermNetCents: str(est?.shortTermNetCents ?? null), estimatedLongTermNetCents: str(est?.longTermNetCents ?? null),
    estimatedTaxableEvents: est?.taxableEventCount ?? 0, estimatedTaxExposureCents: str(r.exposureCents),
    assumptions: run.rates ? { jurisdiction: "US", taxYear: r.taxYear, ...run.rates } : null,
    calculation: {
      engineVersion: TAX_ENGINE_VERSION, dataModelVersion: TAX_DATA_VERSION, feePolicy: r.feePolicy, swapTreatment: r.swapTreatment, inputFingerprint: run.fingerprint, counts: r.counts,
      coverage: run.inputs.coverage, priceSources: run.priceSources, walletsIncluded: run.inputs.walletsIncluded,
    },
    requirements: r.requirements,
    methodology: {
      name: "shared-tax-engine", version: TAX_ENGINE_VERSION,
      limitations: [
        ...TAX_LIMITATIONS,
        "Cost basis comes only from acquisitions visible in the indexed history. Assets received by transfer have no cost basis until matched or supplied.",
        "Swaps are treated as a disposal plus an acquisition only because of an explicit assumption (swapTreatment); this is not a legal conclusion.",
        "Network fees are recorded but not added to cost basis or proceeds.",
        "Underlying chain data is read from an RPC node and is not independently verified.",
      ],
    },
    disclaimer: TAX_DISCLAIMER, dataSource: "chain", verifiedOnChain: false,
  };
}

const EVENT_CAP = 500;
const eventView = (e: TaxEvent): TaxDetailsResponse["events"][number] => ({
  id: e.id, signature: e.signature, walletId: e.walletId, timestamp: iso(e.timestamp), kind: e.kind, status: e.status, asset: label(e.asset), mint: mintOf(e.asset),
  decimals: e.decimals, quantity: e.quantity.toString(), usdValueCents: str(e.usdValueCents), priceMicroUsd: str(e.price?.priceMicroUsd ?? null), priceSource: e.price ? `${e.price.source}${e.price.confidence === "FIXTURE" ? " (fixture)" : ""}` : null,
  priceObservedAt: iso(e.price?.observedAt ?? null), valuation: e.valuation, feeLamports: str(e.feeLamports), uncoveredQuantity: e.uncoveredQuantity.toString(),
  classification: e.classification, reason: e.reason, missing: e.missing, confidence: e.confidence, matchedWith: e.matchedWith, candidates: e.candidates,
});

export function taxDetailsOf(walletId: string, run: TaxRun): TaxDetailsResponse {
  const { result: r } = run;
  const events = [...r.events].sort((a, b) => (b.timestamp ?? Infinity) - (a.timestamp ?? Infinity) || a.id.localeCompare(b.id));
  return {
    walletId, taxYear: r.taxYear, costBasisMethod: r.method, status: r.status,
    realized: r.realized.map((x) => ({
      disposalEventId: x.disposalEventId, lotEventId: x.lotEventId, asset: label(x.asset), mint: mintOf(x.asset), decimals: x.decimals, quantity: x.quantity.toString(),
      acquiredAt: iso(x.acquiredAt)!, disposedAt: iso(x.disposedAt)!, inTaxYear: new Date(x.disposedAt * 1000).getUTCFullYear() === r.taxYear,
      costBasisCents: x.costBasisCents.toString(), unitCostBasisMicro: x.unitCostBasisMicro.toString(), proceedsCents: x.proceedsCents.toString(), gainLossCents: x.gainLossCents.toString(),
      holdingPeriod: x.holdingPeriod, disposalSignature: x.disposalSignature, acquisitionSignature: x.acquisitionSignature,
      proceedsPriceSource: x.proceedsPrice?.source ?? null, costPriceSource: x.costPrice?.source ?? null, feeLamports: str(x.feeLamports),
    })),
    events: events.slice(0, EVENT_CAP).map(eventView), truncated: events.length > EVENT_CAP || run.inputs.truncated,
    note: run.inputs.truncated ? "More transactions exist than the calculation cap; results are on a truncated set." : null,
    dataSource: "chain", verifiedOnChain: false,
  };
}


const pctString = (bps: number) => `${Math.floor(bps / 100)}${bps % 100 ? "." + String(bps % 100).padStart(2, "0").replace(/0$/, "") : ""}`;

/**
 * Reserve view for a real wallet. It exposes only the ESTIMATED requirement and the user's stored target. The reserve
 * balance is not read from any chain yet, so coverage and any "additional amount" are null, not guessed. No money moves.
 */
export function taxReserveOf(walletId: string, run: TaxRun, target: (StoredTarget & { dataSource: "demo" | "database" }) | null): TaxReserveResponse {
  const est = run.result.estimate;
  const netGains = est ? est.totalRealizedGainsCents - est.totalRealizedLossesCents : 0n;
  const resolved = target && est ? resolveTargetCents(target, netGains) : null;
  return {
    walletId, scope: "user", currency: "USDC", currentReserveCents: null, reserveDataSource: null, status: run.result.status,
    estimatedTaxExposureCents: str(run.result.exposureCents), coverageBps: null, recommendedAdditionalReserveCents: null,
    target: target
      ? {
          targetType: target.targetType,
          targetPercentage: target.targetType === "percentage" ? pctString(target.percentBps ?? 0) : null,
          targetAmount: target.targetType === "amount" && target.targetCents !== null ? centsToUsdString(target.targetCents) : null,
          currency: "USDC", updatedAt: target.updatedAt,
        }
      : null,
    resolvedTargetCents: str(resolved), targetDataSource: target?.dataSource ?? "database", custody: "none",
    disclaimer: [
      "Estimated tax reserve: a voluntary planning target based on the data available. This API never moves funds, and the reserve balance is not read from any chain.",
      ...(run.result.status === "COMPLETE" ? [] : ["TAX DATA INCOMPLETE: the estimate may be missing prices, cost basis or transactions. Do not rely on it as a requirement."]),
      ...TAX_DISCLAIMER,
    ],
    dataSource: "chain", verifiedOnChain: false,
  };
}
