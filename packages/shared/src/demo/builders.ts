import type {
  DiscoverQuery, DiscoverResponse, PortfolioResponse, TaxDetailsResponse, TaxReserveResponse, TaxResponse, TokenProof,
  TokenSummary, TransactionsResponse,
} from "../api/schemas";
import { SORT_RULES, allChecksReported, charityGeneratedCents, checksReported, discoverTokens } from "../discover";
import { splitAmount } from "../feesplit";
import { estimateTax } from "../tax/engine";
import { buildReserveState, type ReserveTargetSource } from "../reserve";
import { percentToBps } from "../feesplit";
import { centsToUsdString, parseUsdToCents } from "../money";
import { formatUnits } from "../chain/units";
import { REPORT_DISCLAIMER, REPORT_VERSION, yearBoundary, type TaxReport } from "../taxdata/report";
import {
  DEMO_ASSETS, DEMO_HOLDINGS, DEMO_REFERENCE_TIME, DEMO_RESERVE_CENTS, DEMO_TAX_ASSUMPTIONS, DEMO_TOKENS, DEMO_TRANSACTIONS,
  DEMO_WALLETS, TRANSPARENCY_CHECK_KEYS, demoRealizedEvents, type DemoToken,
} from "./fixtures";

/**
 * Pure builders that turn demo fixtures into API response bodies. The API uses them for the
 * demo-backed endpoints; the web client's mock mode calls them directly. Every response is
 * labeled dataSource "demo" and verifiedOnChain false.
 */

export const TAX_ENGINE_VERSION = "0.1.0";
export const DEMO_PROVENANCE = { dataSource: "demo", verifiedOnChain: false } as const;

export const TAX_DISCLAIMER = [
  "Estimated tax exposure is a tax planning estimate, not a tax bill or tax advice.",
  "Tax calculations are estimates and may not reflect your complete tax situation. Consult a qualified tax professional.",
];
export const TAX_LIMITATIONS = [
  "No progressive brackets, net investment income tax, capital loss limits, carryforwards, or state-specific rules.",
  "Income (airdrops, staking, creator fees) is not modeled.",
  "Wash sale treatment for digital assets is not modeled.",
];
export const DONATION_TAX_NOTE = "Potentially deductible charitable contribution. Consult a tax professional. Tax treatment depends on your circumstances and applicable law.";

const str = (n: bigint) => n.toString();
const valueCents = (balance: bigint, decimals: number, priceMicro: bigint) => (balance * priceMicro) / 10n ** BigInt(decimals) / 10_000n;

export const isDemoWallet = (walletId: string) => DEMO_WALLETS.some((w) => w.id === walletId);

export function buildPortfolio(walletId: string): PortfolioResponse | null {
  const holdings = DEMO_HOLDINGS[walletId];
  if (!holdings) return null;
  const rows = holdings.map((h) => {
    const a = DEMO_ASSETS[h.symbol]!;
    return { h, a, value: valueCents(h.balance, a.decimals, a.priceMicro) };
  });
  const total = rows.reduce((s, r) => s + r.value, 0n);
  const cost = rows.reduce((s, r) => s + r.h.costBasisCents, 0n);
  const realized = rows.reduce((s, r) => s + r.h.realizedPnlCents, 0n);
  return {
    walletId,
    totalValueCents: str(total),
    partialValueCents: str(total),
    costBasisCents: str(cost),
    realizedPnlCents: str(realized),
    unrealizedPnlCents: str(total - cost),
    valuation: { status: "demo", pricedAssets: rows.length, unpricedAssets: 0 },
    source: { kind: "demo", cluster: null, slot: null, observedAt: null, lastSyncedAt: null, holdingsComplete: true },
    assets: rows.map(({ h, a, value }) => ({
      kind: a.symbol === "SOL" ? ("native" as const) : ("spl" as const), mint: null, symbol: a.symbol, name: a.name, decimals: a.decimals,
      balance: str(h.balance), quantity: formatUnits(h.balance, a.decimals), tokenAccounts: 1, priceMicroUsd: str(a.priceMicro),
      valuation: "priced" as const, price: { source: "demo-fixture", observedAt: DEMO_REFERENCE_TIME },
      valueCents: str(value), costBasisCents: str(h.costBasisCents), unrealizedPnlCents: str(value - h.costBasisCents),
      realizedPnlCents: str(h.realizedPnlCents), allocationBps: total === 0n ? 0 : Number((value * 10_000n) / total),
      isFictionalToken: a.fictional,
      metadata: { status: "not_applicable" as const, name: null, symbol: null, uri: null, source: null, verified: false as const },
      observedSlot: null, observedAt: null,
    })),
    ...DEMO_PROVENANCE,
  };
}

