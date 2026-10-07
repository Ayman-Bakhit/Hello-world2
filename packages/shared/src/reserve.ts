/**
 * Tax reserve foundation (Slice 10). Pure functions over the EXISTING tax calculation output; there is no second tax engine,
 * no tax rate lives here, and nothing here can move money.
 *
 * Five different things, never conflated:
 *   tax estimate     what the tax engine computed (needs user-supplied rates; status COMPLETE|PARTIAL|DATA_REQUIRED|UNAVAILABLE)
 *   recommendation   a policy applied to the estimate (today: 1x the estimated exposure). Always an estimate.
 *   user target      a number the user chose (USER_SET). Configuration, not money.
 *   reserve balance  funds actually held. UNAVAILABLE until a verifiable ledger exists. Never inferred from a target.
 *   coverage         balance / target. Unavailable whenever either side is unavailable.
 *
 * Future funding (explicitly NOT implemented): reserve account -> user signature -> transaction -> confirmation -> ledger ->
 * reconciliation. The only balance source implemented is a labeled DEMO_FIXTURE, and the builder refuses to accept it for
 * anything but a demo tax estimate.
 */
import type { TaxReserveResponse } from "./api/schemas";
import { percentOfGains } from "./tax/engine";

export const RESERVE_TARGET_SOURCES = ["USER_SET", "SYSTEM_RECOMMENDED"] as const;
export type ReserveTargetSource = (typeof RESERVE_TARGET_SOURCES)[number];

export const RESERVE_RECOMMENDATION_STATUSES = ["ESTIMATE", "ESTIMATE_INCOMPLETE", "WITHHELD", "UNAVAILABLE"] as const;
export const RESERVE_BALANCE_SOURCES = ["UNAVAILABLE", "DEMO_FIXTURE"] as const;
export const RESERVE_TAX_SOURCES = ["TAX_ENGINE", "DEMO_FIXTURE"] as const;

/**
 * Recommendation policies. Today there is exactly one and it is the identity: no percentage, no buffer, no jurisdiction rule.
 * Future policies (buffer, user-selected percentage, jurisdiction-specific) plug in here; none is invented now.
 */
export const RESERVE_POLICIES = { EXPOSURE_1X: (exposureCents: bigint): bigint => exposureCents } as const;
export type ReservePolicyId = keyof typeof RESERVE_POLICIES;
export const DEFAULT_RESERVE_POLICY: ReservePolicyId = "EXPOSURE_1X";

export const RESERVE_COPY = {
  balanceUnavailable: "RESERVE BALANCE UNAVAILABLE",
  fundingDisabled: "Reserve funding is not enabled in this beta.",
  noTarget: "No reserve target set.",
  noEstimate: "NO TAX RESERVE ESTIMATE AVAILABLE",
  estimateLabel: "ESTIMATED RESERVE TARGET",
  incompleteLabel: "ESTIMATED RESERVE — TAX DATA INCOMPLETE",
  withheldLabel: "TAX DATA REQUIRED — NO RESERVE RECOMMENDATION",
  ratesLabel: "RATES REQUIRED FOR A RESERVE ESTIMATE",
  targetIsConfiguration: "A reserve target is a number you chose. It is not money. Saving it does not move, lock or set aside any funds.",
  recommendationNotTarget: "A recommendation is an estimate. It is not your target and not a balance.",
  notAdvice: "This is a planning tool, not tax advice. Consult a tax professional.",
} as const;

export interface ReserveTargetConfig {
  targetType: "percentage" | "amount";
  percentBps: number | null;
  targetCents: bigint | null;
  source: ReserveTargetSource;
  enabled: boolean;
  updatedAt: string;
  dataSource: "demo" | "database";
}
/** The only implemented balance source. A real source (reconciled ledger) does not exist yet. */
export interface ReserveBalanceInput { source: "DEMO_FIXTURE"; cents: bigint }

