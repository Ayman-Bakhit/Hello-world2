import type { Charity as ApiCharity, DonationsResponse, PortfolioResponse, TransactionsResponse } from "@project-name/shared";
import { formatAmount } from "./format";
import type { PortfolioRow } from "./portfolio";
import type { Charity, Donation, Transaction } from "./types";

/**
 * API response -> the view types the existing components already render. Money arrives as integer strings and is
 * converted with BigInt here; nothing is rounded through floating point except chart/sort helpers.
 */

export const shortMint = (m: string) => (m.length > 12 ? `${m.slice(0, 4)}…${m.slice(-4)}` : m);
const big = (v: string | null): bigint | null => (v === null ? null : BigInt(v));

export function portfolioRowsFromApi(p: PortfolioResponse): PortfolioRow[] {
  return p.assets.map((a) => ({
    key: a.mint ?? a.symbol ?? "native",
    // SPL tokens are identified by mint. A symbol/name from token metadata is untrusted and is never promoted to the identity column.
    symbol: a.mint ? shortMint(a.mint) : (a.symbol ?? "—"),
    name: a.name ?? "",
    isDemoToken: a.isFictionalToken,
    balanceDisplay: formatAmount(BigInt(a.balance), a.decimals, 4),
    quantityExact: a.quantity,
    balanceNum: Number(BigInt(a.balance)) / 10 ** a.decimals,
    priceMicro: big(a.priceMicroUsd),
    valueCents: big(a.valueCents),
    costBasisCents: big(a.costBasisCents),
    unrealizedCents: big(a.unrealizedPnlCents),
    realizedCents: big(a.realizedPnlCents),
    allocationBps: a.allocationBps,
    valuation: a.valuation,
    mint: a.mint,
    metadata: { status: a.metadata.status, name: a.metadata.name, symbol: a.metadata.symbol },
  }));
}

/** Only ever link to the Solana explorer for a transaction signature. The API builds this URL; this is defense in depth. */
export const safeExplorerUrl = (u: string | null): string | null => (u && /^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]+(\?cluster=[a-z]+)?$/.test(u) ? u : null);

export function transactionsFromApi(t: TransactionsResponse, walletLabel: string): Transaction[] {
  return t.transactions.map((x) => ({
    id: x.id,
    signature: x.signature,
    occurredAt: x.timestamp,
    kind: x.type,
    assetSymbol: x.asset,
    decimals: x.decimals,
    amount: BigInt(x.amount),
    usdValueCents: big(x.usdValueCents),
    taxTreatment: x.taxTreatment,
    walletLabel,
    ...(x.source === "chain"
      ? { live: { status: x.status, feeLamports: big(x.feeLamports), explorerUrl: safeExplorerUrl(x.explorerUrl), reason: x.classification?.reason ?? null, deltaCount: x.deltas.length } }
      : {}),
  }));
}

export function charityFromApi(c: ApiCharity): Charity {
  const walletsVerified = c.wallets.some((w) => w.verificationStatus === "verified");
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? "",
    category: c.category ?? "Uncategorized",
    country: c.country ?? "",
    // "verified" only when the API says the organization is verified AND at least one wallet is.
    verification: c.verificationStatus === "verified" && !walletsVerified ? "pending" : c.verificationStatus,
    verificationNote:
      c.dataSource === "demo"
        ? "Demo record. The real admin review workflow is not implemented."
        : c.verificationStatus === "verified" ? "Verified by admin review." : "Not verified: cannot receive donations.",
    dataSource: c.dataSource,
  };
}

export function donationsFromApi(d: DonationsResponse): Donation[] {
  return d.donations.map((x) => ({
    id: x.id,
    charityId: x.charityId,
    assetSymbol: x.asset,
    amountCents: BigInt(x.amountUsdCents),
    occurredAt: x.createdAt,
    // The UI vocabulary keeps the API's status; only "confirmed" means an on-chain transaction exists.
    status: x.status as Donation["status"],
    receiptRef: x.receiptReference ?? "",
    signature: x.transactionSignature ?? "",
  }));
}
