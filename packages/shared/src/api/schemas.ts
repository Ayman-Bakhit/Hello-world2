import { z } from "zod";
import { CHARITY_VERIFICATION_STATES, DONATION_PROVENANCES, DONATION_STATUSES, EVIDENCE_SOURCE_TYPES, EVIDENCE_STATUSES, RECEIPT_VERIFICATION_STATES, USD_REFERENCE_SOURCES, safeHttpUrl } from "../give";
import { validateFeeSplit, percentToBps } from "../feesplit";
import { parseUsdToCents } from "../money";
import { RESERVE_BALANCE_SOURCES, RESERVE_RECOMMENDATION_STATUSES, RESERVE_TARGET_SOURCES, RESERVE_TAX_SOURCES } from "../reserve";

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
export const AssetMetadataView = z.object({
  /** resolved = read from the token's own on-chain metadata account (UNTRUSTED text); unavailable = none found / not looked up */
  status: z.enum(["resolved", "unavailable", "not_applicable"]),
  name: z.string().nullable(),
  symbol: z.string().nullable(),
  uri: z.string().nullable(),
  source: z.string().nullable(),
  /** There is no objective verification source yet. Always false. */
  verified: z.literal(false),
});
export const PortfolioAsset = z.object({
  kind: z.enum(["native", "spl"]),
  /** mint address for SPL tokens; null for native SOL and demo fixtures */
  mint: z.string().nullable(),
  /** Only native SOL and demo fixtures have a symbol here. A live SPL symbol is untrusted metadata and lives in `metadata`. */
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  decimals: z.number().int(),
  /** raw base units (the on-chain balance) */
  balance: z.string(),
  /** exact decimal rendering of `balance` */
  quantity: z.string(),
  tokenAccounts: z.number().int(),
  priceMicroUsd: z.string().nullable(),
  /** priced = fresh price; stale_price = last known price is older than the freshness window; price_unavailable = no price. Never "zero". */
  valuation: z.enum(["priced", "stale_price", "price_unavailable"]),
  price: z.object({ source: z.string(), observedAt: Iso }).nullable(),
  valueCents: Cents.nullable(),
  costBasisCents: Cents.nullable(),
  unrealizedPnlCents: Cents.nullable(),
  realizedPnlCents: Cents.nullable(),
  allocationBps: z.number().int().nullable(),
  isFictionalToken: z.boolean(),
  metadata: AssetMetadataView,
  observedSlot: z.number().int().nullable(),
  observedAt: Iso.nullable(),
});
export const PortfolioValuation = z.object({
  /** complete = every asset has a fresh price; stale = all priced but some stale; partial = some assets unpriced; unavailable = none priced; demo = fixture */
  status: z.enum(["complete", "stale", "partial", "unavailable", "demo"]),
  pricedAssets: z.number().int(),
  unpricedAssets: z.number().int(),
});
export const PortfolioSource = z.object({
  kind: z.enum(["demo", "solana_rpc"]),
  cluster: z.string().nullable(),
  slot: z.number().int().nullable(),
  observedAt: Iso.nullable(),
  lastSyncedAt: Iso.nullable(),
  /** false when the last sync could not list every holding (token-account limit, inconsistent data). Totals are then withheld. */
  holdingsComplete: z.boolean(),
});
export const PortfolioResponse = z.object({
  walletId: Uuid,
  /** Only present when EVERY asset is priced. Otherwise null: a partial sum is never presented as the total. */
  totalValueCents: Cents.nullable(),
  /** Sum of the assets that have a price (may be incomplete). Label it as such. */
  partialValueCents: Cents.nullable(),
  /** Cost basis and P&L need classified transactions (future slice): null for live wallets. */
  costBasisCents: Cents.nullable(),
  realizedPnlCents: Cents.nullable(),
  unrealizedPnlCents: Cents.nullable(),
  valuation: PortfolioValuation,
  source: PortfolioSource,
  assets: z.array(PortfolioAsset),
  ...provenance,
});
export type PortfolioResponse = z.infer<typeof PortfolioResponse>;
export type PortfolioAsset = z.infer<typeof PortfolioAsset>;