export interface ReserveInput {
  walletId: string;
  taxSource: "TAX_ENGINE" | "DEMO_FIXTURE";
  taxStatus: "COMPLETE" | "PARTIAL" | "DATA_REQUIRED" | "UNAVAILABLE";
  /** from the tax engine; null when no rates were supplied or there is no estimate */
  exposureCents: bigint | null;
  /** realized gains minus losses from the same estimate, for percentage targets; null when there is no estimate */
  netGainsCents: bigint | null;
  ratesSupplied: boolean;
  requirements: Array<{ kind: string; severity: string; count: number; message: string }>;
  target: ReserveTargetConfig | null;
  balance: ReserveBalanceInput | null;
}

const MAX_BPS = 100_000_000n; // 1,000,000%: a ratio against a tiny target must not overflow a JSON integer
const ratioBps = (num: bigint, den: bigint): number => {
  const v = (num * 10_000n) / den;
  return Number(v > MAX_BPS ? MAX_BPS : v);
};
const str = (n: bigint | null) => (n === null ? null : n.toString());

export function percentFromBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return `${whole}${frac ? "." + String(frac).padStart(2, "0").replace(/0$/, "") : ""}%`;
}

export function buildReserveState(i: ReserveInput): TaxReserveResponse {
  if (i.exposureCents !== null && i.exposureCents < 0n) throw new Error("Negative exposure");
  if (i.balance && i.taxSource !== "DEMO_FIXTURE") throw new Error("A fixture reserve balance is only allowed with a demo tax estimate");
  if (i.balance && i.balance.cents < 0n) throw new Error("Negative balance");

  const estimateUsable = i.taxStatus === "COMPLETE" || i.taxStatus === "PARTIAL";
  const exposure = estimateUsable && i.ratesSupplied ? i.exposureCents : null;
  const withheldReason =
    i.taxStatus === "UNAVAILABLE" ? "No wallet has been synced, so there is no tax data."
    : i.taxStatus === "DATA_REQUIRED" ? "Tax data required: prices, cost basis or timestamps are missing, so the figures are not a total."
    : !i.ratesSupplied ? "Tax rates were not supplied. Enter your own rates; none are assumed."
    : exposure === null ? "No exposure estimate is available."
    : null;

  // ---- recommendation: a policy over the estimate, never stronger than the estimate ----
  const policy = RESERVE_POLICIES[DEFAULT_RESERVE_POLICY];
  const recommendation: TaxReserveResponse["recommendation"] = exposure !== null
    ? {
        source: "SYSTEM_RECOMMENDATION", policy: DEFAULT_RESERVE_POLICY,
        status: i.taxStatus === "COMPLETE" ? "ESTIMATE" : "ESTIMATE_INCOMPLETE",
        label: i.taxStatus === "COMPLETE" ? RESERVE_COPY.estimateLabel : RESERVE_COPY.incompleteLabel,
        recommendedCents: str(policy(exposure)),
        reason: i.taxStatus === "COMPLETE"
          ? "Equal to the estimated tax exposure. An estimate from data that is not independently verified."
          : "Equal to the estimated tax exposure, but the tax data is incomplete, so this may be too low.",
        authoritative: false,
      }
    : {
        source: "SYSTEM_RECOMMENDATION", policy: DEFAULT_RESERVE_POLICY,
        status: i.taxStatus === "DATA_REQUIRED" ? "WITHHELD" : "UNAVAILABLE",
        label: i.taxStatus === "DATA_REQUIRED" ? RESERVE_COPY.withheldLabel : i.taxStatus === "UNAVAILABLE" ? RESERVE_COPY.noEstimate : RESERVE_COPY.ratesLabel,
        recommendedCents: null, reason: withheldReason ?? "No recommendation is available.", authoritative: false,
      };

  // ---- user target: configuration only ----
  const t = i.target;
  const netGains = estimateUsable ? i.netGainsCents : null;
  let resolved: bigint | null = null;
  let resolutionNote: string | null = null;
  if (t) {
    if (t.targetType === "amount") resolved = t.targetCents;
    else if (netGains !== null) resolved = percentOfGains(netGains, t.percentBps ?? 0);
    else resolutionNote = "A percentage target needs an available estimate of realized gains.";
  }
  const effective = t && t.enabled ? resolved : null;
  const userTarget: TaxReserveResponse["userTarget"] = {
    set: t !== null,
    source: t ? t.source : null,
    enabled: t ? t.enabled : null,
    targetType: t ? t.targetType : null,
    targetPercentage: t && t.targetType === "percentage" ? percentFromBps(t.percentBps ?? 0).replace("%", "") : null,
    targetAmountCents: t && t.targetType === "amount" ? str(t.targetCents) : null,
    resolvedCents: str(resolved),
    effectiveCents: str(effective),
    resolutionNote,
    updatedAt: t ? t.updatedAt : null,
    dataSource: t ? t.dataSource : null,
    label: t ? (t.enabled ? "USER TARGET" : "USER TARGET (DISABLED)") : RESERVE_COPY.noTarget,
    isMoney: false,
  };

  // ---- the target relative to the estimate (not a funding measure) ----
  const targetVsExposure: TaxReserveResponse["targetVsExposure"] =
    effective !== null && exposure !== null && exposure > 0n
      ? { available: true, bps: ratioBps(effective, exposure), wording: `Target is ${percentFromBps(ratioBps(effective, exposure))} of the estimated exposure (an estimate).`, reason: null }
      : { available: false, bps: null, wording: null, reason: !t ? RESERVE_COPY.noTarget : !t.enabled ? "The target is disabled." : effective === null ? (resolutionNote ?? "The target could not be resolved.") : exposure === null ? "Estimated exposure is unavailable." : "Estimated exposure is zero." };

  // ---- reserve balance: unavailable unless a real source exists (none does) ----
  const reserveBalance: TaxReserveResponse["reserveBalance"] = i.balance
    ? { source: "DEMO_FIXTURE", status: "DEMO", cents: str(i.balance.cents), label: "DEMO RESERVE BALANCE", note: "A fictional fixture balance. It is not real funds." }
    : { source: "UNAVAILABLE", status: "NOT_CONNECTED", cents: null, label: RESERVE_COPY.balanceUnavailable, note: "No reserve ledger or funding integration exists yet, so no balance is shown. This is not the same as a balance of zero." };

  const why = (): string =>
    i.balance === null ? "Reserve balance is unavailable."
    : !t ? RESERVE_COPY.noTarget
    : !t.enabled ? "The target is disabled."
    : effective === null ? (resolutionNote ?? "The target could not be resolved.")
    : "The target is zero.";
  const funded = i.balance !== null && effective !== null && effective > 0n;
  const coverage: TaxReserveResponse["coverage"] = funded
    ? { available: true, bps: ratioBps(i.balance!.cents, effective!), label: `${percentFromBps(ratioBps(i.balance!.cents, effective!))} of target`, reason: null }
    : { available: false, bps: null, label: "UNAVAILABLE", reason: why() };
  const remaining: TaxReserveResponse["remaining"] = funded
    ? { available: true, cents: str(effective! > i.balance!.cents ? effective! - i.balance!.cents : 0n), reason: null }
    : { available: false, cents: null, reason: why() };

  return {
    walletId: i.walletId, scope: "user", currency: "USDC",
    taxEstimate: {
      source: i.taxSource, status: i.taxStatus, label: "ESTIMATE", estimatedExposureCents: str(exposure), withheldReason,
      ratesSupplied: i.ratesSupplied, incomplete: i.taxStatus !== "COMPLETE",
      missing: i.requirements.filter((r) => r.severity !== "info" || r.kind === "RATES").map((r) => ({ kind: r.kind, severity: r.severity, count: r.count, message: r.message })),
      authoritative: false, verifiedOnChain: false,
    },
    recommendation, userTarget, targetVsExposure, reserveBalance, coverage, remaining,
    funding: { enabled: false, message: RESERVE_COPY.fundingDisabled, custody: "none", moneyMovement: "NOT_ENABLED" },
    disclaimer: [RESERVE_COPY.recommendationNotTarget, RESERVE_COPY.targetIsConfiguration, RESERVE_COPY.notAdvice],
    dataSource: i.taxSource === "DEMO_FIXTURE" ? "demo" : "chain", verifiedOnChain: false,
  };
}
