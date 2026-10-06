import type { RealizedEvent, TaxAssumptions } from "../tax/types";
import type { FeeSplitBps } from "../feesplit";

/**
 * DEMO FIXTURES. Fictional, deterministic, never presented as chain facts.
 * Used by the API (seed + demo-backed endpoints) and by the web client's mock mode so both
 * return identical shapes. Numbers mirror apps/web/src/mock (parity asserted in a web test).
 */

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const DEMO_IDS = {
  user: id(0x100),
  admin: id(0x101),
  wallets: { trading: id(1), creator: id(2), cold: id(3) },
  charities: { c1: id(0x201), c2: id(0x202), c3: id(0x203), c4: id(0x204) },
  charityWallets: { c1: id(0x301), c2: id(0x302), c3: id(0x303), c4: id(0x304) },
  assetUsdc: id(0x401),
  assetSol: id(0x402),
} as const;

/** "Now" for demo-token age filters, so results are deterministic. Real data will use the current time. */
export const DEMO_REFERENCE_TIME = "2026-10-05T00:00:00Z";

/** Frontend mock ids -> demo UUIDs. */
export const WEB_MOCK_ID_MAP: Record<string, string> = {
  w1: DEMO_IDS.wallets.trading, w2: DEMO_IDS.wallets.creator, w3: DEMO_IDS.wallets.cold,
  c1: DEMO_IDS.charities.c1, c2: DEMO_IDS.charities.c2, c3: DEMO_IDS.charities.c3, c4: DEMO_IDS.charities.c4,
};

export interface DemoWallet { id: string; address: string; label: string }
/** Obviously fake addresses (DEMO prefix). */
export const DEMO_WALLETS: DemoWallet[] = [
  { id: DEMO_IDS.wallets.trading, address: "DEMO7xK2mQ9vT3pL8aZ4WNr91P", label: "Trading" },
  { id: DEMO_IDS.wallets.creator, address: "DEMO3fB8cJ5yR1uH6dV2KEq47M", label: "Creator" },
  { id: DEMO_IDS.wallets.cold, address: "DEMO9aD4nS7eX0gC3tU8LYb62Q", label: "Cold storage" },
];

// ---------- portfolio ----------
export interface DemoAsset { symbol: string; name: string; decimals: number; priceMicro: bigint; fictional: boolean }
export const DEMO_ASSETS: Record<string, DemoAsset> = {
  SOL: { symbol: "SOL", name: "Solana", decimals: 9, priceMicro: 142_500_000n, fictional: false },
  USDC: { symbol: "USDC", name: "USD Coin", decimals: 6, priceMicro: 1_000_000n, fictional: false },
  BONK: { symbol: "BONK", name: "Bonk", decimals: 5, priceMicro: 16n, fictional: false },
  JUP: { symbol: "JUP", name: "Jupiter", decimals: 6, priceMicro: 850_000n, fictional: false },
  HRBR: { symbol: "HRBR", name: "Harbor Demo Token", decimals: 6, priceMicro: 2_150n, fictional: true },
};
export interface DemoHolding { symbol: string; balance: bigint; costBasisCents: bigint; realizedPnlCents: bigint }
const whole = (n: number, decimals: number, frac = 0n) => BigInt(n) * 10n ** BigInt(decimals) + frac;
/** Per-wallet holdings. Across all three wallets the total is $42,810.00. */
export const DEMO_HOLDINGS: Record<string, DemoHolding[]> = {
  [DEMO_IDS.wallets.trading]: [
    { symbol: "SOL", balance: whole(100, 9), costBasisCents: 1_100_000n, realizedPnlCents: 2_430_000n },
    { symbol: "USDC", balance: whole(9_499, 6, 500_000n), costBasisCents: 949_950n, realizedPnlCents: 0n },
    { symbol: "BONK", balance: whole(250_000_000, 5), costBasisCents: 260_000n, realizedPnlCents: 1_290_000n },
    { symbol: "JUP", balance: whole(7_630, 6), costBasisCents: 510_000n, realizedPnlCents: 640_000n },
  ],
  [DEMO_IDS.wallets.creator]: [{ symbol: "HRBR", balance: whole(2_000_000, 6), costBasisCents: 390_000n, realizedPnlCents: 1_450_000n }],
  [DEMO_IDS.wallets.cold]: [{ symbol: "SOL", balance: whole(30, 9), costBasisCents: 330_000n, realizedPnlCents: 0n }],
};