// ---------- transactions ----------
export const TxType = z.enum(["swap", "transfer_in", "transfer_out", "donation", "fee_in", "transfer", "token_receipt", "token_send", "fee", "unknown"]);
export const TxDelta = z.object({
  asset: z.string(),
  mint: z.string().nullable(),
  symbol: z.string().nullable(),
  /** signed raw base units for this wallet; native SOL excludes the network fee (see feeLamports) */
  amount: z.string(),
  decimals: z.number().int(),
});
export const Transaction = z.object({
  id: z.string(),
  /** Real transaction signature for live data; a DEMO-SIG-* placeholder for demo records. */
  signature: z.string(),
  timestamp: Iso.nullable(),
  type: TxType,
  /** Display convenience: the primary asset (symbol, or the mint address when no symbol is known). Full list in `deltas`. */
  asset: z.string(),
  decimals: z.number().int(),
  /** signed raw base units of the primary asset (live); unsigned for demo records */
  amount: z.string(),
  usdValueCents: Cents.nullable(),
  /** Live transactions are "not_assessed": tax treatment is a later slice and is never inferred from the type. */
  taxTreatment: z.enum(["disposal", "income", "none", "not_assessed"]),
  /** 'demo' = fixture. 'chain' = indexed from a real transaction. */
  source: DataSource,
  explorerUrl: z.string().nullable(),
  status: z.enum(["success", "failed"]).nullable(),
  feeLamports: z.string().nullable(),
  slot: z.number().int().nullable(),
  /** Why the type was chosen. Null for demo records. */
  classification: z.object({ kind: z.string(), reason: z.string(), version: z.string() }).nullable(),
  programIds: z.array(z.string()),
  deltas: z.array(TxDelta),
});
export const TransactionsWindow = z.object({
  newestSlot: z.number().int().nullable(),
  oldestSlot: z.number().int().nullable(),
  /** true only if the indexer reached the start of this wallet's history */
  historyComplete: z.boolean(),
  /** true if a sync could not reach the previous newest transaction: some in-between transactions may be missing */
  hasGap: z.boolean(),
  indexedCount: z.number().int(),
});
export const TransactionsResponse = z.object({
  walletId: Uuid,
  transactions: z.array(Transaction),
  pagination: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int(), nextOffset: z.number().int().nullable() }),
  window: TransactionsWindow.nullable(),
  ...provenance,
});
export type TransactionsResponse = z.infer<typeof TransactionsResponse>;

export const TransactionsQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

