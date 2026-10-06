import { percentToBps } from "@project-name/shared";
import { parseFeeDrafts } from "./feeDrafts";
import type { LaunchConfiguration } from "./types";

export const LAUNCH_STEPS = [
  { id: "connect", title: "Connect wallet" },
  { id: "create", title: "Create token" },
  { id: "info", title: "Token information" },
  { id: "supply", title: "Supply" },
  { id: "liquidity", title: "Liquidity" },
  { id: "fees", title: "Fee configuration" },
  { id: "charity", title: "Charity configuration" },
  { id: "reserve", title: "Tax reserve configuration" },
  { id: "review", title: "Review" },
  { id: "deploy", title: "Deploy" },
  { id: "verify", title: "Verify" },
  { id: "publish", title: "Publish" },
] as const;
export type LaunchStepId = (typeof LAUNCH_STEPS)[number]["id"];

const isPosInt = (s: string) => /^[1-9]\d*$/.test(s.trim());
const isNonNegInt = (s: string) => /^\d+$/.test(s.trim());

export function effectiveWalletId(id: string, ctx: StepContext): string {
  return ctx.walletIds.includes(id) ? id : (ctx.walletIds[0] ?? "");
}

export interface StepContext {
  walletConnected: boolean;
  verifiedCharityIds: string[];
  walletIds: string[];
}

/** Pure per-step validation. Empty array = step is valid. */
export function stepErrors(step: LaunchStepId, c: LaunchConfiguration, ctx: StepContext): string[] {
  const e: string[] = [];
  switch (step) {
    case "connect":
      if (!ctx.walletConnected) e.push("Connect and sign in with a wallet to continue.");
      break;
    case "info":
      if (c.name.trim().length < 1 || c.name.trim().length > 32) e.push("Token name must be 1 to 32 characters.");
      if (!/^[A-Z0-9]{2,10}$/.test(c.symbol)) e.push("Symbol must be 2 to 10 characters, A-Z and 0-9.");
      if (c.description.length > 280) e.push("Description must be 280 characters or fewer.");
      break;
    case "supply": {
      if (!isPosInt(c.totalSupply)) e.push("Total supply must be a positive whole number.");
      if (!isNonNegInt(c.decimals) || Number(c.decimals) > 9) e.push("Decimals must be a whole number from 0 to 9.");
      try {
        const bps = percentToBps(c.creatorAllocationPercent);
        if (bps > 10_000) e.push("Creator allocation cannot exceed 100%.");
      } catch {
        e.push("Creator allocation must be a percent with at most 2 decimals.");
      }
      if (effectiveWalletId(c.creatorWalletId, ctx) === "") e.push("Connect a wallet to act as the creator wallet.");
      break;
    }
    case "liquidity": {
      if (!isPosInt(c.liquidityUsdc)) e.push("Initial USDC liquidity must be a positive whole number.");
      try {
        const bps = percentToBps(c.liquiditySupplyPercent);
        if (bps <= 0 || bps > 10_000) e.push("Supply paired into liquidity must be above 0% and at most 100%.");
      } catch {
        e.push("Supply paired into liquidity must be a percent with at most 2 decimals.");
      }
      if (!isNonNegInt(c.liquidityLockDays)) e.push("Lock days must be a whole number (0 means no lock).");
      break;
    }
    case "fees":
      e.push(...parseFeeDrafts(c.feeDrafts).messages);
      break;
    case "charity":
      if (!ctx.verifiedCharityIds.includes(c.charityId)) e.push("Select a verified charity.");
      break;
    case "reserve":
      if (effectiveWalletId(c.reserveWalletId, ctx) === "") e.push("Connect a wallet to use as the creator-controlled reserve destination.");
      break;
    default:
      break;
  }
  return e;
}

const ORDER: LaunchStepId[] = LAUNCH_STEPS.map((s) => s.id);

/** All validation errors up to and including `upTo`, tagged with their step. */
export function allErrors(c: LaunchConfiguration, ctx: StepContext, upTo: LaunchStepId = "reserve") {
  const out: Array<{ step: LaunchStepId; message: string }> = [];
  for (const id of ORDER.slice(0, ORDER.indexOf(upTo) + 1)) {
    for (const message of stepErrors(id, c, ctx)) out.push({ step: id, message });
  }
  return out;
}