// ---------- transactions ----------
export type DemoTxType = "swap" | "transfer_in" | "transfer_out" | "donation" | "fee_in";
export interface DemoTx {
  id: string; walletId: string; signature: string; occurredAt: string; type: DemoTxType;
  symbol: string; amount: bigint; usdValueCents: bigint; taxTreatment: "disposal" | "income" | "none";
}
const W = DEMO_IDS.wallets;
export const DEMO_TRANSACTIONS: DemoTx[] = [
  { id: "demo-tx-1", walletId: W.trading, signature: "DEMO-SIG-0001", occurredAt: "2026-10-03T13:41:00Z", type: "swap", symbol: "BONK", amount: whole(40_000_000, 5), usdValueCents: 64_000n, taxTreatment: "disposal" },
  { id: "demo-tx-2", walletId: W.trading, signature: "DEMO-SIG-0002", occurredAt: "2026-10-01T09:12:00Z", type: "transfer_in", symbol: "USDC", amount: whole(2_000, 6), usdValueCents: 200_000n, taxTreatment: "none" },
  { id: "demo-tx-3", walletId: W.trading, signature: "DEMO-SIG-0003", occurredAt: "2026-09-27T17:55:00Z", type: "swap", symbol: "SOL", amount: whole(12, 9), usdValueCents: 171_000n, taxTreatment: "disposal" },
  { id: "demo-tx-4", walletId: W.trading, signature: "DEMO-SIG-0004", occurredAt: "2026-09-22T16:20:00Z", type: "donation", symbol: "USDC", amount: whole(500, 6), usdValueCents: 50_000n, taxTreatment: "none" },
  { id: "demo-tx-5", walletId: W.creator, signature: "DEMO-SIG-0005", occurredAt: "2026-09-18T11:03:00Z", type: "swap", symbol: "HRBR", amount: whole(600_000, 6), usdValueCents: 129_000n, taxTreatment: "disposal" },
  { id: "demo-tx-6", walletId: W.creator, signature: "DEMO-SIG-0006", occurredAt: "2026-09-10T06:30:00Z", type: "fee_in", symbol: "USDC", amount: whole(1_240, 6), usdValueCents: 124_000n, taxTreatment: "income" },
  { id: "demo-tx-7", walletId: W.trading, signature: "DEMO-SIG-0007", occurredAt: "2026-09-02T20:14:00Z", type: "swap", symbol: "JUP", amount: whole(900, 6), usdValueCents: 78_000n, taxTreatment: "disposal" },
  { id: "demo-tx-8", walletId: W.trading, signature: "DEMO-SIG-0008", occurredAt: "2026-08-29T15:48:00Z", type: "transfer_out", symbol: "SOL", amount: whole(5, 9), usdValueCents: 71_200n, taxTreatment: "none" },
];

// ---------- tax ----------
export const DEMO_TAX_ASSUMPTIONS: TaxAssumptions = {
  jurisdiction: "US", taxYear: 2026, shortTermRateBps: 3200, longTermRateBps: 1500, stateRateBps: 500,
};
const evenSplit = (total: bigint, n: number): bigint[] => {
  const base = total / BigInt(n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - base * BigInt(n - 1) : base));
};
/** 37 synthetic realized events: ST net $40,000, LT net $18,100, gains $65,500, losses $7,400. */
export function demoRealizedEvents(): RealizedEvent[] {
  const groups: Array<[string, "SHORT_TERM" | "LONG_TERM", bigint, number]> = [
    ["stg", "SHORT_TERM", 4_620_000n, 20],
    ["stl", "SHORT_TERM", -620_000n, 4],
    ["ltg", "LONG_TERM", 1_930_000n, 10],
    ["ltl", "LONG_TERM", -120_000n, 3],
  ];
  const out: RealizedEvent[] = [];
  let day = 0;
  for (const [tag, hp, total, n] of groups) {
    evenSplit(total, n).forEach((gain, i) => {
      day += 1;
      out.push({
        transaction_id: `DEMO-EVT-${tag}-${i + 1}`, lot_id: `DEMO-LOT-${tag}`, asset: "DEMO", quantity: 1n,
        acquisition_timestamp: 0, acquisition_price_micro: 0n, disposal_timestamp: Date.UTC(2026, 0, 1) / 1000 + day * 86_400,
        disposal_price_micro: 0n, cost_basis: 0n, proceeds: gain, gain_loss: gain, holding_period: hp,
        classification: gain > 0n ? "CAPITAL_GAIN" : gain < 0n ? "CAPITAL_LOSS" : "BREAKEVEN",
      });
    });
  }
  return out;
}
/** Demo balance of the user-controlled USDC reserve ($14,200). Not read from chain. */
export const DEMO_RESERVE_CENTS = 1_420_000n;
export const DEMO_DEFAULT_TARGET = { targetType: "percentage" as const, percentBps: 3000 };