export function buildTransactions(walletId: string, limit: number, offset: number): TransactionsResponse | null {
  if (!isDemoWallet(walletId)) return null;
  const all = DEMO_TRANSACTIONS.filter((t) => t.walletId === walletId).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const page = all.slice(offset, offset + limit);
  return {
    walletId,
    transactions: page.map((t) => ({
      id: t.id, signature: t.signature, timestamp: t.occurredAt, type: t.type, asset: t.symbol,
      decimals: DEMO_ASSETS[t.symbol]!.decimals, amount: str(t.amount), usdValueCents: str(t.usdValueCents),
      taxTreatment: t.taxTreatment, source: "demo" as const, explorerUrl: null,
      status: null, feeLamports: null, slot: null, classification: null, programIds: [], deltas: [],
    })),
    pagination: { limit, offset, total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null },
    window: null,
    ...DEMO_PROVENANCE,
  };
}

/** Demo realized net gains (cents) used for percentage-based reserve targets. */
export function demoTaxEstimate() {
  return estimateTax(demoRealizedEvents(), DEMO_TAX_ASSUMPTIONS);
}
export const demoNetGainsCents = () => {
  const e = demoTaxEstimate();
  return e.totalRealizedGainsCents - e.totalRealizedLossesCents;
};

export function buildTax(walletId: string): TaxResponse {
  const e = demoTaxEstimate();
  return {
    walletId,
    scope: "user",
    taxYear: e.assumptions.taxYear,
    costBasisMethod: "FIFO",
    methodSource: "demo_fixture",
    status: "COMPLETE",
    figuresComplete: true,
    calculation: null,
    requirements: [],
    estimatedRealizedGainsCents: str(e.totalRealizedGainsCents),
    estimatedRealizedLossesCents: str(e.totalRealizedLossesCents),
    estimatedShortTermNetCents: str(e.shortTermNetCents),
    estimatedLongTermNetCents: str(e.longTermNetCents),
    estimatedTaxableEvents: e.taxableEventCount,
    estimatedTaxExposureCents: str(e.estimatedExposureCents),
    assumptions: e.assumptions,
    methodology: { name: "shared-tax-engine", version: TAX_ENGINE_VERSION, limitations: TAX_LIMITATIONS },
    disclaimer: TAX_DISCLAIMER,
    ...DEMO_PROVENANCE,
  };
}

export function buildTaxDetails(walletId: string): TaxDetailsResponse | null {
  if (!isDemoWallet(walletId)) return null;
  return {
    walletId, taxYear: DEMO_TAX_ASSUMPTIONS.taxYear, costBasisMethod: "FIFO", status: "COMPLETE", realized: [], events: [], manualBasisReview: [], truncated: false,
    note: "Demo fixture: only aggregate figures exist. There are no itemized transactions behind them.", ...DEMO_PROVENANCE,
  };
}

