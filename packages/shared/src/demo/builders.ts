import type {
  DiscoverQuery, DiscoverResponse, PortfolioResponse, TaxReserveResponse, TaxResponse, TokenProof,
  TokenSummary, TransactionsResponse,
} from "../api/schemas";
import { SORT_RULES, allChecksReported, charityGeneratedCents, checksReported, discoverTokens } from "../discover";
import { splitAmount } from "../feesplit";
import { percentOfGains, estimateTax, reserveStatus } from "../tax/engine";
import { percentToBps } from "../feesplit";
import { centsToUsdString, parseUsdToCents } from "../money";
import { formatUnits } from "../chain/units";
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

export interface StoredTarget {
  targetType: "percentage" | "amount";
  percentBps: number | null;
  targetCents: bigint | null;
  updatedAt: string;
}

export function resolveTargetCents(t: StoredTarget | null, netGainsCents: bigint): bigint | null {
  if (!t) return null;
  return t.targetType === "percentage" ? percentOfGains(netGainsCents, t.percentBps ?? 0) : t.targetCents;
}

export function buildTaxReserve(walletId: string, target: StoredTarget | null, targetDataSource: "demo" | "database"): TaxReserveResponse {
  const exposure = demoTaxEstimate().estimatedExposureCents;
  const s = reserveStatus(DEMO_RESERVE_CENTS, exposure);
  const resolved = resolveTargetCents(target, demoNetGainsCents());
  return {
    walletId,
    scope: "user",
    currency: "USDC",
    currentReserveCents: str(DEMO_RESERVE_CENTS),
    reserveDataSource: "demo",
    estimatedTaxExposureCents: str(exposure),
    coverageBps: s.coverageBps,
    recommendedAdditionalReserveCents: str(s.recommendedAdditionalCents),
    target: target
      ? {
          targetType: target.targetType,
          targetPercentage: target.targetType === "percentage" ? centsToPercentString(target.percentBps ?? 0) : null,
          targetAmount: target.targetType === "amount" && target.targetCents !== null ? centsToUsdString(target.targetCents) : null,
          currency: "USDC",
          updatedAt: target.updatedAt,
        }
      : null,
    resolvedTargetCents: resolved === null ? null : str(resolved),
    targetDataSource,
    custody: "none",
    disclaimer: ["Estimated tax reserve: a voluntary planning target. This API never moves funds.", ...TAX_DISCLAIMER],
    ...DEMO_PROVENANCE,
  };
}

const centsToPercentString = (bps: number) => `${Math.floor(bps / 100)}${bps % 100 ? "." + String(bps % 100).padStart(2, "0").replace(/0$/, "") : ""}`;

/** Parse validated target request fields into the stored representation. */
export function targetFromRequest(r: { targetType: "percentage"; targetPercentage: string } | { targetType: "amount"; targetAmount: string }): Omit<StoredTarget, "updatedAt"> {
  if (r.targetType === "percentage") return { targetType: "percentage", percentBps: percentToBps(r.targetPercentage), targetCents: null };
  const cents = parseUsdToCents(r.targetAmount);
  if (cents === null) throw new Error("invalid amount");
  return { targetType: "amount", percentBps: null, targetCents: cents };
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
import type { Charity, DonationsResponse } from "../api/schemas";
import { DEMO_CHARITIES, DEMO_DONATIONS } from "./fixtures";

export function buildCharityList(): Charity[] {
  return DEMO_CHARITIES.map((c) => ({
    id: c.id, name: c.name, description: c.description, website: c.website, country: c.country, category: c.category,
    verificationStatus: c.verification, legalEntityIdentifier: c.legalEntityIdentifier,
    wallets: [{ id: c.wallet.id, chain: "solana" as const, address: c.wallet.address, verificationStatus: c.wallet.verification, supportedAssets: ["USDC"] }],
    dataSource: "demo" as const, createdAt: "2026-01-01T00:00:00.000Z",
  }));
}

export function buildDonations(walletId: string): DonationsResponse | null {
  if (!isDemoWallet(walletId)) return null;
  const donations = DEMO_DONATIONS.filter((d) => d.walletId === walletId).map((d) => {
    const c = DEMO_CHARITIES.find((x) => x.id === d.charityId)!;
    return {
      id: d.id, walletId: d.walletId, charityId: d.charityId, asset: "USDC", amountUsdCents: d.amountCents.toString(),
      status: "demo" as const, transactionSignature: null, receiptReference: null, destinationAddress: c.wallet.address,
      createdAt: d.createdAt, dataSource: "demo" as const, taxNote: DONATION_TAX_NOTE,
    };
  });
  const demoTotal = donations.reduce((s, d) => s + BigInt(d.amountUsdCents), 0n);
  return { walletId, donations, confirmedTotalCents: "0", demoTotalCents: demoTotal.toString(), taxNote: DONATION_TAX_NOTE, ...DEMO_PROVENANCE };
}
