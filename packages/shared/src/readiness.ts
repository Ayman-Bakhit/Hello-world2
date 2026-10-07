/**
 * Execution readiness (Slice 14). ONE authoritative, server-side evaluator. Nothing in it reads a frontend flag: its inputs are the
 * stored launch, the registry charity, the deployment policy in force and the recorded plan state.
 *
 * Even when every prerequisite passes the answer is EXECUTION_DISABLED, never "ready to sign": real execution is disabled in this
 * build (REAL_EXECUTION_ENABLED = false), `executionPermitted` is the literal false, and no route exists that could sign or send.
 */
import { z } from "zod";
import type { Launch } from "./api/schemas";
import { buildDeploymentPlan, factsFromPolicy, type PlanCharity } from "./deployment";
import {
  DECISION_IDS, DEPLOYMENT_POLICY, EXECUTION_DISABLED_MESSAGE, MILESTONES, isApproved, milestoneStatus, REAL_EXECUTION_ENABLED, decisionOf, environmentFor, isCompleteReview, resolveSupplyAllocation, type Decision, type DecisionCategory,
  type DecisionId, type DeploymentPolicy, type SupplyAllocationModel,
} from "./deploymentPolicy";
import { CANONICAL_FEE_SPLIT, FEE_BUCKETS, TOTAL_BPS, validateFeeSplit } from "./feesplit";
import { launchFingerprint } from "./launchModel";
import { isValidSolanaAddress } from "./solanaAddress";

export const GATE_IDS = [
  "LAUNCH_READY", "FINGERPRINT_CURRENT", "PLAN_BUILDABLE", "PLAN_RECORDED_CURRENT", "TOKEN_PROGRAM_SELECTED", "SUPPLY_ALLOCATION_DEFINED", "ALLOCATIONS_SUM_10000_BPS", "ALLOCATION_LOCKS_DEFINED",
  "METADATA_STRATEGY_DEFINED", "PROTOCOL_DESTINATION_VALID", "CHARITY_DESTINATIONS_VERIFIED", "CHARITY_GOVERNANCE_DEFINED", "TAX_RESERVE_DESTINATION_VALID", "TAX_RESERVE_FUNDING_DEFINED",
  "LIQUIDITY_STRATEGY_DEFINED", "FEE_SPLIT_VALID",
  "FEE_SPLIT_SCOPE_DEFINED", "FEE_ROUTING_DEFINED", "FEE_ROUTING_ENFORCEABLE", "MINT_STRATEGY_DEFINED", "FEE_POLICY_DEFINED", "CLUSTER_VALID", "PRODUCT_APPROVAL_COMPLETE",
  "SECURITY_REVIEW_COMPLETE", "SMART_CONTRACT_REVIEW_COMPLETE", "LEGAL_REVIEW_COMPLETE", "REAL_EXECUTION_ENABLED",
] as const;
export type GateId = (typeof GATE_IDS)[number];
export const GATE_STATUSES = ["PASS", "BLOCKED", "PENDING", "NOT_APPLICABLE"] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

export interface ReadinessGate {
  id: GateId; title: string; status: GateStatus; reason: string;
  /** where the answer comes from */
  provenance: string; category: DecisionCategory; blocking: boolean;
  /** exactly what must be decided or done (null when PASS or NOT_APPLICABLE) */
  required: string | null;
  decisionId: DecisionId | null;
}
export interface PlanRecordState { recorded: boolean; supersededPlans: number }
export interface ReadinessInput { launch: Launch; charity: PlanCharity | null; policy?: DeploymentPolicy; planState?: PlanRecordState }
export interface ExecutionReadiness {
  overall: "BLOCKED" | "EXECUTION_DISABLED";
  /** true when every gate except the execution gate passes. Still not permission to execute. */
  prerequisitesMet: boolean;
  /** the literal false: no combination of gates permits execution in this build */
  executionPermitted: false;
  gates: ReadinessGate[];
  summary: { pass: number; blocked: number; pending: number; notApplicable: number; blocking: number };
  planHash: string | null; policyHash: string;
  note: string;
}

const gate = (id: GateId, title: string, category: DecisionCategory, status: GateStatus, reason: string, provenance: string, required: string | null = null, decisionId: DecisionId | null = null): ReadinessGate =>
  ({ id, title, category, status, reason, provenance, required: status === "PASS" || status === "NOT_APPLICABLE" ? null : required ?? reason, decisionId, blocking: status === "BLOCKED" || status === "PENDING" });