/** Demo report: aggregate fixture figures only (the fixture has no itemized proceeds or cost basis). Labeled demo. */
export function buildDemoTaxReport(walletId: string, generatedAt: string): TaxReport | null {
  if (!isDemoWallet(walletId)) return null;
  const e = demoTaxEstimate();
  const net = e.totalRealizedGainsCents - e.totalRealizedLossesCents;
  return {
    reportVersion: REPORT_VERSION, meta: { generatedAt }, label: "ESTIMATED_TAX_REPORT", walletId, taxYear: e.assumptions.taxYear, yearBoundary: yearBoundary(e.assumptions.taxYear),
    accountingMethod: "FIFO", swapTreatment: "DISPOSAL_AND_ACQUISITION", feePolicy: "RECORDED_NOT_APPLIED", status: "COMPLETE",
    summary: { proceedsCents: null, costBasisCents: null, gainLossCents: net.toString(), shortTermGainLossCents: e.shortTermNetCents.toString(), longTermGainLossCents: e.longTermNetCents.toString(), shortTermProceedsCents: null, longTermProceedsCents: null, disposalCount: e.taxableEventCount },
    counts: { unresolvedEvents: 0, dataRequiredEvents: 0, unknownEvents: 0, matchedTransfers: 0, duplicatesIgnored: 0 },
    requirements: [{ kind: "DEMO", severity: "info", count: 1, message: "DEMO DATA: fictional aggregate figures. There are no itemized transactions, proceeds or cost basis behind them." }],
    manualBasis: { included: false, disclosure: null, records: [], recordsUnderReview: 0 },
    priceProvenance: { sources: [], observations: [], note: "Demo fixture: no prices." },
    provenance: { dataSource: "demo", verifiedOnChain: false, chainDataNote: "Nothing was read from a blockchain.", priceNote: "Demo fixture: no prices.", userProvidedNote: "No user-provided data." },
    limits: { transactionCap: 0, transactionsTruncated: false, maxRows: 0, rowsExceeded: false }, disposals: [], unresolvedEvents: [], fingerprint: "demo-fixture", reportHash: "demo-fixture", disclaimer: REPORT_DISCLAIMER,
  };
}

/** The stored reserve TARGET configuration (user configuration, never money). */
export interface StoredTarget {
  targetType: "percentage" | "amount";
  percentBps: number | null;
  targetCents: bigint | null;
  source: ReserveTargetSource;
  enabled: boolean;
  updatedAt: string;
}

/** Demo reserve: the fixture tax estimate plus a labeled fixture balance. Only demo wallets ever get a balance. */
export function buildTaxReserve(walletId: string, target: StoredTarget | null, targetDataSource: "demo" | "database"): TaxReserveResponse {
  return buildReserveState({
    walletId, taxSource: "DEMO_FIXTURE", taxStatus: "COMPLETE", exposureCents: demoTaxEstimate().estimatedExposureCents,
    netGainsCents: demoNetGainsCents(), ratesSupplied: true,
    requirements: [{ kind: "DEMO", severity: "info", count: 1, message: "DEMO DATA: fictional fixture figures. Nothing was read from a blockchain." }],
    target: target ? { ...target, dataSource: targetDataSource } : null,
    balance: { source: "DEMO_FIXTURE", cents: DEMO_RESERVE_CENTS },
  });
}

/** Parse validated target request fields into the stored representation. The source is always USER_SET here. */
export function targetFromRequest(r: { targetType: "percentage"; targetPercentage: string; enabled?: boolean } | { targetType: "amount"; targetAmount: string; enabled?: boolean }): Omit<StoredTarget, "updatedAt"> {
  const enabled = r.enabled ?? true;
  if (r.targetType === "percentage") return { targetType: "percentage", percentBps: percentToBps(r.targetPercentage), targetCents: null, source: "USER_SET", enabled };
  const cents = parseUsdToCents(r.targetAmount);
  if (cents === null) throw new Error("invalid amount");
  return { targetType: "amount", percentBps: null, targetCents: cents, source: "USER_SET", enabled };
}

const PROOF_NOTICE = "DEMO DATA. This is a fictional token. Nothing here is verified on-chain and no contract exists.";

