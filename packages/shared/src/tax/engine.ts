import type {
  AcquisitionLot,
  Classification,
  CostBasisMethod,
  Disposal,
  HoldingPeriod,
  RealizedEvent,
  TaxAssumptions,
  TaxEstimate,
} from "./types";

const MICRO_PER_CENT = 10_000n;

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Long-term only if held MORE than one calendar year (US). */
export function holdingPeriod(acquiredAt: number, disposedAt: number): HoldingPeriod {
  if (disposedAt < acquiredAt) throw new Error("Disposal before acquisition");
  const a = new Date(acquiredAt * 1000);
  const oneYearLater = Date.UTC(
    a.getUTCFullYear() + 1,
    a.getUTCMonth(),
    a.getUTCDate(),
    a.getUTCHours(),
    a.getUTCMinutes(),
    a.getUTCSeconds(),
  );
  return disposedAt * 1000 > oneYearLater ? "LONG_TERM" : "SHORT_TERM";
}

function classify(gain: bigint): Classification {
  return gain > 0n ? "CAPITAL_GAIN" : gain < 0n ? "CAPITAL_LOSS" : "BREAKEVEN";
}

/** Price per whole token in micro-USD, derived from cents and base-unit quantity. */
export function impliedPriceMicro(cents: bigint, quantity: bigint, decimals: number): bigint {
  if (quantity === 0n) return 0n;
  return (cents * MICRO_PER_CENT * pow10(decimals)) / quantity;
}

function orderLots(lots: AcquisitionLot[], method: CostBasisMethod): AcquisitionLot[] {
  const copy = lots.map((l) => ({ ...l }));
  const unitCost = (l: AcquisitionLot) => (l.costBasisCents * 1_000_000_000n) / l.quantity;
  copy.sort((a, b) => {
    if (method === "FIFO") return a.acquiredAt - b.acquiredAt || a.lotId.localeCompare(b.lotId);
    if (method === "LIFO") return b.acquiredAt - a.acquiredAt || a.lotId.localeCompare(b.lotId);
    const diff = unitCost(b) - unitCost(a);
    return diff > 0n ? 1 : diff < 0n ? -1 : a.acquiredAt - b.acquiredAt;
  });
  return copy;
}

export interface RealizeResult {
  events: RealizedEvent[];
  remainingLots: AcquisitionLot[];
}

/**
 * Match disposals to lots (per asset) and emit one RealizedEvent per lot slice.
 * Pure function: inputs are never mutated. Throws if a disposal exceeds
 * available lots rather than inventing basis.
 */
export function realize(
  lots: AcquisitionLot[],
  disposals: Disposal[],
  method: CostBasisMethod = "FIFO",
): RealizeResult {
  const events: RealizedEvent[] = [];
  const pool = new Map<string, AcquisitionLot[]>();
  for (const l of lots) {
    if (l.quantity <= 0n) throw new Error(`Lot ${l.lotId} has non-positive quantity`);
    pool.set(l.asset, [...(pool.get(l.asset) ?? []), { ...l }]);
  }
  const sortedDisposals = [...disposals].sort(
    (a, b) => a.disposedAt - b.disposedAt || a.txId.localeCompare(b.txId),
  );

  for (const d of sortedDisposals) {
    if (d.quantity <= 0n) throw new Error(`Disposal ${d.txId} has non-positive quantity`);
    // Only lots acquired on/before disposal are eligible.
    const eligible = orderLots(
      (pool.get(d.asset) ?? []).filter((l) => l.acquiredAt <= d.disposedAt && l.quantity > 0n),
      method,
    );
    const available = eligible.reduce((s, l) => s + l.quantity, 0n);
    if (available < d.quantity) {
      throw new Error(`Disposal ${d.txId} exceeds available lots for ${d.asset}`);
    }

    let remaining = d.quantity;
    let proceedsLeft = d.proceedsCents;
    const live = pool.get(d.asset) ?? [];
    for (const lot of eligible) {
      if (remaining === 0n) break;
      const take = lot.quantity < remaining ? lot.quantity : remaining;
      const isLotExhausted = take === lot.quantity;
      const isLastSlice = take === remaining;
      // Remainder-safe proportional split: last piece takes whatever is left, so sums are exact.
      const basis = isLotExhausted
        ? lot.costBasisCents
        : (lot.costBasisCents * take) / lot.quantity;
      const proceeds = isLastSlice ? proceedsLeft : (d.proceedsCents * take) / d.quantity;

      const gain = proceeds - basis;
      events.push({
        transaction_id: d.txId,
        lot_id: lot.lotId,
        asset: d.asset,
        quantity: take,
        acquisition_timestamp: lot.acquiredAt,
        acquisition_price_micro: impliedPriceMicro(basis, take, lot.decimals),
        disposal_timestamp: d.disposedAt,
        disposal_price_micro: impliedPriceMicro(proceeds, take, d.decimals),
        cost_basis: basis,
        proceeds,
        gain_loss: gain,
        holding_period: holdingPeriod(lot.acquiredAt, d.disposedAt),
        classification: classify(gain),
      });

      const original = live.find((l) => l.lotId === lot.lotId);
      if (original) {
        original.quantity -= take;
        original.costBasisCents -= basis;
      }
      proceedsLeft -= proceeds;
      remaining -= take;
    }
  }

  return {
    events,
    remainingLots: [...pool.values()].flat().filter((l) => l.quantity > 0n),
  };
}