/** A gate that rests on one decision: PENDING while undecided, otherwise the caller's check decides. */
function viaDecision(p: DeploymentPolicy, d: DecisionId, id: GateId, title: string, decided: (dec: Decision) => { ok: boolean; reason: string; required?: string }): ReadinessGate {
  const dec = decisionOf(p, d);
  if (dec.status === "PENDING") return gate(id, title, dec.category, "PENDING", dec.summary, `decision ${d}: PENDING`, dec.missing ?? dec.summary, d);
  const r = decided(dec);
  return gate(id, title, dec.category, r.ok ? "PASS" : "BLOCKED", r.reason, `decision ${d} v${dec.version}: ${dec.provenance}`, r.required, d);
}

export function evaluateExecutionReadiness(input: ReadinessInput): ExecutionReadiness {
  const { launch, charity } = input;
  const policy = input.policy ?? DEPLOYMENT_POLICY;
  const c = launch.config;
  const g: ReadinessGate[] = [];

  g.push(launch.status === "READY"
    ? gate("LAUNCH_READY", "Launch status is READY", "TECHNICAL", "PASS", "The launch is READY.", "launch record")
    : gate("LAUNCH_READY", "Launch status is READY", "TECHNICAL", "BLOCKED", `The launch is ${launch.status}, not READY.`, "launch record", "Configure, review and mark the launch READY."));
  const fpOk = !!launch.review && launch.review.passed && launch.review.fingerprint === launch.fingerprint && launchFingerprint(c) === launch.fingerprint;
  g.push(fpOk
    ? gate("FINGERPRINT_CURRENT", "Reviewed fingerprint equals the current configuration", "TECHNICAL", "PASS", "The reviewed fingerprint equals the fingerprint recomputed from the stored configuration.", "launch fingerprint")
    : gate("FINGERPRINT_CURRENT", "Reviewed fingerprint equals the current configuration", "TECHNICAL", "BLOCKED", "The configuration changed after it was reviewed, or was never reviewed.", "launch fingerprint", "Review the current configuration and mark it READY again."));

  const built = buildDeploymentPlan({ launch, charity, policy, facts: factsFromPolicy(policy) });
  g.push(built.ok
    ? gate("PLAN_BUILDABLE", "A deployment plan can be built", "TECHNICAL", "PASS", `Plan ${built.plan.identity.planHash.slice(0, 12)}… builds from the stored configuration.`, "deployment plan builder")
    : gate("PLAN_BUILDABLE", "A deployment plan can be built", "TECHNICAL", "BLOCKED", built.errors.map((e) => `${e.code}: ${e.message}`).join(" "), "deployment plan builder", "Fix the listed build errors in the launch configuration."));
  const ps = input.planState ?? { recorded: false, supersededPlans: 0 };
  g.push(!built.ok
    ? gate("PLAN_RECORDED_CURRENT", "The current plan is recorded", "TECHNICAL", "BLOCKED", "There is no current plan to record.", "deployment plan records", "Make the plan buildable first.")
    : ps.recorded
      ? gate("PLAN_RECORDED_CURRENT", "The current plan is recorded", "TECHNICAL", "PASS", "This exact plan (configuration, destinations and policy) is recorded.", "deployment plan records")
      : ps.supersededPlans > 0
        ? gate("PLAN_RECORDED_CURRENT", "The current plan is recorded", "TECHNICAL", "BLOCKED", "A recorded plan exists but the configuration, a destination or a decision changed since. The recorded plan is stale.", "deployment plan records", "Record the current plan.")
        : gate("PLAN_RECORDED_CURRENT", "The current plan is recorded", "TECHNICAL", "PENDING", "No plan has been recorded yet.", "deployment plan records", "Record the current plan."));

  g.push(viaDecision(policy, "TOKEN_PROGRAM", "TOKEN_PROGRAM_SELECTED", "Token program selected", (d) => ({ ok: (d.value as { name?: string }).name === "SPL_TOKEN", reason: "SPL Token (classic) is selected; Token-2022 is not used." })));

  const alloc = viaDecision(policy, "SUPPLY_ALLOCATION_MODEL", "SUPPLY_ALLOCATION_DEFINED", "Initial supply allocation defined", () => ({ ok: true, reason: "An allocation model is defined." }));
  g.push(alloc);
  if (alloc.status !== "PASS") g.push(gate("ALLOCATIONS_SUM_10000_BPS", "Allocations sum to 10000 bps", "PRODUCT", "PENDING", "Cannot be checked: no allocation model is defined, so part of the supply has no recipient.", "decision SUPPLY_ALLOCATION_MODEL: PENDING", decisionOf(policy, "SUPPLY_ALLOCATION_MODEL").missing, "SUPPLY_ALLOCATION_MODEL"));
  else {
    const r = resolveSupplyAllocation(c, decisionOf(policy, "SUPPLY_ALLOCATION_MODEL").value as unknown as SupplyAllocationModel);
    g.push(r.ok ? gate("ALLOCATIONS_SUM_10000_BPS", "Allocations sum to 10000 bps", "PRODUCT", "PASS", `Creator, liquidity, charity, tax reserve, protocol and burn sum to exactly ${TOTAL_BPS} bps.`, "supply allocation model + launch configuration")
      : gate("ALLOCATIONS_SUM_10000_BPS", "Allocations sum to 10000 bps", "PRODUCT", "BLOCKED", r.errors.join("; "), "supply allocation model + launch configuration", "Correct the allocation model.", "SUPPLY_ALLOCATION_MODEL"));
  }

  g.push(viaDecision(policy, "ALLOCATION_LOCKS_AND_VESTING", "ALLOCATION_LOCKS_DEFINED", "Locks, vesting and burns defined", () => ({ ok: true, reason: "Transferability, locks, vesting and burns are decided for every supply share." })));

  const doc = decisionOf(policy, "METADATA_DOCUMENT"), host = decisionOf(policy, "METADATA_HOSTING");
  g.push(doc.status === "DECIDED" && host.status === "DECIDED"
    ? gate("METADATA_STRATEGY_DEFINED", "Metadata strategy defined", "PRODUCT", "PASS", "The metadata document format and its hosting are decided.", "decisions METADATA_DOCUMENT, METADATA_HOSTING")
    : gate("METADATA_STRATEGY_DEFINED", "Metadata strategy defined", "PRODUCT", "PENDING", doc.status === "DECIDED" ? `Document format is decided (hashed, canonical). ${host.summary}` : doc.summary, "decisions METADATA_DOCUMENT, METADATA_HOSTING", host.status === "PENDING" ? host.missing : doc.missing, host.status === "PENDING" ? "METADATA_HOSTING" : "METADATA_DOCUMENT"));

  g.push(viaDecision(policy, "PROTOCOL_DESTINATION", "PROTOCOL_DESTINATION_VALID", "Protocol destination valid", (d) => {
    const v = d.value as { address?: unknown; control?: unknown; approvedBy?: unknown };
    const ok = isValidSolanaAddress(v.address) && typeof v.control === "string" && typeof v.approvedBy === "string" && v.approvedBy.trim().length > 0;
    return { ok, reason: ok ? "A valid, approved protocol destination with a stated control model is recorded." : "The recorded protocol destination is not a valid address with an approver and a control model.", required: "A valid address, who controls it, and who approved it." };
  }));

  const cp = decisionOf(policy, "CHARITY_PAYOUT_MODEL");
  const cw = charity && charity.walletAddress && isValidSolanaAddress(charity.walletAddress) ? charity.walletAddress : null;
  g.push(cp.status !== "DECIDED" ? gate("CHARITY_DESTINATIONS_VERIFIED", "Charity destination verified", "PRODUCT", "PENDING", cp.summary, "decision CHARITY_PAYOUT_MODEL: PENDING", cp.missing, "CHARITY_PAYOUT_MODEL")
    : !charity ? gate("CHARITY_DESTINATIONS_VERIFIED", "Charity destination verified", "PRODUCT", "BLOCKED", "The selected charity is not in the registry.", "charity registry", "Select a registry charity.", "CHARITY_PAYOUT_MODEL")
    : charity.verificationState !== "VERIFIED" ? gate("CHARITY_DESTINATIONS_VERIFIED", "Charity destination verified", "PRODUCT", "BLOCKED", `The charity is ${charity.verificationState}, not VERIFIED.`, "charity registry", "Select a VERIFIED charity.", "CHARITY_PAYOUT_MODEL")
    : cw === null ? gate("CHARITY_DESTINATIONS_VERIFIED", "Charity destination verified", "PRODUCT", "BLOCKED", "The registry does not have exactly one verified, well-formed payout wallet for this charity.", "charity registry", "Resolve exactly one verified payout wallet for the charity.", "CHARITY_PAYOUT_MODEL")
    : gate("CHARITY_DESTINATIONS_VERIFIED", "Charity destination verified", "PRODUCT", "PASS", "The charity is VERIFIED and has exactly one verified payout wallet, which is part of the plan.", "charity registry", null, "CHARITY_PAYOUT_MODEL"));

  g.push(viaDecision(policy, "CHARITY_VERIFICATION_GOVERNANCE", "CHARITY_GOVERNANCE_DEFINED", "Charity verification governance defined", () => ({ ok: true, reason: "Who verifies charities, with what evidence, and the wallet-change and suspension rules are decided." })));

  const tr = decisionOf(policy, "TAX_RESERVE_MODEL");
  g.push(tr.status !== "DECIDED" ? gate("TAX_RESERVE_DESTINATION_VALID", "Launch tax reserve destination valid", "PRODUCT", "PENDING", tr.summary, "decision TAX_RESERVE_MODEL: PENDING", tr.missing, "TAX_RESERVE_MODEL")
    : isValidSolanaAddress(c.taxReserveConfiguration.destinationAddress)
      ? gate("TAX_RESERVE_DESTINATION_VALID", "Launch tax reserve destination valid", "PRODUCT", "PASS", "A valid creator-controlled address is configured. It is separate from the personal Tax Reserve.", "launch configuration", null, "TAX_RESERVE_MODEL")
      : gate("TAX_RESERVE_DESTINATION_VALID", "Launch tax reserve destination valid", "PRODUCT", "BLOCKED", "The configured destination is not a valid Solana address.", "launch configuration", "Configure a valid address.", "TAX_RESERVE_MODEL"));

  g.push(viaDecision(policy, "TAX_RESERVE_FUNDING", "TAX_RESERVE_FUNDING_DEFINED", "Launch tax reserve funding defined", () => ({ ok: true, reason: "The asset and whether the allocation is funded or only designated are decided." })));
  g.push(viaDecision(policy, "LIQUIDITY_STRATEGY", "LIQUIDITY_STRATEGY_DEFINED", "Liquidity strategy defined", (d) => {
    const v = d.value as { builderImplemented?: unknown };
    return { ok: v.builderImplemented === true, reason: v.builderImplemented === true ? "A liquidity venue is selected and its builder is implemented." : "LIQUIDITY_BUILD_NOT_IMPLEMENTED: a venue is named but no instruction builder exists.", required: "Implement the selected venue's instruction builder." };
  }));

  const fs = decisionOf(policy, "FEE_SPLIT");
  const split = c.feeSplit;
  const splitOk = validateFeeSplit(split).length === 0 && FEE_BUCKETS.every((b) => split[b] === CANONICAL_FEE_SPLIT[b]) && fs.status === "DECIDED" && FEE_BUCKETS.every((b) => (fs.value as Record<string, number>)[b] === split[b]);
  g.push(splitOk ? gate("FEE_SPLIT_VALID", "Fee split is 60/15/15/10 and sums to 10000 bps", "PRODUCT", "PASS", "The configured split equals the decided split and sums to exactly 10000 bps. It is a CONFIGURATION, not on-chain enforcement.", "decision FEE_SPLIT + launch configuration", null, "FEE_SPLIT")
    : gate("FEE_SPLIT_VALID", "Fee split is 60/15/15/10 and sums to 10000 bps", "PRODUCT", "BLOCKED", "The configured split differs from the decided split or does not sum to 10000 bps.", "decision FEE_SPLIT + launch configuration", "Restore the decided split.", "FEE_SPLIT"));
  g.push(viaDecision(policy, "FEE_SPLIT_SCOPE", "FEE_SPLIT_SCOPE_DEFINED", "Fee split scope defined", () => ({ ok: true, reason: "The revenue stream and asset the split applies to are decided." })));
  const fr = viaDecision(policy, "FEE_ROUTING_MECHANISM", "FEE_ROUTING_DEFINED", "Fee routing mechanism defined", () => ({ ok: true, reason: "A fee routing mechanism is selected." }));
  g.push(fr);
  const frd = decisionOf(policy, "FEE_ROUTING_MECHANISM");
  const enforce = frd.status === "DECIDED" && (frd.value as { implemented?: unknown; enforcesSplit?: unknown }).implemented === true && (frd.value as { enforcesSplit?: unknown }).enforcesSplit === true;
  g.push(enforce ? gate("FEE_ROUTING_ENFORCEABLE", "Fee routing is implemented and enforces the split", "TECHNICAL", "PASS", "The selected mechanism is implemented and enforces the split.", "decision FEE_ROUTING_MECHANISM", null, "FEE_ROUTING_MECHANISM")
    : gate("FEE_ROUTING_ENFORCEABLE", "Fee routing is implemented and enforces the split", "TECHNICAL", frd.status === "PENDING" ? "PENDING" : "BLOCKED", "FEE_ROUTING_ENFORCEMENT_NOT_IMPLEMENTED: the 60/15/15/10 split is configured in the database, but no on-chain mechanism enforces it.", "decision FEE_ROUTING_MECHANISM", "Implement and review a mechanism that enforces the split, or change the product claim.", "FEE_ROUTING_MECHANISM"));

  g.push(viaDecision(policy, "MINT_KEY_STRATEGY", "MINT_STRATEGY_DEFINED", "Mint key strategy defined", () => ({ ok: true, reason: "The mint keypair is client-held; the server receives only the public key." })));
  g.push(viaDecision(policy, "FEE_COMPUTE_POLICY", "FEE_POLICY_DEFINED", "Rent, fee and compute policy defined", () => ({ ok: true, reason: "The creator pays; no priority fee; compute is simulated at runtime; fees are estimates until confirmed." })));

  const env = environmentFor(c.network);
  const reviews = (["SECURITY_REVIEW", "SMART_CONTRACT_REVIEW", "LEGAL_REVIEW"] as const).map((r) => decisionOf(policy, r));
  const reviewsDone = reviews.every((r) => r.status === "DECIDED" && isCompleteReview(r.value));
  const envDec = decisionOf(policy, "ENVIRONMENT_POLICY");
  g.push(envDec.status === "PENDING" ? gate("CLUSTER_VALID", "Cluster is valid for a launch", "SECURITY", "PENDING", envDec.summary, "decision ENVIRONMENT_POLICY: PENDING", envDec.missing, "ENVIRONMENT_POLICY")
    : !env || !env.launchAllowed ? gate("CLUSTER_VALID", "Cluster is valid for a launch", "SECURITY", "BLOCKED", `The cluster "${c.network}" cannot host a launch.`, "decision ENVIRONMENT_POLICY", "Use devnet or mainnet-beta.", "ENVIRONMENT_POLICY")
    : c.network === "mainnet-beta" && !reviewsDone ? gate("CLUSTER_VALID", "Cluster is valid for a launch", "SECURITY", "BLOCKED", "mainnet-beta requires completed security, smart-contract and legal reviews. They are not complete.", "decision ENVIRONMENT_POLICY", "Complete the reviews, or use devnet.", "ENVIRONMENT_POLICY")
    : gate("CLUSTER_VALID", "Cluster is valid for a launch", "SECURITY", "PASS", `${c.network} is a separate cluster; a plan built for it is refused on any other.`, "decision ENVIRONMENT_POLICY", null, "ENVIRONMENT_POLICY"));

  const unapproved = policy.decisions.filter((d) => d.status === "DECIDED" && !isApproved(d));
  g.push(unapproved.length === 0
    ? gate("PRODUCT_APPROVAL_COMPLETE", "Every decided item has product approval", "PRODUCT", "PASS", "Every decided item is approved by a named approver, with a date and a reference, at its current version.", "decision approvals")
    : gate("PRODUCT_APPROVAL_COMPLETE", "Every decided item has product approval", "PRODUCT", "PENDING", `${unapproved.length} decided item${unapproved.length === 1 ? " is" : "s are"} an engineering default or proposal without product approval: ${unapproved.map((d) => d.id).join(", ")}. A default is not a product decision, and approval is not on-chain implementation.`, "decision approvals", "The product owner records an approver, date and reference for each, or rejects it."));

  const review = (id: DecisionId, gid: GateId, title: string, applicable: boolean): ReadinessGate => {
    const d = decisionOf(policy, id);
    if (!applicable) return gate(gid, title, d.category, "NOT_APPLICABLE", "No custom on-chain program is selected, so there is nothing to review.", `decision ${id}`);
    if (d.status === "PENDING") return gate(gid, title, d.category, "PENDING", d.summary, `decision ${id}: PENDING`, d.missing, id);
    return isCompleteReview(d.value) ? gate(gid, title, d.category, "PASS", `Review recorded: ${(d.value as { evidenceRef: string }).evidenceRef}.`, `decision ${id}: evidence reference`, null, id)
      : gate(gid, title, d.category, "BLOCKED", "The review record lacks an evidence reference and completion date.", `decision ${id}`, "Record real evidence.", id);
  };
  const customProgram = frd.status === "PENDING" || decisionOf(policy, "LIQUIDITY_STRATEGY").status === "PENDING" || (frd.value as { programId?: unknown } | null)?.programId != null; // unknown design counts as possibly custom
  g.push(review("SECURITY_REVIEW", "SECURITY_REVIEW_COMPLETE", "Security review complete", true));
  g.push(review("SMART_CONTRACT_REVIEW", "SMART_CONTRACT_REVIEW_COMPLETE", "Smart contract review complete", customProgram));
  g.push(review("LEGAL_REVIEW", "LEGAL_REVIEW_COMPLETE", "Legal review complete", true));

  g.push(gate("REAL_EXECUTION_ENABLED", "Real execution enabled", "SECURITY", REAL_EXECUTION_ENABLED ? "PASS" : "BLOCKED", EXECUTION_DISABLED_MESSAGE, "server constant REAL_EXECUTION_ENABLED", "Not available in this build.", null));

  const count = (s: GateStatus) => g.filter((x) => x.status === s).length;
  const others = g.filter((x) => x.id !== "REAL_EXECUTION_ENABLED");
  const prerequisitesMet = others.every((x) => !x.blocking);
  return {
    overall: prerequisitesMet ? "EXECUTION_DISABLED" : "BLOCKED", prerequisitesMet, executionPermitted: false, gates: g,
    summary: { pass: count("PASS"), blocked: count("BLOCKED"), pending: count("PENDING"), notApplicable: count("NOT_APPLICABLE"), blocking: g.filter((x) => x.blocking).length },
    planHash: built.ok ? built.plan.identity.planHash : null, policyHash: policyHashOf(policy),
    note: prerequisitesMet ? "Every prerequisite passes, but real execution is disabled in this build. Nothing can be signed or sent." : "Not ready. Real execution is disabled in this build regardless.",
  };
}
import { policyHash as policyHashOf } from "./deploymentPolicy";