export function summarizeToken(t: DemoToken): TokenSummary {
  return {
    id: t.id, name: t.name, symbol: t.symbol, priceMicroUsd: str(t.priceMicro), marketCapCents: str(t.marketCapCents),
    liquidityCents: str(t.liquidityCents), volume24hCents: str(t.volume24hCents), holders: t.holders, launchedAt: t.launchedAt,
    creatorConcentrationBps: t.creatorAllocationBps, charityGeneratedCents: str(charityGeneratedCents(t)),
    transparencyChecksReported: checksReported(t), transparencyChecksTotal: TRANSPARENCY_CHECK_KEYS.length,
    allTransparencyChecksReported: allChecksReported(t), dataSource: "demo",
  };
}

export function buildTokenProof(tokenId: string): TokenProof | null {
  const t = DEMO_TOKENS.find((x) => x.id === tokenId);
  if (!t) return null;
  const flow = splitAmount(t.lifetimeFeesCents, t.feeSplit);
  return {
    tokenId: t.id, name: t.name, symbol: t.symbol,
    contractAddress: null,
    creatorWallet: { address: t.creatorAddress, label: t.creatorLabel, disclosedByCreator: t.checks.creatorWalletDisclosed },
    liquidity: { amountCents: str(t.liquidityCents), lockDays: t.liquidityLockDays, lockEvidence: null },
    feeSplit: { ...t.feeSplit, label: "Configured fee split", enforcement: "not_enforced", mutability: "UNDETERMINED" },
    charity: { totalGeneratedCents: str(flow.charity), donations: t.charity.donations, charitiesSupported: t.charity.charities, lastDonationAt: t.charity.lastDonationAt },
    taxReserve: { bps: t.feeSplit.taxReserve, destination: t.creatorAddress, destinationType: "creator_controlled" },
    protocol: { bps: t.feeSplit.protocol, treasuryAddress: null },
    moneyFlowCents: { creator: str(flow.creator), taxReserve: str(flow.taxReserve), charity: str(flow.charity), protocol: str(flow.protocol) },
    mintAuthority: t.mintAuthority,
    freezeAuthority: t.freezeAuthority,
    adminStatus: t.adminPrivileges === "none" ? "No admin privileges reported (unverified)" : "Fee configuration reported as admin controlled (unverified)",
    transparencyChecksReported: t.checks,
    evidence: [],
    notice: PROOF_NOTICE,
    ...DEMO_PROVENANCE,
  };
}

export function buildDiscover(q: DiscoverQuery): DiscoverResponse {
  const { items, total } = discoverTokens(DEMO_TOKENS, q);
  return {
    tokens: items.map(summarizeToken),
    ranking: { sort: q.sort, rule: SORT_RULES[q.sort] },
    pagination: { limit: q.limit, offset: q.offset, total },
    notice: "DEMO DATA. Fictional tokens. Rankings use only the fields shown; nothing is boosted, paid, or manufactured.",
    ...DEMO_PROVENANCE,
  };
}

// ---------- charities / donations (used by the web client's mock mode; the API serves the same shapes from the database) ----------
import type { Charity, CharityEvidenceResponse, DonationDetail, DonationPlanResponse, DonationsResponse, Receipt } from "../api/schemas";
import { DEMO_CHARITIES, DEMO_DONATIONS, DEMO_EVIDENCE, DEMO_IDS, DEMO_RECEIPT } from "./fixtures";
import { GIVE_COPY, type CharityVerificationState } from "../give";

const USDC_DECIMALS = 6;
const demoQuantity = (cents: bigint) => (cents * 10n ** BigInt(USDC_DECIMALS - 2)).toString();