// ---------- wallet sync (read-only indexing) ----------
export const SyncRun = z.object({
  id: Uuid,
  status: z.enum(["running", "succeeded", "partial", "failed"]),
  trigger: z.enum(["login", "manual", "background"]),
  startedAt: Iso,
  finishedAt: Iso.nullable(),
  slot: z.number().int().nullable(),
  counts: z.record(z.string(), z.number()),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type SyncRun = z.infer<typeof SyncRun>;
export const SyncStatusResponse = z.object({
  walletId: Uuid,
  state: z.enum(["unsupported_demo_wallet", "indexing_unavailable", "never_synced", "syncing", "synced", "failed"]),
  /** false when the server has no SOLANA_RPC_URL */
  configured: z.boolean(),
  cluster: z.string(),
  priceProvider: z.string(),
  limits: z.object({ initialTransactionLimit: z.number().int(), maxTransactionsPerSync: z.number().int(), minSyncIntervalSeconds: z.number().int() }),
  lastRun: SyncRun.nullable(),
  lastSuccessAt: Iso.nullable(),
  window: TransactionsWindow.nullable(),
  /** earliest time another sync will be accepted for this wallet */
  nextAllowedAt: Iso.nullable(),
});
export type SyncStatusResponse = z.infer<typeof SyncStatusResponse>;
export const StartSyncResponse = z.object({ run: SyncRun, alreadyRunning: z.boolean() });
export type StartSyncResponse = z.infer<typeof StartSyncResponse>;

// ---------- tax ----------
export const TaxAssumptionsSchema = z.object({
  jurisdiction: z.literal("US"),
  taxYear: z.number().int(),
  shortTermRateBps: z.number().int().min(0).max(10_000),
  longTermRateBps: z.number().int().min(0).max(10_000),
  stateRateBps: z.number().int().min(0).max(10_000),
});
export const TaxStatusEnum = z.enum(["COMPLETE", "PARTIAL", "DATA_REQUIRED", "UNAVAILABLE"]);
export const TaxEventKindEnum = z.enum(["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT", "FEE", "UNKNOWN", "MANUAL_BASIS"]);
export const TaxEventStatusEnum = z.enum(["READY", "DATA_REQUIRED", "UNRESOLVED", "MATCHED", "EXCLUDED"]);
export const TaxMissingKind = z.enum(["PRICE", "COST_BASIS", "TIMESTAMP", "CLASSIFICATION", "TRANSFER_MATCH", "BASIS_REVIEW"]);
export const TaxRequirementView = z.object({
  kind: z.enum(["PRICE", "COST_BASIS", "TIMESTAMP", "CLASSIFICATION", "TRANSFER_MATCH", "BASIS_REVIEW", "HISTORY", "HOLDINGS", "SYNC", "RATES"]),
  severity: z.enum(["blocks_total", "incomplete", "info"]),
  message: z.string(),
  count: z.number().int(),
});
export const TaxCalculationInfo = z.object({
  engineVersion: z.string(),
  dataModelVersion: z.string(),
  /** Network fees are recorded on events but never added to cost basis or proceeds. */
  feePolicy: z.literal("RECORDED_NOT_APPLIED"),
  /** How swaps were treated. An ASSUMPTION, not a legal conclusion. */
  swapTreatment: z.enum(["DISPOSAL_AND_ACQUISITION", "NOT_ASSESSED"]),
  /** sha256 of the exact inputs (transactions, classifier versions, prices used, method, year): same inputs, same hash. */
  inputFingerprint: z.string(),
  counts: z.object({
    BUY: z.number().int(), SELL: z.number().int(), TRANSFER_IN: z.number().int(), TRANSFER_OUT: z.number().int(), FEE: z.number().int(), UNKNOWN: z.number().int(), MANUAL_BASIS: z.number().int(),
    unresolved: z.number().int(), dataRequired: z.number().int(), matched: z.number().int(), duplicatesIgnored: z.number().int(),
  }),
  coverage: z.object({ synced: z.boolean(), historyComplete: z.boolean(), hasGap: z.boolean(), holdingsComplete: z.boolean() }),
  /** distinct price sources actually used */
  priceSources: z.array(z.string()),
  walletsIncluded: z.number().int(),
});
export const TaxResponse = z.object({
  walletId: Uuid,
  /** Tax is estimated across all of the owner's wallets, not per wallet. */
  scope: z.literal("user"),
  taxYear: z.number().int(),
  /** The accounting method used for every figure. Never mixed. */
  costBasisMethod: z.enum(["FIFO", "LIFO", "HIFO"]),
  methodSource: z.enum(["requested", "default", "demo_fixture"]),
  /** COMPLETE only when no price, cost basis, timestamp, classification, transfer match, history or holdings is missing. */
  status: TaxStatusEnum,
  figuresComplete: z.boolean(),
  /** null = not computed (UNAVAILABLE) */
  estimatedRealizedGainsCents: Cents.nullable(),
  estimatedRealizedLossesCents: Cents.nullable(),
  estimatedShortTermNetCents: Cents.nullable(),
  estimatedLongTermNetCents: Cents.nullable(),
  estimatedTaxableEvents: z.number().int(),
  /** null when status is UNAVAILABLE or no rates were supplied */
  estimatedTaxExposureCents: Cents.nullable(),
  assumptions: TaxAssumptionsSchema.nullable(),
  calculation: TaxCalculationInfo.nullable(),
  requirements: z.array(TaxRequirementView),
  methodology: z.object({ name: z.string(), version: z.string(), limitations: z.array(z.string()) }),
  disclaimer: z.array(z.string()),
  ...provenance,
});
export type TaxResponse = z.infer<typeof TaxResponse>;

export const ManualBasisReviewView = z.object({
  manualBasisId: z.string(),
  state: z.enum(["OK", "POTENTIAL_DUPLICATE", "OVERLAPPING_BASIS", "DECIMALS_MISMATCH"]),
  acknowledged: z.boolean(),
  /** false = excluded from the calculation until reviewed */
  included: z.boolean(),
  linkedEventId: z.string().nullable(),
  conflicts: z.array(z.object({ source: z.enum(["CHAIN", "USER_PROVIDED"]), id: z.string(), signature: z.string(), asset: z.string(), quantity: z.string(), timestamp: Iso.nullable() })),
  explanation: z.string(),
});

// ---------- manual (USER_PROVIDED) cost basis ----------
const MintOrNative = z.string().refine((a) => a === "native" || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a), 'must be "native" (SOL) or a token mint address');
export const ManualBasisReasonEnum = z.enum(["EXCHANGE_PURCHASE", "PRIOR_WALLET", "GIFT_RECEIVED", "INCOME_OR_REWARD", "OTHER"]);
const manualFields = {
  /** decimal amount in whole tokens, e.g. "1.5". Never rounded: too many decimals is an error. */
  quantity: z.string().min(1).max(80),
  /** UTC, whole seconds: 2023-05-17T14:30:00Z */
  acquiredAt: z.string().min(1).max(40),
  /** USD with at most 2 decimals, e.g. "1234.56" */
  costBasis: z.string().min(1).max(40),
  reason: ManualBasisReasonEnum,
  signature: z.string().max(100).nullish(),
  notes: z.string().max(1000).nullish(),
};
export const CreateManualBasisRequest = z.strictObject({
  asset: MintOrNative,
  decimals: z.number().int().min(0).max(38).nullish(),
  currency: z.literal("USD").default("USD"),
  ...manualFields,
});
export type CreateManualBasisRequest = z.infer<typeof CreateManualBasisRequest>;
/** A revision replaces the editable fields; asset and wallet are fixed (void the record and add a new one to change them). */
export const ReviseManualBasisRequest = z.strictObject({
  ...manualFields,
  currency: z.literal("USD").default("USD"),
  acknowledgeOverlap: z.boolean().default(false),
  /** why this change is being made; kept in the audit trail */
  changeReason: z.string().min(3).max(300),
  /** the revision the caller last saw: stale writes are refused */
  expectedRevision: z.number().int().min(1),
});
export type ReviseManualBasisRequest = z.infer<typeof ReviseManualBasisRequest>;
export const VoidManualBasisRequest = z.strictObject({ changeReason: z.string().min(3).max(300), expectedRevision: z.number().int().min(1) });
export type VoidManualBasisRequest = z.infer<typeof VoidManualBasisRequest>;

const manualRevisionShape = {
  revision: z.number().int(),
  action: z.enum(["create", "revise", "void"]),
  status: z.enum(["active", "voided"]),
  quantity: z.string(),
  quantityRaw: z.string(),
  acquiredAt: Iso,
  costBasis: z.string(),
  costBasisCents: Cents,
  currency: z.literal("USD"),
  reason: ManualBasisReasonEnum,
  signature: z.string().nullable(),
  notes: z.string().nullable(),
  acknowledgedOverlap: z.boolean(),
  changeReason: z.string().nullable(),
  createdAt: Iso,
};
export const ManualBasisRevisionView = z.object(manualRevisionShape);
export const ManualBasisView = z.object({
  id: Uuid,
  walletId: Uuid,
  asset: z.string(),
  mint: z.string().nullable(),
  decimals: z.number().int(),
  /** Always USER_PROVIDED. This data is the user's statement; it is not read from, or verified against, any blockchain. */
  source: z.literal("USER_PROVIDED"),
  verifiedOnChain: z.literal(false),
  ...manualRevisionShape,
  /** when the record was first created (the current revision's time is `updatedAt`) */
  createdAt: Iso,
  updatedAt: Iso,
  /** present on create/list/detail: duplicate/overlap review from the last tax calculation */
  review: ManualBasisReviewView.nullable(),
});
export type ManualBasisView = z.infer<typeof ManualBasisView>;
export const ManualBasisList = z.object({ walletId: Uuid, records: z.array(ManualBasisView), source: z.literal("USER_PROVIDED") });
export const ManualBasisDetail = z.object({ record: ManualBasisView, history: z.array(ManualBasisRevisionView) });
export type ManualBasisDetail = z.infer<typeof ManualBasisDetail>;

export const TaxEventView = z.object({
  id: z.string(),
  signature: z.string(),
  walletId: z.string(),
  timestamp: Iso.nullable(),
  kind: TaxEventKindEnum,
  status: TaxEventStatusEnum,
  /** "SOL" or the mint address */
  asset: z.string(),
  mint: z.string().nullable(),
  decimals: z.number().int(),
  /** absolute raw base units; direction is the kind */
  quantity: z.string(),
  usdValueCents: Cents.nullable(),
  priceMicroUsd: z.string().nullable(),
  priceSource: z.string().nullable(),
  priceObservedAt: Iso.nullable(),
  valuation: z.enum(["PRICE", "COUNTER_LEG"]).nullable(),
  feeLamports: z.string().nullable(),
  uncoveredQuantity: z.string(),
  classification: z.object({ kind: z.string(), reason: z.string(), version: z.string() }),
  reason: z.string(),
  missing: z.array(TaxMissingKind),
  confidence: z.enum(["ESTIMATED", "NONE"]),
  matchedWith: z.string().nullable(),
  /** SUGGESTED counterparts (same asset and quantity, different transaction). Never applied. */
  candidates: z.array(z.string()),
  /** CHAIN = derived from an indexed Solana transaction. USER_PROVIDED = entered by the user; never from Solana. */
  origin: z.enum(["CHAIN", "USER_PROVIDED"]),
  manualBasisId: z.string().nullable(),
});
export const TaxRealizedView = z.object({
  disposalEventId: z.string(),
  lotEventId: z.string(),
  asset: z.string(),
  mint: z.string().nullable(),
  decimals: z.number().int(),
  quantity: z.string(),
  acquiredAt: Iso,
  disposedAt: Iso,
  inTaxYear: z.boolean(),
  costBasisCents: Cents,
  unitCostBasisMicro: z.string(),
  proceedsCents: Cents,
  gainLossCents: Cents,
  holdingPeriod: z.enum(["SHORT_TERM", "LONG_TERM"]),
  disposalSignature: z.string(),
  acquisitionSignature: z.string(),
  acquisitionOrigin: z.enum(["CHAIN", "USER_PROVIDED"]),
  manualBasisId: z.string().nullable(),
  proceedsPriceSource: z.string().nullable(),
  costPriceSource: z.string().nullable(),
  feeLamports: z.string().nullable(),
});
export const TaxDetailsResponse = z.object({
  walletId: Uuid,
  taxYear: z.number().int(),
  costBasisMethod: z.enum(["FIFO", "LIFO", "HIFO"]),
  status: TaxStatusEnum,
  /** Realized slices (one per lot consumed), all years; `inTaxYear` marks the ones in the estimate. */
  realized: z.array(TaxRealizedView),
  /** Every derived tax event with its status and why. Newest first, capped. */
  events: z.array(TaxEventView),
  /** Review state of every active USER_PROVIDED basis record (duplicates / overlaps are excluded until reviewed). */
  manualBasisReview: z.array(ManualBasisReviewView),
  truncated: z.boolean(),
  note: z.string().nullable(),
  ...provenance,
});
export type TaxDetailsResponse = z.infer<typeof TaxDetailsResponse>;

/** GET query: non-sensitive parameters only. Tax rates are NOT accepted in a URL (use POST /calculate). */
export const TaxQuery = z.strictObject({
  taxYear: z.coerce.number().int().min(2009).max(2100).optional(),
  method: z.enum(["FIFO", "LIFO", "HIFO"]).optional(),
  swapTreatment: z.enum(["DISPOSAL_AND_ACQUISITION", "NOT_ASSESSED"]).optional(),
});
export type TaxQuery = z.infer<typeof TaxQuery>;

/** Body of POST /api/tax/:walletId/calculate. Rates and other financial inputs travel in the body, never in a URL. */
export const TaxCalculateRequest = z.strictObject({
  taxYear: z.number().int().min(2009).max(2100).optional(),
  method: z.enum(["FIFO", "LIFO", "HIFO"]).optional(),
  swapTreatment: z.enum(["DISPOSAL_AND_ACQUISITION", "NOT_ASSESSED"]).optional(),
  rates: z.strictObject({ shortTermRateBps: z.number().int().min(0).max(10_000), longTermRateBps: z.number().int().min(0).max(10_000), stateRateBps: z.number().int().min(0).max(10_000) }).optional(),
});
export type TaxCalculateRequest = z.infer<typeof TaxCalculateRequest>;
export const TaxCalculateResponse = z.object({ tax: TaxResponse, details: TaxDetailsResponse });
export type TaxCalculateResponse = z.infer<typeof TaxCalculateResponse>;

// ---------- tax report (read-only view over the calculation) ----------
const ReportStatus = TaxStatusEnum;
const OriginEnum = z.enum(["CHAIN", "USER_PROVIDED"]);
const PriceConf = z.enum(["FIXTURE", "OBSERVED"]);
export const TaxReportDisposal = z.object({
  id: z.string(), taxYear: z.number().int(), asset: z.string(), mint: z.string().nullable(), decimals: z.number().int(), quantityRaw: z.string(), quantity: z.string(),
  acquiredAt: Iso, disposedAt: Iso, costBasisCents: Cents, proceedsCents: Cents, gainLossCents: Cents, holdingPeriod: z.enum(["SHORT_TERM", "LONG_TERM"]), accountingMethod: z.string(),
  disposalSignature: z.string(), disposalWalletId: z.string(), acquisitionSignature: z.string().nullable(), acquisitionWalletId: z.string(),
  acquisitionSource: OriginEnum, disposalSource: z.literal("CHAIN"), manualBasisId: z.string().nullable(),
  proceedsValuation: z.enum(["PRICE", "COUNTER_LEG"]).nullable(), proceedsPriceSource: z.string().nullable(), proceedsPriceObservedAt: Iso.nullable(), proceedsPriceConfidence: PriceConf.nullable(),
  costPriceSource: z.string().nullable(), costPriceObservedAt: Iso.nullable(), costPriceConfidence: PriceConf.nullable(),
  feeLamports: z.string().nullable(), confidence: z.literal("ESTIMATED"), verifiedOnChain: z.literal(false), reportStatus: ReportStatus,
});
export const TaxReportUnresolved = z.object({
  id: z.string(), signature: z.string(), walletId: z.string(), timestamp: Iso.nullable(), kind: z.string(), asset: z.string(), mint: z.string().nullable(), quantityRaw: z.string(),
  status: z.string(), missing: z.array(z.string()), reason: z.string(), origin: OriginEnum, manualBasisId: z.string().nullable(),
});
export const TaxReportResponse = z.object({
  reportVersion: z.string(),
  meta: z.object({ generatedAt: Iso }),
  label: z.literal("ESTIMATED_TAX_REPORT"),
  walletId: Uuid,
  taxYear: z.number().int(),
  yearBoundary: z.object({ kind: z.literal("UTC_CALENDAR_YEAR"), from: Iso, toExclusive: Iso, basis: z.string() }),
  accountingMethod: z.enum(["FIFO", "LIFO", "HIFO"]),
  swapTreatment: z.enum(["DISPOSAL_AND_ACQUISITION", "NOT_ASSESSED"]),
  feePolicy: z.string(),
  status: ReportStatus,
  summary: z.object({
    proceedsCents: Cents.nullable(), costBasisCents: Cents.nullable(), gainLossCents: Cents, shortTermGainLossCents: Cents, longTermGainLossCents: Cents, shortTermProceedsCents: Cents.nullable(), longTermProceedsCents: Cents.nullable(),
    disposalCount: z.number().int(),
  }).nullable(),
  counts: z.object({ unresolvedEvents: z.number().int(), dataRequiredEvents: z.number().int(), unknownEvents: z.number().int(), matchedTransfers: z.number().int(), duplicatesIgnored: z.number().int() }),
  requirements: z.array(z.object({ kind: z.string(), severity: z.enum(["blocks_total", "incomplete", "info"]), message: z.string(), count: z.number().int() })),
  manualBasis: z.object({
    included: z.boolean(), disclosure: z.string().nullable(), recordsUnderReview: z.number().int(),
    records: z.array(z.object({ id: z.string(), asset: z.string(), mint: z.string().nullable(), quantityRaw: z.string(), acquiredAt: Iso, costBasisCents: Cents, reviewState: z.string(), includedInCalculation: z.boolean(), linkedTransferEventId: z.string().nullable(), disposalSlicesUsing: z.number().int() })),
  }),
  priceProvenance: z.object({
    sources: z.array(z.string()), note: z.string(),
    observations: z.array(z.object({ asset: z.string(), source: z.string(), observedAt: Iso, confidence: PriceConf, priceMicroUsd: z.string(), events: z.number().int() })),
  }),
  provenance: z.object({ dataSource: z.enum(["chain", "demo"]), verifiedOnChain: z.literal(false), chainDataNote: z.string(), priceNote: z.string(), userProvidedNote: z.string() }),
  limits: z.object({ transactionCap: z.number().int(), transactionsTruncated: z.boolean(), maxRows: z.number().int(), rowsExceeded: z.boolean() }),
  disposals: z.array(TaxReportDisposal),
  unresolvedEvents: z.array(TaxReportUnresolved),
  fingerprint: z.string(),
  reportHash: z.string(),
  disclaimer: z.array(z.string()),
});
export type TaxReportResponse = z.infer<typeof TaxReportResponse>;
/** Report parameters. All validated server-side; none are financial inputs, but exports use POST so nothing is cached or logged in URLs. */
export const TaxReportQuery = TaxQuery;
export const TaxReportExportRequest = z.strictObject({
  format: z.enum(["csv", "json"]),
  taxYear: z.number().int().min(2009).max(2100).optional(),
  method: z.enum(["FIFO", "LIFO", "HIFO"]).optional(),
  swapTreatment: z.enum(["DISPOSAL_AND_ACQUISITION", "NOT_ASSESSED"]).optional(),
});
export type TaxReportExportRequest = z.infer<typeof TaxReportExportRequest>;

// ---------- tax reserve (Slice 10: estimate, recommendation, user target, balance and coverage are separate figures) ----------
export const ReserveRequirement = z.object({ kind: z.string(), severity: z.string(), count: z.number().int(), message: z.string() });
export const TaxReserveResponse = z.object({
  walletId: Uuid,
  scope: z.literal("user"),
  currency: z.literal("USDC"),
  /** What the tax engine produced. Never authoritative; exposure exists only for COMPLETE or PARTIAL status and user-supplied rates. */
  taxEstimate: z.object({
    source: z.enum(RESERVE_TAX_SOURCES),
    status: TaxStatusEnum,
    label: z.literal("ESTIMATE"),
    estimatedExposureCents: Cents.nullable(),
    withheldReason: z.string().nullable(),
    ratesSupplied: z.boolean(),
    incomplete: z.boolean(),
    missing: z.array(ReserveRequirement),
    authoritative: z.literal(false),
    verifiedOnChain: z.literal(false),
  }),
  /** A policy applied to the estimate. Not the user's target and not a funded amount. */
  recommendation: z.object({
    source: z.literal("SYSTEM_RECOMMENDATION"),
    policy: z.literal("EXPOSURE_1X"),
    status: z.enum(RESERVE_RECOMMENDATION_STATUSES),
    label: z.string(),
    recommendedCents: Cents.nullable(),
    reason: z.string(),
    authoritative: z.literal(false),
  }),
  /** User configuration. A number the user chose; never money. */
  userTarget: z.object({
    set: z.boolean(),
    source: z.enum(RESERVE_TARGET_SOURCES).nullable(),
    enabled: z.boolean().nullable(),
    targetType: z.enum(["percentage", "amount"]).nullable(),
    /** percent of realized net gains, e.g. "30" or "12.5" */
    targetPercentage: z.string().nullable(),
    targetAmountCents: Cents.nullable(),
    /** the configured target in cents; for a percentage target it needs an available estimate of realized gains */
    resolvedCents: Cents.nullable(),
    /** resolvedCents when the target is enabled, else null */
    effectiveCents: Cents.nullable(),
    resolutionNote: z.string().nullable(),
    updatedAt: Iso.nullable(),
    dataSource: z.enum(["demo", "database"]).nullable(),
    label: z.string(),
    isMoney: z.literal(false),
  }),
  /** The target relative to the estimated exposure. Not a measure of funding. */
  targetVsExposure: z.object({ available: z.boolean(), bps: z.number().int().nullable(), wording: z.string().nullable(), reason: z.string().nullable() }),
  /** Funds actually held. UNAVAILABLE (NOT_CONNECTED) until a verifiable ledger exists: this is not zero. */
  reserveBalance: z.object({
    source: z.enum(RESERVE_BALANCE_SOURCES),
    status: z.enum(["NOT_CONNECTED", "DEMO"]),
    cents: Cents.nullable(),
    label: z.string(),
    note: z.string(),
  }),
  /** balance / target. Unavailable whenever either side is unavailable. */
  coverage: z.object({ available: z.boolean(), bps: z.number().int().nullable(), label: z.string(), reason: z.string().nullable() }),
  remaining: z.object({ available: z.boolean(), cents: Cents.nullable(), reason: z.string().nullable() }),
  funding: z.object({ enabled: z.literal(false), message: z.string(), custody: z.literal("none"), moneyMovement: z.literal("NOT_ENABLED") }),
  disclaimer: z.array(z.string()),
  ...provenance,
});
export type TaxReserveResponse = z.infer<typeof TaxReserveResponse>;

/** One-per-user USD amount in USDC with at most 2 decimals. Exact digits only: no NaN, Infinity, exponent, sign, separators or unicode digits. */
const reserveAmount = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "USD amount with at most 2 decimals").refine((s) => parseUsdToCents(s) !== null, "must be above 0");

