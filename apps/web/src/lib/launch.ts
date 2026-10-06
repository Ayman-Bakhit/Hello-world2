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
  { id: "deploy", title: "Deploy (unavailable)" },
  { id: "verify", title: "Verify (unavailable)" },
  { id: "publish", title: "Publish (unavailable)" },
] as const;
export type LaunchStepId = (typeof LAUNCH_STEPS)[number]["id"];

const isPosInt = (s: string) => /^[1-9]\d*$/.test(s.trim());
const isNonNegInt = (s: string) => /^\d+$/.test(s.trim());

export function effectiveWalletId(id: string, ctx: StepContext): string {
  return ctx.walletIds.includes(id) ? id : (ctx.walletIds[0] ?? "");
}

/** "" means "the first verified charity". An explicit id must be verified (an unverified one is an error, not silently replaced). */
export function effectiveCharityId(id: string, ctx: StepContext): string {
  return id === "" ? (ctx.verifiedCharityIds[0] ?? "") : id;
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
      if (!ctx.verifiedCharityIds.includes(effectiveCharityId(c.charityId, ctx))) e.push("Select a verified charity.");
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

/** The steps after "reserve" that exist only as unavailable placeholders. Nothing past "deploy" can be reached. */
export const LAST_REACHABLE_STEP: LaunchStepId = "deploy";

export interface LaunchRequestContext {
  creatorAddress: string;
  reserveAddress: string;
  charityId: string;
}

/**
 * Wizard state -> POST /api/launches body. Pure. The fee split is parsed by the shared validator; if it is invalid this
 * throws, so an invalid split can never be sent.
 */
export function toLaunchRequest(c: LaunchConfiguration, r: LaunchRequestContext) {
  const fee = parseFeeDrafts(c.feeDrafts);
  if (!fee.split) throw new Error("Fee split is invalid");
  return {
    name: c.name.trim(),
    symbol: c.symbol,
    description: c.description,
    totalSupply: c.totalSupply.trim(),
    decimals: Number(c.decimals),
    creatorAllocationPercent: c.creatorAllocationPercent.trim(),
    creatorWallet: r.creatorAddress,
    mintAuthority: c.mintAuthority,
    freezeAuthority: c.freezeAuthority,
    updateAuthority: c.updateAuthority,
    liquidityConfiguration: {
      initialLiquidityUsdc: c.liquidityUsdc.trim(),
      supplyPercentage: c.liquiditySupplyPercent.trim(),
      lockDays: Number(c.liquidityLockDays),
    },
    feeSplit: fee.split,
    charityConfiguration: { charityId: r.charityId },
    taxReserveConfiguration: { destinationType: "creator_controlled" as const, destinationAddress: r.reserveAddress },
  };
}
