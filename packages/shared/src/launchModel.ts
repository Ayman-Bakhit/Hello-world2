/**
 * Launch configuration foundation (Slice 11). Pure rules; no I/O. Configuration, validation, persistence and review ONLY:
 * nothing here deploys a token, creates a mint or liquidity, builds a transaction, routes fees or pays anyone.
 *
 * Status is controlled by the server through named actions (configure, review, ready, cancel); a client can never submit a
 * status. DEPLOYING, LIVE and FAILED exist in the vocabulary for the future deployment slice and are NOT reachable:
 * the API schema, the transition table and a database constraint all exclude them.
 */
import type { Launch, LaunchCharitySnapshot, LaunchConfig, LaunchReview, PublicLaunch } from "./api/schemas";
import { CANONICAL_FEE_SPLIT, FEE_BUCKETS, percentToBps, type FeeBucket } from "./feesplit";
import { sha256Hex } from "./hash";
import { type LaunchAction, type ReachableLaunchStatus } from "./launchConstants";
import { stableStringify } from "./taxdata/report";

export * from "./launchConstants";
export const CONFIG_FINGERPRINT_VERSION = 1;

/** Where each action may start and where it lands. `update` always returns to DRAFT: a changed configuration must be re-validated. */
export const LAUNCH_TRANSITIONS: Record<Exclude<LaunchAction, "create">, { from: readonly ReachableLaunchStatus[]; to: ReachableLaunchStatus }> = {
  update: { from: ["DRAFT", "CONFIGURED", "REVIEW", "READY"], to: "DRAFT" },
  configure: { from: ["DRAFT"], to: "CONFIGURED" },
  review: { from: ["CONFIGURED"], to: "REVIEW" },
  ready: { from: ["REVIEW"], to: "READY" },
  cancel: { from: ["DRAFT", "CONFIGURED", "REVIEW", "READY"], to: "CANCELLED" },
};

export function nextLaunchStatus(action: Exclude<LaunchAction, "create">, from: string): ReachableLaunchStatus | null {
  const t = LAUNCH_TRANSITIONS[action];
  return (t.from as readonly string[]).includes(from) ? t.to : null;
}

export const LAUNCH_COPY = {
  readyTitle: "READY FOR DEPLOYMENT",
  readyMeaning: "Configuration validated and ready for a future deployment flow. No on-chain transaction has been submitted.",
  deploymentDisabled: "On-chain deployment is not enabled in this beta.",
  feeSplitNote: "60/15/15/10 is a validated launch configuration. It is not enforced on-chain.",
  fingerprintNote: "A configuration fingerprint is a hash of this configuration. It is not a blockchain proof.",
  metadataNote: "USER-PROVIDED metadata. It is not verified on-chain.",
  notDeployed: "NOT DEPLOYED",
  notVerified: "NOT VERIFIED ON-CHAIN",
  configured: "CONFIGURED",
  charityNote: "Selecting a charity does not execute a donation.",
  reserveNote: "This is a launch fee allocation. It is not your personal Tax Reserve, and no reserve is created.",
  protocolNote: "No funds move and no protocol address is configured.",
  creatorNote: "No payout is created by this configuration.",
} as const;

export const STATUS_MEANING: Record<ReachableLaunchStatus, string> = {
  DRAFT: "Saved configuration. Not yet validated, or edited since it was last validated.",
  CONFIGURED: "Configuration passed server validation. Not yet submitted for review.",
  REVIEW: "Submitted for review. The reviewed fingerprint is recorded.",
  READY: LAUNCH_COPY.readyMeaning,
  CANCELLED: "Cancelled. This configuration cannot be used.",
};

// ---------- canonical configuration and fingerprint ----------
/**
 * The configuration in a normalized, canonical form: percents become integer basis points, optional fields become null, keys are
 * sorted by the serializer. No secrets, tokens or session data can be part of it. Everything economically or publicly relevant is
 * included, so any change to it changes the fingerprint.
 */