/**
 * Saves the reserve TARGET configuration. `confirmed: true` is required: the UI asks for explicit confirmation and the API
 * refuses a save that did not get one. The source is always USER_SET here (a client cannot claim SYSTEM_RECOMMENDED).
 */
export const SetTaxReserveTargetRequest = z.discriminatedUnion("targetType", [
  z.strictObject({
    targetType: z.literal("percentage"),
    targetPercentage: z.string().refine((s) => {
      try { const b = percentToBps(s); return b > 0 && b <= 10_000; } catch { return false; }
    }, "must be a percent above 0 and at most 100 with at most 2 decimals"),
    currency: z.literal("USDC").default("USDC"),
    enabled: z.boolean().default(true),
    confirmed: z.literal(true, { error: "explicit confirmation is required" }),
  }),
  z.strictObject({
    targetType: z.literal("amount"),
    targetAmount: reserveAmount,
    currency: z.literal("USDC").default("USDC"),
    enabled: z.boolean().default(true),
    confirmed: z.literal(true, { error: "explicit confirmation is required" }),
  }),
]);
export type SetTaxReserveTargetRequest = z.infer<typeof SetTaxReserveTargetRequest>;

// ---------- charities / donations / receipts (Slice 9: registry, evidence, donation record and receipt are separate) ----------
/** Charity WALLET verification (a destination address), separate from the organization's verification state. */
export const VerificationStatus = z.enum(["pending", "verified", "rejected", "revoked"]);
export const CharityVerificationStateSchema = z.enum(CHARITY_VERIFICATION_STATES);
export const EvidenceSourceTypeSchema = z.enum(EVIDENCE_SOURCE_TYPES);
const HttpUrl = z.string().max(500).refine((u) => safeHttpUrl(u) !== null, "must be an http(s) URL");
const HttpsUrl = z.string().max(500).refine((u) => safeHttpUrl(u, { httpsOnly: true }) !== null, "must be an https URL");
const QuantityString = z.string().regex(/^\d{1,40}$/, "non-negative integer in base units");

