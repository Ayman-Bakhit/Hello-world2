/**
 * Tax engine types. Quantities are bigint base units (e.g. lamports) paired
 * with the asset's decimals. USD is integer cents. Prices are micro-USD
 * (1e-6 USD) per whole token. No floats anywhere in the calculation path.
 * All outputs are ESTIMATES for planning, not tax advice.
 */

export type CostBasisMethod = "FIFO" | "LIFO" | "HIFO";
export type HoldingPeriod = "SHORT_TERM" | "LONG_TERM";
export type Classification = "CAPITAL_GAIN" | "CAPITAL_LOSS" | "BREAKEVEN";

export interface AcquisitionLot {
  lotId: string;
  sourceTxId: string;
  asset: string;
  decimals: number;
  quantity: bigint;
  /** unix seconds */
  acquiredAt: number;
  /** total USD cents paid for the whole lot, including fees if the user elects */
  costBasisCents: bigint;
}

export interface Disposal {
  txId: string;
  asset: string;
  decimals: number;
  quantity: bigint;
  disposedAt: number;
  /** USD cents received for the whole disposal, net of disposal fees */
  proceedsCents: bigint;
}

export interface RealizedEvent {
  transaction_id: string;
  lot_id: string;
  asset: string;
  quantity: bigint;
  acquisition_timestamp: number;
  acquisition_price_micro: bigint;
  disposal_timestamp: number;
  disposal_price_micro: bigint;
  cost_basis: bigint;
  proceeds: bigint;
  gain_loss: bigint;
  holding_period: HoldingPeriod;
  classification: Classification;
}

export interface TaxAssumptions {
  jurisdiction: "US";
  taxYear: number;
  /** Marginal rates in basis points. User-configurable, never hardcoded defaults in the engine. */
  shortTermRateBps: number;
  longTermRateBps: number;
  stateRateBps: number;
}

export interface TaxEstimate {
  assumptions: TaxAssumptions;
  shortTermNetCents: bigint;
  longTermNetCents: bigint;
  totalRealizedGainsCents: bigint;
  totalRealizedLossesCents: bigint;
  taxableEventCount: number;
  estimatedExposureCents: bigint;
  label: "ESTIMATE_NOT_TAX_ADVICE";
}
