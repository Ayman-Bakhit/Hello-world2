import { z } from "zod";
import { validateFeeSplit, percentToBps } from "../feesplit";

/**
 * API contract. Single source of truth for the Fastify API (request validation) and the
 * web client (response validation). Money is a string of integer USD cents; token amounts are
 * strings of base units; rates are integer basis points. No floats cross the wire.
 */

export const API_VERSION = "0.1.0";

/** 404 code meaning "this wallet is authenticated but no indexed (live) data exists for it yet". Never means "demo data exists". */
export const NO_LIVE_DATA = "NO_LIVE_DATA";

export const DataSource = z.enum(["demo", "database", "chain"]);
export type DataSource = z.infer<typeof DataSource>;

const Cents = z.string().regex(/^-?\d+$/, "integer cents as a string");
const Uuid = z.string().uuid();
const Iso = z.string();

/** Fields present on every data response. `verifiedOnChain` is false until an indexer verifies chain data. */
const provenance = { dataSource: DataSource, verifiedOnChain: z.boolean() };

// ---------- errors ----------
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

// ---------- health ----------
export const HealthResponse = z.object({ status: z.literal("ok"), service: z.literal("api"), version: z.string() });

// ---------- wallets ----------
export const Wallet = z.object({
  id: Uuid,
  chain: z.literal("solana"),
  address: z.string(),
  label: z.string().nullable(),
  /** true only after a verified signature proves control. Never true in this slice. */
  ownershipVerified: z.boolean(),
  dataSource: DataSource,
  createdAt: Iso,
});
export type Wallet = z.infer<typeof Wallet>;
export const WalletList = z.object({ wallets: z.array(Wallet) });

// ---------- portfolio ----------
export const PortfolioAsset = z.object({
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int(),
  balance: z.string(),
  priceMicroUsd: z.string(),
  valueCents: Cents,
  costBasisCents: Cents,
  unrealizedPnlCents: Cents,
  realizedPnlCents: Cents,
  allocationBps: z.number().int(),
  isFictionalToken: z.boolean(),
});
export const PortfolioResponse = z.object({
  walletId: Uuid,
  totalValueCents: Cents,
  costBasisCents: Cents,
  realizedPnlCents: Cents,
  unrealizedPnlCents: Cents,
  assets: z.array(PortfolioAsset),
  ...provenance,
});
export type PortfolioResponse = z.infer<typeof PortfolioResponse>;

// ---------- transactions ----------
export const TxType = z.enum(["swap", "transfer_in", "transfer_out", "donation", "fee_in"]);
export const Transaction = z.object({
  id: z.string(),
  /** Placeholder for demo records (never a real signature). */
  signature: z.string(),
  timestamp: Iso,
  type: TxType,
  asset: z.string(),
  decimals: z.number().int(),
  amount: z.string(),
  usdValueCents: Cents,
  taxTreatment: z.enum(["disposal", "income", "none"]),
  /** 'demo' = fixture. 'chain' = indexed from a real transaction (not available yet). */
  source: DataSource,
  explorerUrl: z.string().nullable(),
});
export const TransactionsResponse = z.object({
  walletId: Uuid,
  transactions: z.array(Transaction),
  pagination: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int(), nextOffset: z.number().int().nullable() }),
  ...provenance,
});
export type TransactionsResponse = z.infer<typeof TransactionsResponse>;

export const TransactionsQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

// ---------- tax ----------
export const TaxAssumptionsSchema = z.object({
  jurisdiction: z.literal("US"),
  taxYear: z.number().int(),
  shortTermRateBps: z.number().int().min(0).max(10_000),
  longTermRateBps: z.number().int().min(0).max(10_000),
  stateRateBps: z.number().int().min(0).max(10_000),
});
export const TaxResponse = z.object({
  walletId: Uuid,
  /** Tax is estimated across all of the owner's wallets, not per wallet. */
  scope: z.literal("user"),
  taxYear: z.number().int(),
  costBasisMethod: z.enum(["FIFO", "LIFO", "HIFO"]),
  estimatedRealizedGainsCents: Cents,
  estimatedRealizedLossesCents: Cents,
  estimatedShortTermNetCents: Cents,
  estimatedLongTermNetCents: Cents,
  estimatedTaxableEvents: z.number().int(),
  estimatedTaxExposureCents: Cents,
  assumptions: TaxAssumptionsSchema,
  methodology: z.object({ name: z.string(), version: z.string(), limitations: z.array(z.string()) }),
  disclaimer: z.array(z.string()),
  ...provenance,
});
export type TaxResponse = z.infer<typeof TaxResponse>;