/** Public registry record. Never includes internal verification notes, verifier identity, or any donor information. */
export const Charity = z.object({
  id: Uuid,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  website: HttpUrl.nullable(),
  logoUrl: HttpsUrl.nullable(),
  country: z.string().nullable(),
  category: z.string().nullable(),
  verificationState: CharityVerificationStateSchema,
  verificationSource: EvidenceSourceTypeSchema.nullable(),
  lastReviewedAt: Iso.nullable(),
  evidenceCount: z.number().int().min(0),
  legalEntityIdentifier: z.string().nullable(),
  wallets: z.array(z.object({
    id: Uuid, chain: z.literal("solana"), address: z.string(),
    verificationStatus: VerificationStatus, supportedAssets: z.array(z.string()),
  })),
  dataSource: DataSource,
  createdAt: Iso,
  updatedAt: Iso,
});
export type Charity = z.infer<typeof Charity>;
export const CharityList = z.object({ charities: z.array(Charity) });
export const CharitiesQuery = z.strictObject({ verified: z.enum(["true", "false"]).optional() });

/** One piece of verification evidence, public view: no internal notes, no verifier identity. */
export const CharityEvidenceItem = z.object({
  id: Uuid,
  sourceType: EvidenceSourceTypeSchema,
  sourceRef: z.string(),
  sourceUrl: HttpUrl.nullable(),
  status: z.enum(EVIDENCE_STATUSES),
  checkedAt: Iso,
  reviewedBy: z.enum(["ADMIN", "NOT_RECORDED"]),
  publicSummary: z.string(),
  dataSource: DataSource,
});
export const CharityEvidenceResponse = z.object({
  charityId: Uuid,
  verificationState: CharityVerificationStateSchema,
  verificationSource: EvidenceSourceTypeSchema.nullable(),
  lastReviewedAt: Iso.nullable(),
  evidence: z.array(CharityEvidenceItem),
  caveat: z.string(),
  dataSource: DataSource,
});
export type CharityEvidenceResponse = z.infer<typeof CharityEvidenceResponse>;

