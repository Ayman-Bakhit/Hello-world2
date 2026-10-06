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

export type TxKind = "swap" | "transfer_in" | "transfer_out" | "donation" | "fee_in" | "transfer" | "token_receipt" | "token_send" | "fee" | "unknown";
/** "not_assessed" = live transactions: tax treatment is a later slice and is never inferred from the type. */
export type TaxTreatment = "disposal" | "income" | "none" | "not_assessed";

export interface Transaction {
  id: string;
  /** placeholder, not a real signature */
  signature: string;
  /** null = the node did not report a block time */
  occurredAt: string | null;
  kind: TxKind;
  /** symbol for SOL / demo assets; the mint address (shortened by the view) for SPL tokens */
  assetSymbol: string;
  decimals: number;
  /** signed for live transactions */
  amount: bigint;
  /** null = no price data: never shown as zero */
  usdValueCents: bigint | null;
  taxTreatment: TaxTreatment;
  walletLabel: string;
  /** live (indexed) transactions only */
  live?: {
    status: "success" | "failed" | null;
    feeLamports: bigint | null;
    explorerUrl: string | null;
    reason: string | null;
    deltaCount: number;
  };
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

export type CharityVerification = "verified" | "pending" | "rejected" | "revoked";

export interface Charity {
  id: string;
  name: string;
  description: string;
  category: string;
  country: string;
  verification: CharityVerification;
  verificationNote: string;
  /** where the record comes from; 'demo' records are fictional */
  dataSource: "demo" | "database" | "chain";
}

export interface Donation {
  id: string;
  charityId: string;
  assetSymbol: string;
  amountCents: bigint;
  occurredAt: string;
  /** demo = record only (fictional); confirmed = a verifiable on-chain transaction exists */
  status: "demo" | "pending" | "confirmed" | "failed";
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