// ---------- response schemas ----------
export const ReadinessGateSchema = z.object({
  id: z.enum(GATE_IDS), title: z.string(), status: z.enum(GATE_STATUSES), reason: z.string(), provenance: z.string(), category: z.enum(["PRODUCT", "TECHNICAL", "SECURITY", "LEGAL"]),
  blocking: z.boolean(), required: z.string().nullable(), decisionId: z.string().nullable(),
});
export const ExecutionReadinessSchema = z.object({
  overall: z.enum(["BLOCKED", "EXECUTION_DISABLED"]), prerequisitesMet: z.boolean(), executionPermitted: z.literal(false), gates: z.array(ReadinessGateSchema),
  summary: z.object({ pass: z.number().int(), blocked: z.number().int(), pending: z.number().int(), notApplicable: z.number().int(), blocking: z.number().int() }),
  planHash: z.string().nullable(), policyHash: z.string(), note: z.string(),
});
export const ExecutionReadinessResponse = z.object({
  launchId: z.string().uuid(), readiness: ExecutionReadinessSchema,
  execution: z.object({ enabled: z.literal(false), label: z.literal("DISABLED"), notices: z.tuple([z.literal("NO TRANSACTIONS SENT"), z.literal("NO FUNDS MOVED"), z.literal("NO PRIVATE KEYS STORED")]) }),
  dataSource: z.enum(["demo", "database", "chain"]),
});
export type ExecutionReadinessResponse = z.infer<typeof ExecutionReadinessResponse>;
const DecisionSchema = z.object({
  id: z.enum(DECISION_IDS),
  title: z.string(), category: z.enum(["PRODUCT", "TECHNICAL", "SECURITY", "LEGAL"]), status: z.enum(["DECIDED", "PENDING"]), value: z.record(z.string(), z.unknown()).nullable(),
  version: z.number().int(), provenance: z.enum(["EXISTING_CONFIGURATION", "ENGINEERING_DEFAULT", "NONE"]), environments: z.array(z.string()), invalidatesReadiness: z.boolean(), summary: z.string(), missing: z.string().nullable(),
  approval: z.object({ status: z.enum(["APPROVED", "PENDING_PRODUCT_APPROVAL", "REJECTED"]), approver: z.string().nullable(), approvedAt: z.string().nullable(), reference: z.string().nullable(), approvedVersion: z.number().int().nullable() }),
  dependsOn: z.array(z.string()), requires: z.array(z.string()),
  /** true while the decision is pending, unapproved, or approved for an older version */
  blocking: z.boolean(),
});
const MilestoneSchema = z.object({ id: z.string(), title: z.string(), after: z.array(z.string()), decisions: z.array(z.string()), blockedBy: z.array(z.string()), blockedByMilestones: z.array(z.string()), engineeringPrerequisites: z.array(z.string()), unblocked: z.boolean() });
export const DeploymentDecisionSummary = z.object({
  launchId: z.string().uuid(), policyVersion: z.number().int(), policyHash: z.string(), decisions: z.array(DecisionSchema),
  counts: z.object({ decided: z.number().int(), pending: z.number().int(), unapproved: z.number().int() }), blockingForThisLaunch: z.array(z.string()), milestones: z.array(MilestoneSchema),
  execution: z.object({ enabled: z.literal(false) }), dataSource: z.enum(["demo", "database", "chain"]),
});
export type DeploymentDecisionSummary = z.infer<typeof DeploymentDecisionSummary>;