/** 'confirmed' requires an indexed on-chain transaction (DB constraint). 'demo' is a labeled fixture record, never a transfer. */
export const DonationStatus = z.enum(DONATION_STATUSES);
export const ReceiptVerificationState = z.enum(RECEIPT_VERIFICATION_STATES);
export const Donation = z.object({
  id: Uuid,
  walletId: Uuid,
  charityId: Uuid,
  asset: z.string(),
  quantity: QuantityString,
  assetDecimals: z.number().int().min(0).max(38),
  usdReferenceCents: Cents.nullable(),
  usdReferenceSource: z.enum(USD_REFERENCE_SOURCES).nullable(),
  status: DonationStatus,
  transactionSignature: z.string().nullable(),
  donatedAt: Iso.nullable(),
  receiptId: Uuid.nullable(),
  receiptStatus: ReceiptVerificationState.nullable(),
  destinationAddress: z.string(),
  provenance: z.enum(DONATION_PROVENANCES),
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

/** A receipt is a document reference. It is not a tax receipt unless a charity issued one, and never proof of deductibility. */
export const Receipt = z.object({
  id: Uuid,
  donationId: Uuid,
  receiptReference: z.string(),
  charityReceiptReference: z.string().nullable(),
  issuedAt: Iso,
  documentUrl: HttpsUrl.nullable(),
  receiptHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  verificationState: ReceiptVerificationState,
  provenanceNote: z.string().nullable(),
  labels: z.array(z.string()),
  caveat: z.string(),
  dataSource: DataSource,
});
export type Receipt = z.infer<typeof Receipt>;
export const DonationDetail = z.object({ donation: Donation, receipt: Receipt.nullable() });
export type DonationDetail = z.infer<typeof DonationDetail>;

/** Stateless review of a planned donation. Nothing is stored, signed or sent. */
export const DonationPlanRequest = z.strictObject({
  walletId: Uuid,
  charityId: Uuid,
  asset: z.literal("USDC").default("USDC"),
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "USD amount with at most 2 decimals").refine((s) => Number(s) > 0, "must be above 0"),
});
export const DonationPlanResponse = z.object({
  walletId: Uuid,
  charity: z.object({
    id: Uuid, name: z.string(), verificationState: CharityVerificationStateSchema, verificationSource: EvidenceSourceTypeSchema.nullable(),
    dataSource: DataSource, eligible: z.boolean(), blockedReason: z.string().nullable(),
  }),
  asset: z.string(),
  quantity: QuantityString,
  assetDecimals: z.number().int().min(0).max(38),
  usdReferenceCents: Cents,
  usdReferenceSource: z.literal("USER_ENTERED_USDC_PAR"),
  usdReferenceNote: z.string(),
  feeDisclosure: z.string(),
  taxNote: z.string(),
  signingNote: z.string(),
  transfersEnabled: z.literal(false),
  disabledReason: z.string(),
  persisted: z.literal(false),
  dataSource: DataSource,
  verifiedOnChain: z.literal(false),
});
export type DonationPlanResponse = z.infer<typeof DonationPlanResponse>;

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