export function canonicalLaunchConfig(c: LaunchConfig) {
  const socials = c.socials ?? {};
  return {
    version: CONFIG_FINGERPRINT_VERSION,
    kind: "LAUNCH_CONFIGURATION",
    network: c.network ?? "devnet",
    token: {
      name: c.name, symbol: c.symbol, description: c.description, decimals: c.decimals, totalSupply: c.totalSupply,
      imageUri: c.imageUri ?? null, website: c.website ?? null,
      socials: { twitter: socials.twitter ?? null, telegram: socials.telegram ?? null, discord: socials.discord ?? null, github: socials.github ?? null },
      metadataSource: "USER_PROVIDED",
    },
    supply: {
      creatorAllocationBps: percentToBps(c.creatorAllocationPercent), creatorWallet: c.creatorWallet,
      mintAuthority: c.mintAuthority, freezeAuthority: c.freezeAuthority, updateAuthority: c.updateAuthority,
      liquidity: { initialLiquidityUsdc: c.liquidityConfiguration.initialLiquidityUsdc, supplyBps: percentToBps(c.liquidityConfiguration.supplyPercentage), lockDays: c.liquidityConfiguration.lockDays },
    },
    feeSplit: { creator: c.feeSplit.creator, taxReserve: c.feeSplit.taxReserve, charity: c.feeSplit.charity, protocol: c.feeSplit.protocol },
    charity: { charityId: c.charityConfiguration.charityId },
    taxReserveAllocation: { destinationType: c.taxReserveConfiguration.destinationType, destinationAddress: c.taxReserveConfiguration.destinationAddress },
    protocolAllocation: { bps: c.feeSplit.protocol, destination: "NOT_CONFIGURED" },
    creatorAllocation: { bps: c.feeSplit.creator, wallet: c.creatorWallet },
  };
}

/** Deterministic sha256 over the canonical configuration. A fingerprint of a configuration, NOT a blockchain proof. */
export function launchFingerprint(c: LaunchConfig): string {
  return sha256Hex(stableStringify(canonicalLaunchConfig(c)));
}

// ---------- allocations: configuration labels, never "earned" / "paid" / "received" ----------
export interface AllocationView { bucket: FeeBucket; label: string; bps: number; percent: string; note: string }
const ALLOCATION_META: Record<FeeBucket, { label: string; note: string; name: string }> = {
  creator: { label: "CREATOR", name: "Configured creator allocation", note: LAUNCH_COPY.creatorNote },
  taxReserve: { label: "TAX RESERVE", name: "Configured tax reserve allocation (launch fee)", note: LAUNCH_COPY.reserveNote },
  charity: { label: "CHARITY", name: "Configured charity allocation", note: LAUNCH_COPY.charityNote },
  protocol: { label: "PROTOCOL", name: "Configured protocol allocation", note: LAUNCH_COPY.protocolNote },
};
export function launchAllocations(split: Record<FeeBucket, number>): AllocationView[] {
  return FEE_BUCKETS.map((b) => ({ bucket: b, label: ALLOCATION_META[b].label, bps: split[b], percent: `${split[b] / 100}%`, note: ALLOCATION_META[b].note }));
}
export const allocationName = (b: FeeBucket) => ALLOCATION_META[b].name;
export { CANONICAL_FEE_SPLIT };

// ---------- revision hash chain (tamper-evident, not tamper-proof, not a blockchain proof) ----------
export interface RevisionHashInput {
  launchId: string; seq: number; action: LaunchAction; statusAfter: string; fingerprint: string; createdBy: string; reason: string | null; prevHash: string | null; createdAt: string;
}
export function revisionRowHash(i: RevisionHashInput): string {
  return sha256Hex(stableStringify({ v: 1, ...i }));
}