// ---------- tax reserve ----------
export const TaxReserveTarget = z.object({
  targetType: z.enum(["percentage", "amount"]),
  /** percent of realized net gains, e.g. "30" or "12.5" */
  targetPercentage: z.string().nullable(),
  /** USD, e.g. "10000.00" */
  targetAmount: z.string().nullable(),
  currency: z.literal("USDC"),
  updatedAt: Iso,
});
export const TaxReserveResponse = z.object({
  walletId: Uuid,
  scope: z.literal("user"),
  currency: z.literal("USDC"),
  /** Balance of the user-controlled reserve. Demo value until chain reads exist. */
  currentReserveCents: Cents,
  reserveDataSource: DataSource,
  estimatedTaxExposureCents: Cents,
  coverageBps: z.number().int().nullable(),
  recommendedAdditionalReserveCents: Cents,
  target: TaxReserveTarget.nullable(),
  resolvedTargetCents: Cents.nullable(),
  targetDataSource: DataSource,
  custody: z.literal("none"),
  disclaimer: z.array(z.string()),
  ...provenance,
});
export type TaxReserveResponse = z.infer<typeof TaxReserveResponse>;

export const SetTaxReserveTargetRequest = z.discriminatedUnion("targetType", [
  z.strictObject({
    targetType: z.literal("percentage"),
    targetPercentage: z.string().refine((s) => {
      try { const b = percentToBps(s); return b > 0 && b <= 10_000; } catch { return false; }
    }, "must be a percent above 0 and at most 100 with at most 2 decimals"),
    currency: z.literal("USDC").default("USDC"),
  }),
  z.strictObject({
    targetType: z.literal("amount"),
    targetAmount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "USD amount with at most 2 decimals").refine((s) => Number(s) > 0, "must be above 0"),
    currency: z.literal("USDC").default("USDC"),
  }),
]);
export type SetTaxReserveTargetRequest = z.infer<typeof SetTaxReserveTargetRequest>;

// ---------- charities / donations ----------
export const VerificationStatus = z.enum(["pending", "verified", "rejected", "revoked"]);
export const Charity = z.object({
  id: Uuid,
  name: z.string(),
  description: z.string().nullable(),
  website: z.string().nullable(),
  country: z.string().nullable(),
  category: z.string().nullable(),
  verificationStatus: VerificationStatus,
  legalEntityIdentifier: z.string().nullable(),
  wallets: z.array(z.object({
    id: Uuid, chain: z.literal("solana"), address: z.string(),
    verificationStatus: VerificationStatus, supportedAssets: z.array(z.string()),
  })),
  dataSource: DataSource,
  createdAt: Iso,
});
export type Charity = z.infer<typeof Charity>;
export const CharityList = z.object({ charities: z.array(Charity) });
export const CharitiesQuery = z.strictObject({ verified: z.enum(["true", "false"]).optional() });

/** 'confirmed' requires a verifiable transaction (enforced by a DB constraint). */
export const DonationStatus = z.enum(["pending", "demo", "confirmed", "failed"]);
export const Donation = z.object({
  id: Uuid,
  walletId: Uuid,
  charityId: Uuid,
  asset: z.string(),
  amountUsdCents: Cents,
  status: DonationStatus,
  transactionSignature: z.string().nullable(),
  receiptReference: z.string().nullable(),
  destinationAddress: z.string(),
  createdAt: Iso,
  dataSource: DataSource,
  taxNote: z.string(),
});
export type Donation = z.infer<typeof Donation>;
export const DonationsResponse = z.object({
  walletId: Uuid,
  donations: z.array(Donation),
  confirmedTotalCents: Cents,
  demoTotalCents: Cents,
  taxNote: z.string(),
  ...provenance,
});
export const CreateDonationRequest = z.strictObject({
  walletId: Uuid,
  charityId: Uuid,
  asset: z.literal("USDC").default("USDC"),
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "USD amount with at most 2 decimals").refine((s) => Number(s) > 0, "must be above 0"),
});
export const CreateDonationResponse = z.object({ donation: Donation, notice: z.string() });

// ---------- launches ----------
const bps = z.number().int().min(0).max(10_000);
export const FeeSplitSchema = z
  .strictObject({ creator: bps, taxReserve: bps, charity: bps, protocol: bps })
  .superRefine((v, ctx) => {
    // All fee-split math lives in shared/feesplit. This only surfaces its errors.
    for (const e of validateFeeSplit(v)) {
      ctx.addIssue({
        code: "custom",
        message: e.code === "SUM_MISMATCH" ? `fee split totals ${e.sum} basis points; it must be exactly 10000` : `${e.bucket} is ${e.code === "NEGATIVE" ? "negative" : "not an integer"}`,
        path: e.code === "SUM_MISMATCH" ? [] : [e.bucket],
      });
    }
  });
