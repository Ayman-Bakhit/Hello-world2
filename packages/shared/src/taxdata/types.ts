import type { CostBasisMethod, HoldingPeriod, TaxAssumptions, TaxEstimate } from "../tax/types";

/**
 * Tax data model: the bridge between the normalized transaction layer (Slice 5) and the tax engine.
 * Quantities are bigint base units, USD is integer cents, prices are micro-USD per whole token. No floats.
 * NOTHING here is a legal or tax conclusion: the adapter labels what moved and what data is missing.
 */

export const TAX_DATA_VERSION = "1";

export type TaxStatus = "COMPLETE" | "PARTIAL" | "DATA_REQUIRED" | "UNAVAILABLE";
export type TaxEventKind = "BUY" | "SELL" | "TRANSFER_IN" | "TRANSFER_OUT" | "FEE" | "UNKNOWN";
/**
 * READY          usable in the calculation (it may still be an estimate)
 * DATA_REQUIRED  cannot be used until data (a price, a timestamp, cost basis) exists
 * UNRESOLVED     cannot be used until it is classified or matched (unknown transaction, unmatched transfer)
 * MATCHED        internal transfer between two of the user's own wallets, proven by the same transaction; no tax effect
 * EXCLUDED       nothing moved for the wallet (e.g. a failed transaction it did not pay for); reason stated, no tax effect
 */
export type TaxEventStatus = "READY" | "DATA_REQUIRED" | "UNRESOLVED" | "MATCHED" | "EXCLUDED";
export type MissingKind = "PRICE" | "COST_BASIS" | "TIMESTAMP" | "CLASSIFICATION" | "TRANSFER_MATCH";
/** Never "verified": the underlying chain data is read from an RPC node and is not independently verified. */
export type Confidence = "ESTIMATED" | "NONE";
export type SwapTreatment = "DISPOSAL_AND_ACQUISITION" | "NOT_ASSESSED";

/** A price is a claim by a named source at a time. Absence is null, never zero. */
export interface PriceQuote {
  /** "native" or a mint address */
  asset: string;
  /** micro-USD per whole token, always > 0 */
  priceMicroUsd: bigint;
  /** unix seconds the source observed this price */
  observedAt: number;
  source: string;
  confidence: "FIXTURE" | "OBSERVED";
}
export type PriceAt = (asset: string, atUnix: number) => PriceQuote | null;

/** One normalized transaction for one wallet, as stored by the indexer. */
export interface TaxTxInput {
  /** `transactions.id` */
  id: string;
  signature: string;
  walletId: string;
  /** unix seconds; null = the node did not report a block time */
  occurredAt: number | null;
  status: "success" | "failed";
  /** Slice 5 classification kind: transfer | token_receipt | token_send | swap | fee | unknown */
  kind: string;
  reason: string;
  classifierVersion: string;
  feeLamports: bigint | null;
  /** signed raw units for this wallet; "native" = SOL, excluding the network fee */
  deltas: { asset: string; decimals: number; delta: bigint }[];
}

export interface TaxCoverage {
  /** at least one successful sync exists */
  synced: boolean;
  /** the indexer reached the start of every wallet's history */
  historyComplete: boolean;
  /** some transactions between syncs may be missing */
  hasGap: boolean;
  /** holdings list is complete (no token-account truncation) */
  holdingsComplete: boolean;
}

/**
 * Cost basis supplied by the USER for assets acquired outside the indexed history (e.g. bought on an exchange and
 * withdrawn). It is never derived or guessed by the system. The API does not accept or store these yet; the engine
 * supports them so that a COMPLETE result is possible at all and so a future "enter cost basis" feature has a home.
 */
export interface OpeningLotInput {
  id: string;
  walletId: string;
  asset: string;
  decimals: number;
  quantity: bigint;
  acquiredAt: number;
  costBasisCents: bigint;
}

export interface TaxCalcInput {
  txs: TaxTxInput[];
  openingLots?: OpeningLotInput[];
  method: CostBasisMethod;
  taxYear: number;
  priceAt: PriceAt;
  swapTreatment: SwapTreatment;
  /** null = the user has not supplied rates: realized figures are computed, exposure is not */
  rates: Pick<TaxAssumptions, "shortTermRateBps" | "longTermRateBps" | "stateRateBps"> | null;
  coverage: TaxCoverage;
  /** matching window for candidate (NOT applied) transfer pairs, seconds */
  candidateWindowSeconds?: number;
}

export interface TaxEvent {
  /** `${txId}:${asset}:${kind}` */
  id: string;
  txId: string;
  signature: string;
  walletId: string;
  timestamp: number | null;
  kind: TaxEventKind;
  /** "native" or mint */
  asset: string;
  decimals: number;
  /** absolute base units (> 0); direction is the kind. FEE: lamports */
  quantity: bigint;
  usdValueCents: bigint | null;
  price: PriceQuote | null;
  /** how usdValueCents was obtained */
  valuation: "PRICE" | "COUNTER_LEG" | null;
  /** lamports the wallet paid as network fee. Recorded, NOT added to basis or proceeds (fee policy). */
  feeLamports: bigint | null;
  classification: { kind: string; reason: string; version: string };
  status: TaxEventStatus;
  reason: string;
  missing: MissingKind[];
  confidence: Confidence;
  /** internal transfer pair proven by the same signature */
  matchedWith: string | null;
  /** same asset and quantity within the window, different transaction: SUGGESTED only, never applied */
  candidates: string[];
  /** SELL: base units for which no acquisition lot existed (cost basis missing) */
  uncoveredQuantity: bigint;
}

export interface RealizedSlice {
  disposalEventId: string;
  lotEventId: string;
  asset: string;
  decimals: number;
  quantity: bigint;
  acquiredAt: number;
  disposedAt: number;
  costBasisCents: bigint;
  unitCostBasisMicro: bigint;
  proceedsCents: bigint;
  gainLossCents: bigint;
  holdingPeriod: HoldingPeriod;
  disposalSignature: string;
  acquisitionSignature: string;
  walletId: string;
  sourceWalletIdOfLot: string;
  proceedsPrice: PriceQuote | null;
  costPrice: PriceQuote | null;
  /** fees recorded for the disposal transaction (lamports), not applied */
  feeLamports: bigint | null;
}

export interface Requirement {
  kind: MissingKind | "HISTORY" | "HOLDINGS" | "SYNC" | "RATES";
  /** blocks_total: figures cannot be called complete and may be wrong; incomplete: figures may be missing items */
  severity: "blocks_total" | "incomplete" | "info";
  message: string;
  count: number;
}

export interface TaxCalcResult {
  status: TaxStatus;
  method: CostBasisMethod;
  taxYear: number;
  swapTreatment: SwapTreatment;
  events: TaxEvent[];
  realized: RealizedSlice[];
  /** null when status is UNAVAILABLE */
  estimate: TaxEstimate | null;
  /** exposure needs user-supplied rates */
  exposureCents: bigint | null;
  requirements: Requirement[];
  counts: Record<TaxEventKind, number> & { unresolved: number; dataRequired: number; matched: number; duplicatesIgnored: number };
  /** deterministic description of the inputs, for hashing by the caller */
  canonicalInput: string;
  feePolicy: "RECORDED_NOT_APPLIED";
}

export class TaxInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxInputError";
  }
}
