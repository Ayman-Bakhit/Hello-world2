import { percentToBps, splitAmount, validateFeeSplit } from "./feesplit";
import type { LaunchConfig, LaunchReview } from "./api/schemas";

export interface ReviewContext {
  /** Public addresses of wallets the actor has registered. */
  ownedWalletAddresses: string[];
  charity: { verified: boolean; hasVerifiedWallet: boolean } | null;
  now: Date;
}

/**
 * Server-side launch review. Pure. Re-validates everything, including the fee split via the shared
 * implementation. Never marks a launch deployable: no deployment path exists in this slice.
 */
export function reviewLaunchConfig(c: LaunchConfig, ctx: ReviewContext): LaunchReview {
  const errors: LaunchReview["errors"] = [];
  const warnings: string[] = [];

  for (const e of validateFeeSplit(c.feeSplit)) {
    errors.push({ field: "feeSplit", message: e.code === "SUM_MISMATCH" ? `Fee split totals ${e.sum} basis points; it must be exactly 10000.` : `${e.bucket}: ${e.code}` });
  }
  if (!ctx.ownedWalletAddresses.includes(c.creatorWallet)) errors.push({ field: "creatorWallet", message: "Creator wallet is not one of your registered wallets." });
  if (!ctx.ownedWalletAddresses.includes(c.taxReserveConfiguration.destinationAddress)) {
    errors.push({ field: "taxReserveConfiguration.destinationAddress", message: "Tax reserve destination must be a wallet you control." });
  }
  if (!ctx.charity) errors.push({ field: "charityConfiguration.charityId", message: "Charity not found." });
  else if (!ctx.charity.verified) errors.push({ field: "charityConfiguration.charityId", message: "Charity is not verified." });
  else if (!ctx.charity.hasVerifiedWallet) errors.push({ field: "charityConfiguration.charityId", message: "Charity has no verified wallet." });

  const alloc = percentToBps(c.creatorAllocationPercent);
  const liq = percentToBps(c.liquidityConfiguration.supplyPercentage);
  if (alloc + liq > 10_000) errors.push({ field: "supply", message: "Creator allocation plus liquidity supply exceeds 100% of supply." });

  if (c.mintAuthority === "creator") warnings.push("Mint authority stays with the creator: supply can be increased.");
  if (c.freezeAuthority === "creator") warnings.push("Freeze authority stays with the creator: holders can be frozen.");
  if (c.liquidityConfiguration.lockDays === 0) warnings.push("No liquidity lock configured.");
  if (alloc > 2_000) warnings.push("Creator allocation above 20% of supply.");
  warnings.push("No contract exists: this is a configured fee split, not enforced on-chain.");

  const flow = errors.some((e) => e.field === "feeSplit")
    ? { creator: 0n, taxReserve: 0n, charity: 0n, protocol: 0n }
    : splitAmount(100_000n, c.feeSplit);

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    moneyFlowExampleCents: { creator: String(flow.creator), taxReserve: String(flow.taxReserve), charity: String(flow.charity), protocol: String(flow.protocol) },
    feeSplitLabel: "Configured fee split",
    feeSplitEnforcement: "not_enforced",
    deployable: false,
    reviewedAt: ctx.now.toISOString(),
  };
}