export function buildDecisionSummary(launch: Launch, readiness: ExecutionReadiness, policy: DeploymentPolicy = DEPLOYMENT_POLICY): DeploymentDecisionSummary {
  const blocked = new Set(readiness.gates.filter((x) => x.blocking && x.decisionId).map((x) => x.decisionId as string));
  return DeploymentDecisionSummary.parse({
    launchId: launch.id, policyVersion: policy.version, policyHash: policyHashOf(policy), decisions: policy.decisions.map((d) => ({ ...d, blocking: !isApproved(d) })),
    counts: { decided: policy.decisions.filter((d) => d.status === "DECIDED").length, pending: policy.decisions.filter((d) => d.status === "PENDING").length, unapproved: policy.decisions.filter((d) => !isApproved(d)).length },
    milestones: MILESTONES.map((m) => { const st = milestoneStatus(policy, m.id); return { id: m.id, title: m.title, after: m.after, decisions: m.decisions, blockedBy: st.blockedByDecisions, blockedByMilestones: st.blockedByMilestones, engineeringPrerequisites: m.engineering, unblocked: st.unblocked }; }),
    blockingForThisLaunch: policy.decisions.filter((d) => blocked.has(d.id)).map((d) => d.id), execution: { enabled: false }, dataSource: launch.dataSource,
  });
}
export function buildReadinessResponse(launch: Launch, readiness: ExecutionReadiness): ExecutionReadinessResponse {
  return ExecutionReadinessResponse.parse({
    launchId: launch.id, readiness, execution: { enabled: false, label: "DISABLED", notices: ["NO TRANSACTIONS SENT", "NO FUNDS MOVED", "NO PRIVATE KEYS STORED"] }, dataSource: launch.dataSource,
  });
}

export const DeploymentAttemptView = z.object({
  id: z.string().uuid(), attemptNumber: z.number().int(), configFingerprint: z.string(), planHash: z.string(), policyHash: z.string(), environment: z.enum(["devnet", "mainnet-beta"]),
  mintPublicKey: z.string().nullable(), status: z.enum(["PLAN_BUILT", "FAILED", "CANCELLED"]), failureCategory: z.string().nullable(), createdAt: z.string().datetime(), historyIntact: z.boolean(), events: z.number().int(),
});
export const DeploymentAttemptList = z.object({
  launchId: z.string().uuid(), attempts: z.array(DeploymentAttemptView),
  /** a launch can be READY with no attempt; an attempt never rewrites the launch configuration */
  note: z.string(), execution: z.object({ enabled: z.literal(false) }),
});
export type DeploymentAttemptList = z.infer<typeof DeploymentAttemptList>;