export function buildCharityList(): Charity[] {
  return DEMO_CHARITIES.map((c) => {
    const ev = DEMO_EVIDENCE.filter((e) => e.charityId === c.id);
    const last = ev.map((e) => e.checkedAt).sort().at(-1) ?? null;
    return {
      id: c.id, slug: c.slug, name: c.name, description: c.description, website: c.website, logoUrl: null, country: c.country, category: c.category,
      verificationState: c.state, verificationSource: c.state === "VERIFIED" ? ("FIXTURE" as const) : null,
      lastReviewedAt: last ? new Date(last).toISOString() : null, evidenceCount: ev.length,
      legalEntityIdentifier: c.legalEntityIdentifier,
      wallets: [{ id: c.wallet.id, chain: "solana" as const, address: c.wallet.address, verificationStatus: c.wallet.verification, supportedAssets: ["USDC"] }],
      dataSource: "demo" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
  });
}

export const CHARITY_EVIDENCE_CAVEAT = "Evidence lists what was checked and when. It is not a guarantee about the organization, and a website alone does not prove legitimacy.";

export function buildCharityEvidence(charityId: string): CharityEvidenceResponse | null {
  const c = buildCharityList().find((x) => x.id === charityId);
  if (!c) return null;
  return {
    charityId, verificationState: c.verificationState, verificationSource: c.verificationSource, lastReviewedAt: c.lastReviewedAt,
    evidence: DEMO_EVIDENCE.filter((e) => e.charityId === charityId).map((e) => ({
      id: e.id, sourceType: "FIXTURE" as const, sourceRef: "demo-fixture", sourceUrl: null, status: e.status,
      checkedAt: new Date(e.checkedAt).toISOString(), reviewedBy: "NOT_RECORDED" as const, publicSummary: e.publicSummary, dataSource: "demo" as const,
    })),
    caveat: CHARITY_EVIDENCE_CAVEAT, dataSource: "demo",
  };
}

const demoReceiptView = (): Receipt => ({
  id: DEMO_RECEIPT.id, donationId: DEMO_RECEIPT.donationId, receiptReference: DEMO_RECEIPT.receiptReference, charityReceiptReference: null,
  issuedAt: new Date(DEMO_RECEIPT.issuedAt).toISOString(), documentUrl: null, receiptHash: null, verificationState: "UNVERIFIED",
  provenanceNote: "Fixture receipt for development.", labels: [GIVE_COPY.demoReceipt, GIVE_COPY.fixtureData, GIVE_COPY.notTaxReceipt],
  caveat: GIVE_COPY.receiptCaveat, dataSource: "demo",
});

const demoDonation = (d: (typeof DEMO_DONATIONS)[number]): DonationsResponse["donations"][number] => {
  const c = DEMO_CHARITIES.find((x) => x.id === d.charityId)!;
  const hasReceipt = d.id === DEMO_RECEIPT.donationId;
  return {
    id: d.id, walletId: d.walletId, charityId: d.charityId, asset: "USDC", quantity: demoQuantity(d.amountCents), assetDecimals: USDC_DECIMALS,
    usdReferenceCents: d.amountCents.toString(), usdReferenceSource: "FIXTURE", status: "demo" as const, transactionSignature: null, donatedAt: null,
    receiptId: hasReceipt ? DEMO_RECEIPT.id : null, receiptStatus: hasReceipt ? ("UNVERIFIED" as const) : null, destinationAddress: c.wallet.address,
    provenance: "DEMO_FIXTURE" as const, createdAt: d.createdAt, dataSource: "demo" as const, taxNote: DONATION_TAX_NOTE,
  };
};

export function buildDonations(walletId: string): DonationsResponse | null {
  if (!isDemoWallet(walletId)) return null;
  const donations = DEMO_DONATIONS.filter((d) => d.walletId === walletId).map(demoDonation);
  const demoTotal = donations.reduce((s, d) => s + BigInt(d.usdReferenceCents ?? "0"), 0n);
  return { walletId, donations, confirmedTotalCents: "0", demoTotalCents: demoTotal.toString(), taxNote: DONATION_TAX_NOTE, ...DEMO_PROVENANCE };
}

export function buildDonationDetail(donationId: string): DonationDetail | null {
  const d = DEMO_DONATIONS.find((x) => x.id === donationId);
  if (!d) return null;
  return { donation: demoDonation(d), receipt: d.id === DEMO_RECEIPT.donationId ? demoReceiptView() : null };
}

export function buildReceipt(receiptId: string): Receipt | null {
  return receiptId === DEMO_RECEIPT.id ? demoReceiptView() : null;
}

/**
 * Pure review of a planned donation, shared by the API and mock mode. Nothing is stored, signed or sent.
 * A charity is eligible only when VERIFIED; a fixture verification is flagged and is never presented as real-world.
 */
export function buildDonationPlan(a: {
  walletId: string; charity: Pick<Charity, "id" | "name" | "verificationState" | "verificationSource" | "dataSource">;
  hasVerifiedWalletForAsset: boolean; amountUsdCents: bigint; walletDataSource: "demo" | "database" | "chain";
}): DonationPlanResponse {
  const state: CharityVerificationState = a.charity.verificationState;
  const eligible = state === "VERIFIED" && a.hasVerifiedWalletForAsset;
  const blockedReason = eligible ? null
    : state !== "VERIFIED" ? `This charity's verification status is ${state.replace("_", " ")}.`
    : "This charity has no verified wallet that supports this asset.";
  return {
    walletId: a.walletId,
    charity: { ...a.charity, eligible, blockedReason },
    asset: "USDC", quantity: demoQuantity(a.amountUsdCents), assetDecimals: USDC_DECIMALS,
    usdReferenceCents: a.amountUsdCents.toString(), usdReferenceSource: "USER_ENTERED_USDC_PAR",
    usdReferenceNote: `${GIVE_COPY.usdReference} Assumes 1 USDC = 1 USD; this is not a market quote.`,
    feeDisclosure: "A future transfer would pay a Solana network fee from your wallet. No fee is estimated here and none is charged now.",
    taxNote: DONATION_TAX_NOTE, signingNote: GIVE_COPY.futureSigning,
    transfersEnabled: false, disabledReason: GIVE_COPY.transfersDisabled, persisted: false,
    dataSource: a.walletDataSource, verifiedOnChain: false,
  };
}

// ---------- demo launch (mock mode only; labeled DEMO DATA, NOT DEPLOYED, NOT VERIFIED ON-CHAIN) ----------
import { LaunchConfigSchema, type Launch, type PublicLaunch } from "../api/schemas";
import { launchFingerprint, toPublicLaunch, STATUS_MEANING } from "../launchModel";

const DEMO_LAUNCH_CONFIG = () => LaunchConfigSchema.parse({
  name: "Harbor Demo Launch", symbol: "HRBRD", description: "Fictional demo configuration. Nothing is deployed.", totalSupply: "1000000000", decimals: 6, network: "devnet",
  creatorAllocationPercent: "8", creatorWallet: DEMO_WALLETS[1]!.address,
  liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 30 },
  feeSplit: { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 }, charityConfiguration: { charityId: DEMO_IDS.charities.c1 },
  taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: DEMO_WALLETS[1]!.address },
});

export function buildDemoLaunch(): Launch {
  const config = DEMO_LAUNCH_CONFIG();
  return {
    id: DEMO_IDS.launch, status: "READY", statusMeaning: STATUS_MEANING.READY, config, review: null, fingerprint: launchFingerprint(config), revision: 5, publicVisible: true,
    readyAt: "2026-01-01T00:00:00.000Z", deployment: { status: "not_deployed", mintAddress: null, transactionSignature: null, contractAddress: null },
    metadata: { source: "USER_PROVIDED", verifiedOnChain: false }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", dataSource: "demo",
  };
}

export function buildDemoPublicLaunch(): PublicLaunch {
  const c = buildCharityList().find((x) => x.id === DEMO_IDS.charities.c1)!;
  return toPublicLaunch(buildDemoLaunch(), { id: c.id, name: c.name, verificationState: c.verificationState, verificationSource: c.verificationSource, lastReviewedAt: c.lastReviewedAt, dataSource: c.dataSource });
}
