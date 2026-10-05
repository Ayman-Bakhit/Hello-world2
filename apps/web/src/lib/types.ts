import type { FeeSplitBps, TaxAssumptions } from "@project-name/shared";

/** Every type here describes DEMO data until the indexer/API replace the mock layer. */

export type WalletProviderId = "phantom" | "solflare" | "backpack";

export interface Wallet {
  id: string;
  address: string;
  label: string;
  provider: WalletProviderId | null;
}

export interface Asset {
  symbol: string;
  name: string;
  decimals: number;
  /** micro-USD (1e-6 USD) per whole token */
  priceMicro: bigint;
  isDemoToken: boolean;
}

export interface Holding {
  asset: Asset;
  /** base units */
  balance: bigint;
  costBasisCents: bigint;
  realizedPnlCents: bigint;
}

export interface Portfolio {
  holdings: Holding[];
  changesBps: { d1: number; d7: number; d30: number; ytd: number };
  /** deterministic demo series, cents, oldest first */
  valueSeriesCents: number[];
}

export type TxKind = "swap" | "transfer_in" | "transfer_out" | "donation" | "fee_in";
export type TaxTreatment = "disposal" | "income" | "none";

export interface Transaction {
  id: string;
  /** placeholder, not a real signature */
  signature: string;
  occurredAt: string;
  kind: TxKind;
  assetSymbol: string;
  decimals: number;
  amount: bigint;
  usdValueCents: bigint;
  taxTreatment: TaxTreatment;
  walletLabel: string;
}

export interface TaxEstimateView {
  taxYear: number;
  assumptions: TaxAssumptions;
  costBasisMethod: "FIFO" | "LIFO" | "HIFO";
  realizedGainsCents: bigint;
  realizedLossesCents: bigint;
  shortTermNetCents: bigint;
  longTermNetCents: bigint;
  taxableEvents: number;
  exposureCents: bigint;
}

export type ReserveRule =
  | { kind: "FIXED_PERCENT"; bps: number }
  | { kind: "MANUAL_TARGET"; cents: bigint };

export interface TaxReserve {
  reserveCents: bigint;
  rule: ReserveRule;
  vaultLabel: string;
}

export type CharityVerification = "verified" | "pending";

export interface Charity {
  id: string;
  name: string;
  description: string;
  category: string;
  country: string;
  verification: CharityVerification;
  verificationNote: string;
}

export interface Donation {
  id: string;
  charityId: string;
  assetSymbol: string;
  amountCents: bigint;
  occurredAt: string;
  status: "confirmed" | "pending";
  receiptRef: string;
  signature: string;
}

export type FeeSplit = FeeSplitBps;

export const TRANSPARENCY_CHECKS = [
  ["contractVerified", "Contract verified"],
  ["mintAuthorityKnown", "Mint authority status known"],
  ["freezeAuthorityKnown", "Freeze authority status known"],
  ["creatorWalletDisclosed", "Creator wallet disclosed"],
  ["feeDestinationsDisclosed", "Fee destinations disclosed"],
  ["liquidityDisclosed", "Liquidity status disclosed"],
  ["noHiddenAdmin", "No hidden admin privileges"],
  ["charityWalletsVerified", "Charity wallets verified"],
  ["noFalseClaims", "No false claims"],
] as const;
export type TransparencyCheckKey = (typeof TRANSPARENCY_CHECKS)[number][0];

export interface Token {
  slug: string;
  name: string;
  symbol: string;
  description: string;
  priceMicro: bigint;
  marketCapCents: bigint;
  liquidityCents: bigint;
  liquidityLockDays: number | null;
  volume24hCents: bigint;
  volume7dChangeBps: number;
  holders: number;
  launchedAt: string;
  creatorLabel: string;
  creatorAddress: string;
  /** null = not deployed; demo tokens have no contract */
  contractAddress: string | null;
  mintAuthority: "disabled" | "creator";
  freezeAuthority: "disabled" | "creator";
  creatorAllocationBps: number;
  top10Bps: number;
  adminPrivileges: "none" | "fee-config";
  feeSplit: FeeSplit;
  lifetimeFeesCents: bigint;
  charity: { donations: number; charities: number; lastDonationAt: string };
  checks: Record<TransparencyCheckKey, boolean>;
}

export type MintPolicy = "disabled" | "creator";

export interface LaunchConfiguration {
  name: string;
  symbol: string;
  description: string;
  imageName: string;
  totalSupply: string;
  decimals: string;
  creatorAllocationPercent: string;
  creatorWalletId: string;
  mintAuthority: MintPolicy;
  freezeAuthority: MintPolicy;
  updateAuthority: "creator" | "disabled";
  liquidityUsdc: string;
  liquiditySupplyPercent: string;
  liquidityLockDays: string;
  feeDrafts: Record<"creator" | "taxReserve" | "charity" | "protocol", string>;
  charityId: string;
  reserveWalletId: string;
}