function validateAssumptions(a: TaxAssumptions): void {
  for (const k of ["shortTermRateBps", "longTermRateBps", "stateRateBps"] as const) {
    if (!Number.isSafeInteger(a[k]) || a[k] < 0 || a[k] > 10_000) {
      throw new Error(`Invalid ${k}`);
    }
  }
}

/**
 * Estimate exposure for one tax year. Netting: short-term and long-term nets are
 * computed separately; a net loss in one bucket offsets a net gain in the other
 * (simplified US netting). Exposure is never negative. Uses only the supplied
 * assumptions; it is a planning estimate, not a tax liability.
 */
export function estimateTax(events: RealizedEvent[], assumptions: TaxAssumptions): TaxEstimate {
  validateAssumptions(assumptions);
  const inYear = events.filter(
    (e) => new Date(e.disposal_timestamp * 1000).getUTCFullYear() === assumptions.taxYear,
  );

  let st = 0n;
  let lt = 0n;
  let gains = 0n;
  let losses = 0n;
  for (const e of inYear) {
    if (e.holding_period === "SHORT_TERM") st += e.gain_loss;
    else lt += e.gain_loss;
    if (e.gain_loss > 0n) gains += e.gain_loss;
    else losses += e.gain_loss;
  }

  // Cross-offset a net loss in one bucket against a net gain in the other.
  let stTaxable = st;
  let ltTaxable = lt;
  if (st < 0n && lt > 0n) {
    ltTaxable = lt + st > 0n ? lt + st : 0n;
    stTaxable = 0n;
  } else if (lt < 0n && st > 0n) {
    stTaxable = st + lt > 0n ? st + lt : 0n;
    ltTaxable = 0n;
  } else {
    stTaxable = st > 0n ? st : 0n;
    ltTaxable = lt > 0n ? lt : 0n;
  }

  const stRate = BigInt(assumptions.shortTermRateBps + assumptions.stateRateBps);
  const ltRate = BigInt(assumptions.longTermRateBps + assumptions.stateRateBps);
  const exposure = (stTaxable * stRate + ltTaxable * ltRate) / 10_000n;

  return {
    assumptions,
    shortTermNetCents: st,
    longTermNetCents: lt,
    totalRealizedGainsCents: gains,
    totalRealizedLossesCents: -losses,
    taxableEventCount: inYear.length,
    estimatedExposureCents: exposure,
    label: "ESTIMATE_NOT_TAX_ADVICE",
  };
}

export interface ReserveStatus {
  reserveCents: bigint;
  exposureCents: bigint;
  /** coverage in bps, 10000 = 100%. null when exposure is zero. */
  coverageBps: number | null;
  recommendedAdditionalCents: bigint;
}

export function reserveStatus(reserveCents: bigint, exposureCents: bigint): ReserveStatus {
  if (reserveCents < 0n || exposureCents < 0n) throw new Error("Negative amount");
  const short = exposureCents > reserveCents ? exposureCents - reserveCents : 0n;
  return {
    reserveCents,
    exposureCents,
    coverageBps: exposureCents === 0n ? null : Number((reserveCents * 10_000n) / exposureCents),
    recommendedAdditionalCents: short,
  };
}

/** "Reserve X% of realized gains" helper (gains only, never negative). */
export function percentOfGains(gainsCents: bigint, bps: number): bigint {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) throw new Error("Invalid bps");
  return gainsCents > 0n ? (gainsCents * BigInt(bps)) / 10_000n : 0n;
}