export type FeeSplitInput = z.infer<typeof FeeSplitSchema>;

export const LaunchConfigSchema = z.strictObject({
  name: z.string().trim().min(1).max(32),
  symbol: z.string().regex(/^[A-Z0-9]{2,10}$/, "2 to 10 characters, A-Z and 0-9"),
  description: z.string().max(280).default(""),
  totalSupply: z.string().regex(/^[1-9]\d{0,29}$/, "positive whole number"),
  decimals: z.number().int().min(0).max(9),
  creatorAllocationPercent: z.string().refine((s) => { try { return percentToBps(s) <= 10_000; } catch { return false; } }, "percent with at most 2 decimals, 0 to 100"),
  creatorWallet: z.string().min(20).max(64),
  mintAuthority: z.enum(["disabled", "creator"]).default("disabled"),
  freezeAuthority: z.enum(["disabled", "creator"]).default("disabled"),
  updateAuthority: z.enum(["disabled", "creator"]).default("creator"),
  liquidityConfiguration: z.strictObject({
    initialLiquidityUsdc: z.string().regex(/^[1-9]\d{0,11}$/, "positive whole number of USDC"),
    supplyPercentage: z.string().refine((s) => { try { const b = percentToBps(s); return b > 0 && b <= 10_000; } catch { return false; } }, "percent above 0 and at most 100"),
    lockDays: z.number().int().min(0).max(3650),
  }),
  feeSplit: FeeSplitSchema,
  charityConfiguration: z.strictObject({ charityId: Uuid }),
  taxReserveConfiguration: z.strictObject({
    destinationType: z.literal("creator_controlled"),
    destinationAddress: z.string().min(20).max(64),
  }),
});
export type LaunchConfig = z.infer<typeof LaunchConfigSchema>;

export const LaunchReview = z.object({
  passed: z.boolean(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })),
  warnings: z.array(z.string()),
  /** What a $1,000.00 fee would be split into under the configured split. */
  moneyFlowExampleCents: z.object({ creator: Cents, taxReserve: Cents, charity: Cents, protocol: Cents }),
  feeSplitLabel: z.literal("Configured fee split"),
  feeSplitEnforcement: z.literal("not_enforced"),
  deployable: z.literal(false),
  reviewedAt: Iso,
});
export type LaunchReview = z.infer<typeof LaunchReview>;

export const Launch = z.object({
  id: Uuid,
  status: z.enum(["draft", "review_passed", "review_failed"]),
  config: LaunchConfigSchema,
  review: LaunchReview.nullable(),
  deployment: z.object({ status: z.literal("not_deployed"), contractAddress: z.null() }),
  createdAt: Iso,
  updatedAt: Iso,
  dataSource: DataSource,
});
export type Launch = z.infer<typeof Launch>;
export const LaunchList = z.object({ launches: z.array(Launch), pagination: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }) });
export const PageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

// ---------- tokens / proof / discover ----------
export const FeeSplitView = z.object({
  creator: z.number().int(), taxReserve: z.number().int(), charity: z.number().int(), protocol: z.number().int(),
  label: z.literal("Configured fee split"),
  enforcement: z.enum(["not_enforced", "program_enforced"]),
  mutability: z.enum(["UNDETERMINED", "IMMUTABLE", "ADMIN_CONTROLLED"]),
});
export const TokenProof = z.object({
  tokenId: z.string(),
  name: z.string(),
  symbol: z.string(),
  contractAddress: z.string().nullable(),
  creatorWallet: z.object({ address: z.string(), label: z.string(), disclosedByCreator: z.boolean() }),
  liquidity: z.object({ amountCents: Cents, lockDays: z.number().int().nullable(), lockEvidence: z.string().nullable() }),
  feeSplit: FeeSplitView,
  charity: z.object({ totalGeneratedCents: Cents, donations: z.number().int(), charitiesSupported: z.number().int(), lastDonationAt: Iso }),
  taxReserve: z.object({ bps: z.number().int(), destination: z.string(), destinationType: z.literal("creator_controlled") }),
  protocol: z.object({ bps: z.number().int(), treasuryAddress: z.string().nullable() }),
  moneyFlowCents: z.object({ creator: Cents, taxReserve: Cents, charity: Cents, protocol: Cents }),
  mintAuthority: z.enum(["disabled", "creator"]),
  freezeAuthority: z.enum(["disabled", "creator"]),
  adminStatus: z.string(),
  transparencyChecksReported: z.record(z.string(), z.boolean()),
  evidence: z.array(z.object({ label: z.string(), url: z.string() })),
  notice: z.string(),
  ...provenance,
});
export type TokenProof = z.infer<typeof TokenProof>;

