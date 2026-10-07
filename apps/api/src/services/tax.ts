import { createHash } from "node:crypto";
import {
  TAX_DATA_VERSION, TAX_DISCLAIMER, buildReserveState, buildTaxReport, canonicalReport, type TaxReport, type StoredTarget, type TaxReserveResponse, TAX_ENGINE_VERSION, TAX_LIMITATIONS, computeTax, type CostBasisMethod, type SwapTreatment, type TaxCalcResult, type TaxDetailsResponse,
  type ManualBasisReview, type TaxCalculateRequest, type TaxEvent, type TaxResponse,
} from "@project-name/shared";
import { loadManualForTax } from "../db/manualBasisRepos";
import { loadTaxInputs, type TaxInputs } from "../db/taxRepos";
import type { Pool } from "../db/pool";
import type { HistoricalPriceProvider } from "../prices/historical";
import type { TaxGate } from "./taxGate";

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
  d: { pool: Pool; prices: HistoricalPriceProvider; maxTransactions: number; gate: TaxGate; now?: () => number },
  userId: string,
  q: TaxCalculateRequest,
): Promise<TaxRun> {
  return d.gate.run(userId, () => compute(d, userId, q));
}

async function compute(
  d: { pool: Pool; prices: HistoricalPriceProvider; maxTransactions: number; now?: () => number },
  userId: string,
  q: TaxCalculateRequest,
): Promise<TaxRun> {
  const inputs = await loadTaxInputs(d.pool, userId, d.maxTransactions);
  const assets = [...new Set(inputs.txs.flatMap((t) => t.deltas.map((x) => x.asset)))];
  const priceAt = await d.prices.loadSeries(assets);
  const method: CostBasisMethod = q.method ?? "FIFO";
  const taxYear = q.taxYear ?? new Date((d.now ?? Date.now)()).getUTCFullYear();
  const rates = q.rates ?? null;
  const manual = await loadManualForTax(d.pool, userId);
  const swapTreatment: SwapTreatment = q.swapTreatment ?? "DISPOSAL_AND_ACQUISITION";
  const result = computeTax({ txs: inputs.txs, openingLots: manual, method, taxYear, priceAt, swapTreatment, rates, coverage: inputs.coverage });
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
        "Cost basis comes from acquisitions visible in the indexed history or from cost basis you provide. Assets received by transfer have no cost basis until matched or provided.",
        "Cost basis you provide is marked USER_PROVIDED: it is your own statement, not read from or verified against any blockchain, exchange or document.",
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
  origin: e.origin, manualBasisId: e.manualBasisId,
});

export const reviewView = (r: ManualBasisReview) => ({
  manualBasisId: r.manualBasisId, state: r.state, acknowledged: r.acknowledged, included: r.included, linkedEventId: r.linkedEventId, explanation: r.explanation,
  conflicts: r.conflicts.map((c) => ({ source: c.source, id: c.id, signature: c.signature, asset: label(c.asset), quantity: c.quantity.toString(), timestamp: iso(c.timestamp) })),
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
      holdingPeriod: x.holdingPeriod, disposalSignature: x.disposalSignature, acquisitionSignature: x.acquisitionSignature, acquisitionOrigin: x.acquisitionOrigin, manualBasisId: x.manualBasisId,
      proceedsPriceSource: x.proceedsPrice?.source ?? null, costPriceSource: x.costPrice?.source ?? null, feeLamports: str(x.feeLamports),
    })),
    events: events.slice(0, EVENT_CAP).map(eventView), manualBasisReview: r.manualBasisReview.map(reviewView), truncated: events.length > EVENT_CAP || run.inputs.truncated,
    note: run.inputs.truncated ? "More transactions exist than the calculation cap; results are on a truncated set." : null,
    dataSource: "chain", verifiedOnChain: false,
  };
}



/**
 * The reserve view is a pure layer over the SAME calculation (buildReserveState): no second engine, no rates of its own (the
 * exposure exists only when the caller supplied rates in a POST body), and the reserve balance is UNAVAILABLE for real wallets
 * because no ledger or funding integration exists. No money moves.
 */
export function taxReserveOf(walletId: string, run: TaxRun, target: (StoredTarget & { dataSource: "demo" | "database" }) | null): TaxReserveResponse {
  const est = run.result.estimate;
  return buildReserveState({
    walletId, taxSource: "TAX_ENGINE", taxStatus: run.result.status, exposureCents: run.result.exposureCents,
    netGainsCents: est ? est.totalRealizedGainsCents - est.totalRealizedLossesCents : null,
    ratesSupplied: run.rates !== null, requirements: run.result.requirements, target, balance: null,
  });
}


/** The report is a read-only view over the SAME calculation (no second engine). The hash covers everything except generation metadata. */
export function taxReportOf(walletId: string, run: TaxRun, limits: { maxRows: number; transactionCap: number }, now: () => Date = () => new Date()): TaxReport {
  const rep = buildTaxReport({
    result: run.result, walletId, fingerprint: run.fingerprint, generatedAt: now().toISOString(),
    limits: { transactionCap: limits.transactionCap, transactionsTruncated: run.inputs.truncated, maxRows: limits.maxRows },
  });
  rep.reportHash = createHash("sha256").update(canonicalReport(rep)).digest("hex");
  return rep;
}