// ---------- public view ----------
const shortAddr = (a: string) => (a.length <= 10 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`);

/**
 * The public projection of a READY, published configuration. It names no user, no session and no full wallet address (the creator is
 * shown as an abbreviated address), and it never says deployed, live, verified or immutable. `charity` is the registry state NOW.
 */
export function toPublicLaunch(l: Launch, charity: LaunchCharitySnapshot | null): PublicLaunch {
  const c = l.config;
  return {
    id: l.id, status: l.status, statusMeaning: l.statusMeaning, name: c.name, symbol: c.symbol, description: c.description, network: c.network,
    creator: shortAddr(c.creatorWallet), totalSupply: c.totalSupply, decimals: c.decimals,
    feeSplit: { creator: c.feeSplit.creator, taxReserve: c.feeSplit.taxReserve, charity: c.feeSplit.charity, protocol: c.feeSplit.protocol },
    allocations: launchAllocations(c.feeSplit), feeSplitLabel: "Configured fee split", feeSplitEnforcement: "not_enforced", charity,
    fingerprint: l.fingerprint,
    metadata: { source: "USER_PROVIDED", verifiedOnChain: false, imageUri: c.imageUri, website: c.website },
    deployment: l.deployment,
    labels: [LAUNCH_COPY.configured, LAUNCH_COPY.notDeployed, LAUNCH_COPY.notVerified, ...(l.dataSource === "demo" ? ["DEMO DATA"] : [])],
    readyAt: l.readyAt, dataSource: l.dataSource,
  };
}

// ---------- one transition function, shared by the API (which persists it) and mock mode (which keeps it in memory) ----------
export type LaunchActionName = Exclude<LaunchAction, "create">;
export interface LaunchPlanInput {
  current: { status: string; config: LaunchConfig; review: LaunchReview | null; revision: number };
  action: LaunchActionName;
  /** the replacement configuration, for `update` */
  config?: LaunchConfig;
  /** the pure server review, for configure / review / ready */
  review?: LaunchReview | null;
  /** for `ready`: whether the creator publishes the configuration */
  publish?: boolean;
  now: Date;
}
export interface LaunchPlan {
  status: ReachableLaunchStatus;
  config: LaunchConfig;
  review: LaunchReview | null;
  fingerprint: string;
  reviewedFingerprint: string | null;
  publicVisible: boolean;
  readyAt: string | null;
  revision: number;
}
/**
 * Decides the result of one named action. The caller never supplies a status: it comes from the transition table, and a failed
 * validation never advances the lifecycle (the launch returns to DRAFT with the errors recorded). Returns null when the action is
 * not available from the current status.
 */
export function planLaunchAction(i: LaunchPlanInput): LaunchPlan | null {
  const landing = nextLaunchStatus(i.action, i.current.status);
  if (!landing) return null;
  const config = i.action === "update" ? i.config! : i.current.config;
  const fingerprint = launchFingerprint(config);
  const needsReview = i.action === "configure" || i.action === "review" || i.action === "ready";
  const passed = needsReview ? (i.review ? i.review.passed : false) : true;
  const status: ReachableLaunchStatus = needsReview && !passed ? "DRAFT" : landing;
  return {
    status, config,
    review: i.action === "update" ? null : i.action === "cancel" ? i.current.review : (i.review ?? null),
    fingerprint,
    reviewedFingerprint: status === "REVIEW" || status === "READY" ? fingerprint : null,
    publicVisible: status === "READY" && i.publish === true,
    readyAt: status === "READY" ? i.now.toISOString() : null,
    revision: i.current.revision + 1,
  };
}

/** What a screen may offer for a launch in `status`. `dirty` = the editor has unsaved changes. */
export function availableLaunchActions(status: string | null, dirty: boolean): { save: boolean; configure: boolean; review: boolean; ready: boolean; cancel: boolean } {
  if (status === null) return { save: true, configure: false, review: false, ready: false, cancel: false };
  const live = status !== "CANCELLED";
  return {
    save: live && dirty,
    configure: !dirty && nextLaunchStatus("configure", status) !== null,
    review: !dirty && nextLaunchStatus("review", status) !== null,
    ready: !dirty && nextLaunchStatus("ready", status) !== null,
    cancel: live,
  };
}