// ---------- charities / donations ----------
export interface DemoCharity {
  id: string; name: string; description: string; website: string | null; country: string; category: string;
  verification: "verified" | "pending"; legalEntityIdentifier: string | null;
  wallet: { id: string; address: string; verification: "verified" | "pending" };
}
export const DEMO_CHARITIES: DemoCharity[] = [
  { id: DEMO_IDS.charities.c1, name: "Open Water Initiative (demo)", description: "Fictional demo charity funding community water systems.", website: null, country: "US", category: "Clean water", verification: "verified", legalEntityIdentifier: null, wallet: { id: DEMO_IDS.charityWallets.c1, address: "DEMOcharityWater111111111111", verification: "verified" } },
  { id: DEMO_IDS.charities.c2, name: "Clear Sky Education Fund (demo)", description: "Fictional demo charity for scholarships and classroom grants.", website: null, country: "US", category: "Education", verification: "verified", legalEntityIdentifier: null, wallet: { id: DEMO_IDS.charityWallets.c2, address: "DEMOcharityEducation1111111", verification: "verified" } },
  { id: DEMO_IDS.charities.c3, name: "Harvest Table Network (demo)", description: "Fictional demo charity coordinating regional food banks.", website: null, country: "CA", category: "Hunger relief", verification: "verified", legalEntityIdentifier: null, wallet: { id: DEMO_IDS.charityWallets.c3, address: "DEMOcharityHunger11111111111", verification: "verified" } },
  { id: DEMO_IDS.charities.c4, name: "Reforest Together (demo)", description: "Fictional demo charity. Pending review: cannot receive donations.", website: null, country: "US", category: "Environment", verification: "pending", legalEntityIdentifier: null, wallet: { id: DEMO_IDS.charityWallets.c4, address: "DEMOcharityForest11111111111", verification: "pending" } },
];
export interface DemoDonation { id: string; charityId: string; walletId: string; amountCents: bigint; createdAt: string }
/** Seeded as status 'demo' (never 'confirmed': no verifiable transaction exists). */
export const DEMO_DONATIONS: DemoDonation[] = [
  { id: id(0x501), charityId: DEMO_IDS.charities.c1, walletId: W.trading, amountCents: 50_000n, createdAt: "2026-09-22T16:20:00Z" },
  { id: id(0x502), charityId: DEMO_IDS.charities.c2, walletId: W.trading, amountCents: 25_000n, createdAt: "2026-09-05T10:02:00Z" },
  { id: id(0x503), charityId: DEMO_IDS.charities.c3, walletId: W.trading, amountCents: 10_000n, createdAt: "2026-08-30T08:45:00Z" },
  { id: id(0x504), charityId: DEMO_IDS.charities.c1, walletId: W.trading, amountCents: 84_000n, createdAt: "2026-08-14T19:11:00Z" },
  { id: id(0x505), charityId: DEMO_IDS.charities.c3, walletId: W.trading, amountCents: 15_000n, createdAt: "2026-07-31T12:30:00Z" },
];

// ---------- tokens ----------
export const TRANSPARENCY_CHECK_KEYS = [
  "contractVerified", "mintAuthorityKnown", "freezeAuthorityKnown", "creatorWalletDisclosed",
  "feeDestinationsDisclosed", "liquidityDisclosed", "noHiddenAdmin", "charityWalletsVerified", "noFalseClaims",
] as const;
export type CheckKey = (typeof TRANSPARENCY_CHECK_KEYS)[number];

export interface DemoToken {
  id: string; name: string; symbol: string; priceMicro: bigint; marketCapCents: bigint; liquidityCents: bigint;
  liquidityLockDays: number | null; volume24hCents: bigint; volume7dChangeBps: number; holders: number;
  launchedAt: string; creatorLabel: string; creatorAddress: string; mintAuthority: "disabled" | "creator";
  freezeAuthority: "disabled" | "creator"; creatorAllocationBps: number; top10Bps: number;
  adminPrivileges: "none" | "fee-config"; feeSplit: FeeSplitBps; lifetimeFeesCents: bigint;
  charity: { donations: number; charities: number; lastDonationAt: string }; checks: Record<CheckKey, boolean>;
}
const checks = (off: CheckKey[] = []) => Object.fromEntries(TRANSPARENCY_CHECK_KEYS.map((k) => [k, !off.includes(k)])) as Record<CheckKey, boolean>;
const split = (creator: number, taxReserve: number, charity: number, protocol: number): FeeSplitBps => ({ creator, taxReserve, charity, protocol });
const fake = (tag: string) => `DEMO${tag}`.padEnd(26, "x");

