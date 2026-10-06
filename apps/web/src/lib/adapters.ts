import type { Charity as ApiCharity, DonationsResponse, PortfolioResponse, TransactionsResponse } from "@project-name/shared";
import { formatAmount } from "./format";
import type { PortfolioRow } from "./portfolio";
import type { Charity, Donation, Transaction } from "./types";

/**
 * API response -> the view types the existing components already render. Money arrives as integer strings and is
 * converted with BigInt here; nothing is rounded through floating point except chart/sort helpers.
 */

export function portfolioRowsFromApi(p: PortfolioResponse): PortfolioRow[] {
  return p.assets.map((a) => ({
    symbol: a.symbol,
    name: a.name,
    isDemoToken: a.isFictionalToken,
    balanceDisplay: formatAmount(BigInt(a.balance), a.decimals, 2),
    balanceNum: Number(BigInt(a.balance)) / 10 ** a.decimals,
    priceMicro: BigInt(a.priceMicroUsd),
    valueCents: BigInt(a.valueCents),
    costBasisCents: BigInt(a.costBasisCents),
    unrealizedCents: BigInt(a.unrealizedPnlCents),
    realizedCents: BigInt(a.realizedPnlCents),
    allocationBps: a.allocationBps,
  }));
}

export function transactionsFromApi(t: TransactionsResponse, walletLabel: string): Transaction[] {
  return t.transactions.map((x) => ({
    id: x.id,
    signature: x.signature,
    occurredAt: x.timestamp,
    kind: x.type,
    assetSymbol: x.asset,
    decimals: x.decimals,
    amount: BigInt(x.amount),
    usdValueCents: BigInt(x.usdValueCents),
    taxTreatment: x.taxTreatment,
    walletLabel,
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
