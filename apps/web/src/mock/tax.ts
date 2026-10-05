import type { TaxEstimateView, TaxReserve } from "@/lib/types";

/**
 * DEMO tax estimate. Numbers are internally consistent with the stated assumptions:
 * ST net 40,000 x (32% + 5%) + LT net 18,100 x (15% + 5%) = 14,800 + 3,620 = 18,420.
 * Verified against shared estimateTax in mock.test.ts.
 */
export const DEMO_TAX_ESTIMATE: TaxEstimateView = {
  taxYear: 2026,
  assumptions: {
    jurisdiction: "US",
    taxYear: 2026,
    shortTermRateBps: 3200,
    longTermRateBps: 1500,
    stateRateBps: 500,
  },
  costBasisMethod: "FIFO",
  realizedGainsCents: 6_550_000n,
  realizedLossesCents: 740_000n,
  shortTermNetCents: 4_000_000n,
  longTermNetCents: 1_810_000n,
  taxableEvents: 37,
  exposureCents: 1_842_000n,
};

export const DEMO_TAX_RESERVE: TaxReserve = {
  reserveCents: 1_420_000n,
  rule: { kind: "FIXED_PERCENT", bps: 3000 },
  vaultLabel: "DEMO user-controlled USDC account",
};

/** Demo creator fees received (cents). */
export const DEMO_CREATOR_FEES_CENTS = 842_000n;
