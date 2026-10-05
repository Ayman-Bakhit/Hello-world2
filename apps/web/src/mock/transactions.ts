import type { Transaction } from "@/lib/types";

/** DEMO transactions. Signatures are placeholders and do not exist on any chain. */
export const DEMO_TRANSACTIONS: Transaction[] = [
  { id: "t1", signature: "DEMO-SIG-0001", occurredAt: "2026-10-03T13:41:00Z", kind: "swap", assetSymbol: "BONK", decimals: 5, amount: 40_000_000n * 10n ** 5n, usdValueCents: 64_000n, taxTreatment: "disposal", walletLabel: "Trading" },
  { id: "t2", signature: "DEMO-SIG-0002", occurredAt: "2026-10-01T09:12:00Z", kind: "transfer_in", assetSymbol: "USDC", decimals: 6, amount: 2_000n * 10n ** 6n, usdValueCents: 200_000n, taxTreatment: "none", walletLabel: "Trading" },
  { id: "t3", signature: "DEMO-SIG-0003", occurredAt: "2026-09-27T17:55:00Z", kind: "swap", assetSymbol: "SOL", decimals: 9, amount: 12n * 10n ** 9n, usdValueCents: 171_000n, taxTreatment: "disposal", walletLabel: "Trading" },
  { id: "t4", signature: "DEMO-SIG-0004", occurredAt: "2026-09-22T16:20:00Z", kind: "donation", assetSymbol: "USDC", decimals: 6, amount: 500n * 10n ** 6n, usdValueCents: 50_000n, taxTreatment: "none", walletLabel: "Trading" },
  { id: "t5", signature: "DEMO-SIG-0005", occurredAt: "2026-09-18T11:03:00Z", kind: "swap", assetSymbol: "HRBR", decimals: 6, amount: 600_000n * 10n ** 6n, usdValueCents: 129_000n, taxTreatment: "disposal", walletLabel: "Creator" },
  { id: "t6", signature: "DEMO-SIG-0006", occurredAt: "2026-09-10T06:30:00Z", kind: "fee_in", assetSymbol: "USDC", decimals: 6, amount: 1_240n * 10n ** 6n, usdValueCents: 124_000n, taxTreatment: "income", walletLabel: "Creator" },
  { id: "t7", signature: "DEMO-SIG-0007", occurredAt: "2026-09-02T20:14:00Z", kind: "swap", assetSymbol: "JUP", decimals: 6, amount: 900n * 10n ** 6n, usdValueCents: 78_000n, taxTreatment: "disposal", walletLabel: "Trading" },
  { id: "t8", signature: "DEMO-SIG-0008", occurredAt: "2026-08-29T15:48:00Z", kind: "transfer_out", assetSymbol: "SOL", decimals: 9, amount: 5n * 10n ** 9n, usdValueCents: 71_200n, taxTreatment: "none", walletLabel: "Trading" },
];
