/** Dependency-free launch vocabulary (imported by the API schemas and by launchModel). */
export const LAUNCH_STATUSES = ["DRAFT", "CONFIGURED", "REVIEW", "READY", "DEPLOYING", "LIVE", "FAILED", "CANCELLED"] as const;
export type LaunchStatusValue = (typeof LAUNCH_STATUSES)[number];
/** The only statuses the system can produce in this slice. */
export const REACHABLE_LAUNCH_STATUSES = ["DRAFT", "CONFIGURED", "REVIEW", "READY", "CANCELLED"] as const;
export type ReachableLaunchStatus = (typeof REACHABLE_LAUNCH_STATUSES)[number];
export const LAUNCH_NETWORKS = ["devnet", "mainnet-beta"] as const;
export const LAUNCH_ACTIONS = ["create", "update", "configure", "review", "ready", "cancel"] as const;
export type LaunchAction = (typeof LAUNCH_ACTIONS)[number];

/** Largest u64 (SPL token supply is a u64 in base units). */
export const MAX_U64 = 18_446_744_073_709_551_615n;
/** totalSupply (whole tokens) scaled by decimals must fit a u64. Exact BigInt arithmetic, no floats. */
export function supplyFitsU64(totalSupply: string, decimals: number): boolean {
  if (!/^[1-9]\d{0,29}$/.test(totalSupply) || !Number.isInteger(decimals) || decimals < 0 || decimals > 9) return false;
  return BigInt(totalSupply) * 10n ** BigInt(decimals) <= MAX_U64;
}