export const TokenSummary = z.object({
  id: z.string(),
  name: z.string(),
  symbol: z.string(),
  priceMicroUsd: z.string(),
  marketCapCents: Cents,
  liquidityCents: Cents,
  volume24hCents: Cents,
  holders: z.number().int(),
  launchedAt: Iso,
  creatorConcentrationBps: z.number().int(),
  charityGeneratedCents: Cents,
  transparencyChecksReported: z.number().int(),
  transparencyChecksTotal: z.number().int(),
  allTransparencyChecksReported: z.boolean(),
  dataSource: DataSource,
});
export type TokenSummary = z.infer<typeof TokenSummary>;
export const TokenList = z.object({ tokens: z.array(TokenSummary), ...provenance });

export const DISCOVER_SORTS = ["volume", "liquidity", "holders", "marketCap", "newest", "trending", "charity", "lowestCreatorConcentration"] as const;
const WholeUsd = z.string().regex(/^\d{1,12}$/, "whole US dollars");
export const DiscoverQuery = z
  .strictObject({
    sort: z.enum(DISCOVER_SORTS).default("volume"),
    minMarketCap: WholeUsd.optional(),
    maxMarketCap: WholeUsd.optional(),
    minLiquidity: WholeUsd.optional(),
    minVolume: WholeUsd.optional(),
    minHolders: z.coerce.number().int().min(0).max(100_000_000).optional(),
    verifiedTransparency: z.enum(["true", "false"]).optional(),
    /** Launched within the last N days (demo tokens: relative to DEMO_REFERENCE_TIME). */
    launchedWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .superRefine((q, ctx) => {
    if (q.minMarketCap && q.maxMarketCap && BigInt(q.minMarketCap) > BigInt(q.maxMarketCap)) {
      ctx.addIssue({ code: "custom", message: "minMarketCap must not exceed maxMarketCap", path: ["minMarketCap"] });
    }
  });
export type DiscoverQuery = z.infer<typeof DiscoverQuery>;
export const DiscoverResponse = z.object({
  tokens: z.array(TokenSummary),
  ranking: z.object({ sort: z.string(), rule: z.string() }),
  pagination: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
  notice: z.string(),
  ...provenance,
});
export type DiscoverResponse = z.infer<typeof DiscoverResponse>;

export type DonationsResponse = z.infer<typeof DonationsResponse>;
export type LaunchList = z.infer<typeof LaunchList>;
export type CharityList = z.infer<typeof CharityList>;
export type TokenList = z.infer<typeof TokenList>;
export type HealthResponse = z.infer<typeof HealthResponse>;

// ---------- wallet sign-in ----------
const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "base58 Solana address");
/** 64-byte ed25519 signature, standard base64 with padding. */
const Base64Signature = z.string().regex(/^[A-Za-z0-9+/]{86}==$/, "64-byte signature as base64");

export const NonceRequest = z.strictObject({ address: Base58, chain: z.literal("solana").default("solana") });
export const NonceResponse = z.object({
  nonce: z.string(),
  /** The exact text the wallet must sign. */
  message: z.string(),
  domain: z.string(),
  chainId: z.string(),
  issuedAt: Iso,
  expiresAt: Iso,
});
export type NonceResponse = z.infer<typeof NonceResponse>;

export const VerifyRequest = z.strictObject({
  address: Base58,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/, "32 character nonce"),
  message: z.string().min(1).max(1024),
  signature: Base64Signature,
});
export type VerifyRequest = z.infer<typeof VerifyRequest>;

/** Deliberately contains NO session token: browsers receive it only as an HttpOnly cookie. */
export const SessionResponse = z.object({
  authenticated: z.boolean(),
  user: z.object({ id: Uuid }).nullable(),
  wallet: Wallet.nullable(),
  session: z.object({ expiresAt: Iso, authMethod: z.enum(["wallet_signature", "dev_insecure"]) }).nullable(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;
export const LogoutResponse = z.object({ loggedOut: z.literal(true) });
export const AuthStatusResponse = z.object({
  mode: z.enum(["wallet", "dev-insecure"]),
  walletSignIn: z.object({ implemented: z.literal(true), messageVersion: z.string(), nonceTtlSeconds: z.number().int(), chainId: z.string(), domain: z.string() }),
  productionReady: z.boolean(),
});
export type AuthStatusResponse = z.infer<typeof AuthStatusResponse>;
export type WalletList = z.infer<typeof WalletList>;
