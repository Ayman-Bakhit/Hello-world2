import type { Asset, Holding, Portfolio } from "@/lib/types";

const asset = (symbol: string, name: string, decimals: number, priceMicro: bigint, isDemoToken = false): Asset => ({
  symbol, name, decimals, priceMicro, isDemoToken,
});

const SOL = asset("SOL", "Solana", 9, 142_500_000n);
const USDC = asset("USDC", "USD Coin", 6, 1_000_000n);
const BONK = asset("BONK", "Bonk", 5, 16n);
const JUP = asset("JUP", "Jupiter", 6, 850_000n);
const HRBR = asset("HRBR", "Harbor Demo Token", 6, 2_150n, true);

const h = (a: Asset, whole: number, cost: bigint, realized: bigint, fracUnits = 0n): Holding => ({
  asset: a,
  balance: BigInt(whole) * 10n ** BigInt(a.decimals) + fracUnits,
  costBasisCents: cost,
  realizedPnlCents: realized,
});

/**
 * DEMO portfolio. Total value is $42,810.00. Realized P&L sums to $58,100.00 to
 * match the demo tax estimate. Consistency is asserted in mock.test.ts.
 */
export const DEMO_PORTFOLIO: Portfolio = {
  holdings: [
    h(SOL, 130, 1_430_000n, 2_430_000n),
    h(USDC, 9_499, 949_950n, 0n, 500_000n),
    h(BONK, 250_000_000, 260_000n, 1_290_000n),
    h(JUP, 7_630, 510_000n, 640_000n),
    h(HRBR, 2_000_000, 390_000n, 1_450_000n),
  ],
  changesBps: { d1: 210, d7: -85, d30: 640, ytd: 2_180 },
  valueSeriesCents: [
    3_650_000, 3_700_000, 3_690_000, 3_760_000, 3_820_000, 3_790_000, 3_880_000, 3_940_000, 3_910_000, 4_010_000,
    4_050_000, 4_020_000, 4_090_000, 4_130_000, 4_070_000, 4_110_000, 4_180_000, 4_150_000, 4_210_000, 4_190_000,
    4_240_000, 4_220_000, 4_160_000, 4_200_000, 4_250_000, 4_270_000, 4_230_000, 4_260_000, 4_240_000, 4_281_000,
  ],
};