export const DEMO_TOKENS: DemoToken[] = [
  { id: "demo", name: "Harbor Demo Token", symbol: "HRBR", priceMicro: 2_150n, marketCapCents: 215_000_000n, liquidityCents: 8_420_000n, liquidityLockDays: 30, volume24hCents: 2_124_000n, volume7dChangeBps: 420, holders: 1_284, launchedAt: "2026-08-14T15:00:00Z", creatorLabel: "Harbor Labs (demo)", creatorAddress: fake("Creator01"), mintAuthority: "disabled", freezeAuthority: "disabled", creatorAllocationBps: 800, top10Bps: 2_100, adminPrivileges: "fee-config", feeSplit: split(6000, 1500, 1500, 1000), lifetimeFeesCents: 8_220_000n, charity: { donations: 18, charities: 4, lastDonationAt: "2026-10-02T14:03:00Z" }, checks: checks() },
  { id: "demo-orchard", name: "Orchard Demo", symbol: "ORCH", priceMicro: 34_000n, marketCapCents: 340_000_000n, liquidityCents: 31_000_000n, liquidityLockDays: 180, volume24hCents: 4_020_000n, volume7dChangeBps: -310, holders: 3_870, launchedAt: "2026-07-02T12:00:00Z", creatorLabel: "Orchard Collective (demo)", creatorAddress: fake("Creator02"), mintAuthority: "disabled", freezeAuthority: "disabled", creatorAllocationBps: 600, top10Bps: 1_800, adminPrivileges: "none", feeSplit: split(6000, 1500, 1500, 1000), lifetimeFeesCents: 21_400_000n, charity: { donations: 41, charities: 6, lastDonationAt: "2026-10-04T08:30:00Z" }, checks: checks() },
  { id: "demo-tidepool", name: "Tidepool Demo", symbol: "TIDE", priceMicro: 1_700n, marketCapCents: 170_000_000n, liquidityCents: 14_000_000n, liquidityLockDays: 90, volume24hCents: 950_000n, volume7dChangeBps: 1_250, holders: 2_150, launchedAt: "2026-06-20T09:00:00Z", creatorLabel: "Tidepool DAO (demo)", creatorAddress: fake("Creator03"), mintAuthority: "disabled", freezeAuthority: "creator", creatorAllocationBps: 1_100, top10Bps: 3_000, adminPrivileges: "fee-config", feeSplit: split(7000, 500, 1500, 1000), lifetimeFeesCents: 6_300_000n, charity: { donations: 12, charities: 3, lastDonationAt: "2026-09-29T17:10:00Z" }, checks: checks(["charityWalletsVerified", "noHiddenAdmin"]) },
  { id: "demo-meridian", name: "Meridian Demo", symbol: "MRDN", priceMicro: 9_100n, marketCapCents: 91_000_000n, liquidityCents: 6_600_000n, liquidityLockDays: null, volume24hCents: 710_000n, volume7dChangeBps: 80, holders: 735, launchedAt: "2026-09-10T18:00:00Z", creatorLabel: "Meridian Studio (demo)", creatorAddress: fake("Creator04"), mintAuthority: "disabled", freezeAuthority: "disabled", creatorAllocationBps: 2_400, top10Bps: 4_200, adminPrivileges: "fee-config", feeSplit: split(6500, 1000, 1500, 1000), lifetimeFeesCents: 2_900_000n, charity: { donations: 7, charities: 2, lastDonationAt: "2026-10-01T11:45:00Z" }, checks: checks(["noHiddenAdmin"]) },
  { id: "demo-fieldnotes", name: "Fieldnotes Demo", symbol: "FNDM", priceMicro: 640n, marketCapCents: 64_000_000n, liquidityCents: 4_100_000n, liquidityLockDays: 30, volume24hCents: 189_000n, volume7dChangeBps: 2_900, holders: 412, launchedAt: "2026-09-28T13:00:00Z", creatorLabel: "Fieldnotes (demo)", creatorAddress: fake("Creator05"), mintAuthority: "disabled", freezeAuthority: "disabled", creatorAllocationBps: 1_900, top10Bps: 3_400, adminPrivileges: "none", feeSplit: split(5000, 1000, 2500, 1500), lifetimeFeesCents: 960_000n, charity: { donations: 4, charities: 2, lastDonationAt: "2026-10-03T20:00:00Z" }, checks: checks(["charityWalletsVerified"]) },
  { id: "demo-lantern", name: "Lantern Demo", symbol: "LNTN", priceMicro: 120n, marketCapCents: 12_000_000n, liquidityCents: 1_800_000n, liquidityLockDays: null, volume24hCents: 61_000n, volume7dChangeBps: -1_500, holders: 96, launchedAt: "2026-10-01T10:00:00Z", creatorLabel: "Anonymous creator (undisclosed)", creatorAddress: fake("Creator06"), mintAuthority: "creator", freezeAuthority: "creator", creatorAllocationBps: 3_800, top10Bps: 6_100, adminPrivileges: "fee-config", feeSplit: split(7000, 0, 2000, 1000), lifetimeFeesCents: 140_000n, charity: { donations: 1, charities: 1, lastDonationAt: "2026-10-02T09:00:00Z" }, checks: checks(["creatorWalletDisclosed", "mintAuthorityKnown", "noHiddenAdmin", "liquidityDisclosed", "charityWalletsVerified"]) },
];
