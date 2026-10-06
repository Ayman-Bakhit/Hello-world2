import type { Charity, Donation } from "@/lib/types";

/** Fictional organizations. Real onboarding requires admin verification of the entity AND each wallet. */
export const DEMO_CHARITIES: Charity[] = [
  {
    id: "c1", name: "Open Water Initiative (demo)", category: "Clean water", country: "US",
    description: "Fictional demo charity funding community water systems.",
    dataSource: "demo", verification: "verified", verificationNote: "Demo status. The real review workflow is not implemented.",
  },
  {
    id: "c2", name: "Clear Sky Education Fund (demo)", category: "Education", country: "US",
    description: "Fictional demo charity for scholarships and classroom grants.",
    dataSource: "demo", verification: "verified", verificationNote: "Demo status. The real review workflow is not implemented.",
  },
  {
    id: "c3", name: "Harvest Table Network (demo)", category: "Hunger relief", country: "CA",
    description: "Fictional demo charity coordinating regional food banks.",
    dataSource: "demo", verification: "verified", verificationNote: "Demo status. The real review workflow is not implemented.",
  },
  {
    id: "c4", name: "Reforest Together (demo)", category: "Environment", country: "US",
    description: "Fictional demo charity. Shown as pending to illustrate that unverified wallets cannot receive funds.",
    dataSource: "demo", verification: "pending", verificationNote: "Pending admin review. Donations are disabled until verified.",
  },
];

/** Confirmed donations sum to $1,840.00. */
export const DEMO_DONATIONS: Donation[] = [
  { id: "d1", charityId: "c1", assetSymbol: "USDC", amountCents: 50_000n, occurredAt: "2026-09-22T16:20:00Z", status: "confirmed", receiptRef: "DEMO-RCPT-0001", signature: "DEMO-SIG-D001" },
  { id: "d2", charityId: "c2", assetSymbol: "USDC", amountCents: 25_000n, occurredAt: "2026-09-05T10:02:00Z", status: "confirmed", receiptRef: "DEMO-RCPT-0002", signature: "DEMO-SIG-D002" },
  { id: "d3", charityId: "c3", assetSymbol: "USDC", amountCents: 10_000n, occurredAt: "2026-08-30T08:45:00Z", status: "confirmed", receiptRef: "DEMO-RCPT-0003", signature: "DEMO-SIG-D003" },
  { id: "d4", charityId: "c1", assetSymbol: "USDC", amountCents: 84_000n, occurredAt: "2026-08-14T19:11:00Z", status: "confirmed", receiptRef: "DEMO-RCPT-0004", signature: "DEMO-SIG-D004" },
  { id: "d5", charityId: "c3", assetSymbol: "USDC", amountCents: 15_000n, occurredAt: "2026-07-31T12:30:00Z", status: "confirmed", receiptRef: "DEMO-RCPT-0005", signature: "DEMO-SIG-D005" },
  { id: "d6", charityId: "c2", assetSymbol: "USDC", amountCents: 10_000n, occurredAt: "2026-10-03T09:00:00Z", status: "pending", receiptRef: "DEMO-RCPT-0006", signature: "DEMO-SIG-D006" },
];

export const DEMO_GIVING_RULES = ["5% of realized gains", "1% of creator fees", "$100 / month"] as const;
