/**
 * The canonical token supply model (fixed in this version of the launchpad). Pure. No I/O.
 *
 * Three different quantities, never conflated:
 *   INTENDED supply   the maximum the launch is defined around (the configuration's total supply). It is NOT what exists on-chain.
 *   MINTED supply     what is actually created on-chain: the sum of the ISSUED roles (creator + liquidity = 48%).
 *   UNISSUED supply   the PERMANENTLY_UNISSUED role (52%): tokens that are never minted. They are not burned (burning destroys tokens
 *                     that existed) and they do not exist on-chain. "Permanent" holds only once the mint authority is revoked,
 *                     because whoever holds the mint authority could otherwise still mint them.
 *
 * Example, intended supply 100,000,000: creator 8,000,000 + liquidity 40,000,000 = 48,000,000 minted; 52,000,000 permanently
 * unissued. An observer of the chain should see a supply of 48,000,000, not 100,000,000.
 */
import { TOTAL_BPS } from "./feesplit";
import { MAX_U64 } from "./launchConstants";

export const SUPPLY_ROLES = ["CREATOR", "LIQUIDITY", "CHARITY", "TAX_RESERVE", "PROTOCOL", "PERMANENTLY_UNISSUED"] as const;
export type SupplyRole = (typeof SUPPLY_ROLES)[number];
/** Roles whose tokens are minted. Everything else is never created. */
export const ISSUED_ROLES: readonly SupplyRole[] = ["CREATOR", "LIQUIDITY", "CHARITY", "TAX_RESERVE", "PROTOCOL"];
export const isIssuedRole = (r: SupplyRole): boolean => ISSUED_ROLES.includes(r);

/** The fixed allocation. Not configurable per launch, and there is no editor for it. */
export const CANONICAL_SUPPLY_ALLOCATION: Readonly<Record<SupplyRole, number>> = Object.freeze({
  CREATOR: 800, LIQUIDITY: 4000, CHARITY: 0, TAX_RESERVE: 0, PROTOCOL: 0, PERMANENTLY_UNISSUED: 5200,
});

export const SUPPLY_MODEL_COPY = {
  unissued: "Permanently unissued supply is never minted. It is not burned, and it does not exist on-chain.",
  intended: "Intended supply is the maximum the launch is defined around. It is not the amount that exists on-chain.",
  permanence: "Unissued supply is permanent only once the mint authority is revoked; until then the mint authority could still create it.",
} as const;

export const bpsSum = (m: Readonly<Record<SupplyRole, number>>): number => SUPPLY_ROLES.reduce((a, r) => a + m[r], 0);
export const issuedBps = (m: Readonly<Record<SupplyRole, number>>): number => ISSUED_ROLES.reduce((a, r) => a + m[r], 0);

export interface SupplyBreakdown {
  intendedRaw: bigint; mintedRaw: bigint; unissuedRaw: bigint;
  roles: Array<{ role: SupplyRole; bps: number; raw: bigint; issued: boolean }>;
}
export type SupplyBreakdownResult = { ok: true; value: SupplyBreakdown } | { ok: false; reason: "INVALID_SUPPLY" | "OVERFLOW" | "NOT_WHOLE_UNITS" | "DOES_NOT_SUM"; role?: SupplyRole };

/**
 * Exact split of an intended supply into the roles of an allocation (default: the canonical one). Whole base units only: a share that
 * would need rounding is refused, never rounded. Integer arithmetic only.
 */
export function supplyBreakdown(totalSupply: string, decimals: number, allocation: Readonly<Record<SupplyRole, number>> = CANONICAL_SUPPLY_ALLOCATION): SupplyBreakdownResult {
  if (!/^[1-9]\d{0,29}$/.test(totalSupply) || !Number.isInteger(decimals) || decimals < 0 || decimals > 9) return { ok: false, reason: "INVALID_SUPPLY" };
  const intendedRaw = BigInt(totalSupply) * 10n ** BigInt(decimals);
  if (intendedRaw > MAX_U64) return { ok: false, reason: "OVERFLOW" };
  if (bpsSum(allocation) !== TOTAL_BPS || SUPPLY_ROLES.some((r) => !Number.isSafeInteger(allocation[r]) || allocation[r] < 0)) return { ok: false, reason: "DOES_NOT_SUM" };
  const roles: SupplyBreakdown["roles"] = [];
  for (const role of SUPPLY_ROLES) {
    const bps = allocation[role];
    const n = intendedRaw * BigInt(bps);
    if (n % BigInt(TOTAL_BPS) !== 0n) return { ok: false, reason: "NOT_WHOLE_UNITS", role };
    roles.push({ role, bps, raw: n / BigInt(TOTAL_BPS), issued: isIssuedRole(role) });
  }
  const mintedRaw = roles.filter((r) => r.issued).reduce((a, r) => a + r.raw, 0n);
  const unissuedRaw = roles.filter((r) => !r.issued).reduce((a, r) => a + r.raw, 0n);
  return { ok: true, value: { intendedRaw, mintedRaw, unissuedRaw, roles } };
}
