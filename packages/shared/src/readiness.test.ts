import { describe, expect, it } from "vitest";
import { LaunchConfigSchema } from "./api/schemas";
import { buildDeploymentPlan, fixtureAddress, FUTURE_FAILURES } from "./deployment";
import {
  ATTEMPT_STATES, ATTEMPT_STATES_WITHOUT_EXECUTION, ATTEMPT_TRANSITIONS, CLUSTERS, DECISION_IDS, DEPLOYMENT_POLICY, ENVIRONMENTS, EXECUTION_DISABLED_MESSAGE, ExecutionDisabledError, REAL_EXECUTION_ENABLED,
  assertExecutionDisabled, assertPlanCluster, attemptEventHash, attemptStateRecordable, canTransition, canonicalMetadataDocument, decisionOf, metadataDocumentSha256, policyHash, resolveSupplyAllocation,
  validateMintPublicKey, withDecisions, type DecisionId, type DeploymentPolicy, type SupplyAllocationModel,
} from "./deploymentPolicy";
import { CANONICAL_FEE_SPLIT, TOTAL_BPS } from "./feesplit";
import { BANNED_PHRASES } from "./language";
import { DeploymentDecisionSummary, GATE_IDS, buildDecisionSummary, buildReadinessResponse, evaluateExecutionReadiness, type GateId, type ReadinessInput } from "./readiness";
import { FIXTURE_CHARITY, fixtureReadyLaunch } from "./demo/deploymentFixtures";
import { FIXTURE_WALLETS, fixtureLaunchConfig } from "./demo/proofFixtures";
import { TOKEN_PROGRAM } from "./chain/types";
import { base58Encode } from "./deployment";

/** TEST-ONLY: every decision filled with an obviously fake value so the machinery can be exercised end to end. Never used outside tests. */
const TEST_REVIEW = { evidenceRef: "TEST-ONLY-NOT-A-REAL-REVIEW", completedOn: "2000-01-01" };
/** TEST-ONLY: records an approval for every decided item (a fake approver and reference), at the item's current version. */
const approveAll = (p: DeploymentPolicy): DeploymentPolicy => ({ version: p.version, decisions: p.decisions.map((d) => (d.status === "DECIDED" ? { ...d, approval: { status: "APPROVED" as const, approver: "TEST-ONLY", approvedAt: "2000-01-01", reference: "TEST-ONLY", approvedVersion: d.version } } : d)) });
const FULL: DeploymentPolicy = approveAll(withDecisions(DEPLOYMENT_POLICY, {
  SUPPLY_BURN_MECHANISM: { status: "DECIDED", value: { burn: "TEST_ONLY" }, missing: null, provenance: "ENGINEERING_DEFAULT" },
  ALLOCATION_LOCKS_AND_VESTING: { status: "DECIDED", value: { creator: "TRANSFERABLE_NOW", locks: "NONE" }, missing: null, provenance: "ENGINEERING_DEFAULT" },
  CHARITY_VERIFICATION_GOVERNANCE: { status: "DECIDED", value: { verifier: "TEST_ONLY" }, missing: null, provenance: "ENGINEERING_DEFAULT" },
  TAX_RESERVE_FUNDING: { status: "DECIDED", value: { asset: "TEST_ONLY", funding: "DESIGNATED_ONLY" }, missing: null, provenance: "ENGINEERING_DEFAULT" },
  METADATA_HOSTING: { status: "DECIDED", value: { uri: "https://example.invalid/test.json", contentAddressed: false }, missing: null, provenance: "ENGINEERING_DEFAULT" },
  SUPPLY_ALLOCATION_MODEL: { status: "DECIDED", value: { version: 1, charityBps: 1000, taxReserveBps: 1000, protocolBps: 1200, burnBps: 2000 } satisfies SupplyAllocationModel, missing: null, provenance: "ENGINEERING_DEFAULT" },
  FEE_SPLIT_SCOPE: { status: "DECIDED", value: { stream: "TEST_ONLY" }, missing: null, provenance: "ENGINEERING_DEFAULT" },
  FEE_ROUTING_MECHANISM: { status: "DECIDED", value: { mechanism: "TEST_ONLY", implemented: true, enforcesSplit: true, programId: null }, missing: null, provenance: "ENGINEERING_DEFAULT" },
  PROTOCOL_DESTINATION: { status: "DECIDED", value: { address: fixtureAddress("test-protocol"), control: "MULTISIG", approvedBy: "TEST-ONLY" }, missing: null, provenance: "ENGINEERING_DEFAULT" },
  LIQUIDITY_STRATEGY: { status: "DECIDED", value: { venue: "TEST_ONLY", builderImplemented: true }, missing: null, provenance: "ENGINEERING_DEFAULT" },
  SECURITY_REVIEW: { status: "DECIDED", value: TEST_REVIEW, missing: null, provenance: "ENGINEERING_DEFAULT" },
  SMART_CONTRACT_REVIEW: { status: "DECIDED", value: TEST_REVIEW, missing: null, provenance: "ENGINEERING_DEFAULT" },
  LEGAL_REVIEW: { status: "DECIDED", value: TEST_REVIEW, missing: null, provenance: "ENGINEERING_DEFAULT" },
}));
const ps = { recorded: true, supersededPlans: 0 };
const base = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({ launch: fixtureReadyLaunch(), charity: FIXTURE_CHARITY, planState: ps, ...over });
const gateOf = (r: ReturnType<typeof evaluateExecutionReadiness>, id: GateId) => r.gates.find((g) => g.id === id)!;
const cfg = (over: Record<string, unknown>) => ({ ...fixtureLaunchConfig(), ...over }) as never;

describe("the policy in force", () => {
  it("every decision is present once, typed, versioned and says what is missing when pending", () => {
    expect(DEPLOYMENT_POLICY.decisions.map((d) => d.id).sort()).toEqual([...DECISION_IDS].sort());
    for (const d of DEPLOYMENT_POLICY.decisions) {
      expect(d.version).toBeGreaterThanOrEqual(1); expect(d.invalidatesReadiness).toBe(true); expect(d.environments.length).toBeGreaterThan(0);
      if (d.status === "PENDING") { expect(d.value).toBeNull(); expect(d.provenance).toBe("NONE"); expect(d.missing!.length).toBeGreaterThan(20); }
      else { expect(d.value).not.toBeNull(); expect(d.missing).toBeNull(); expect(d.provenance).not.toBe("NONE"); }
    }
  });
  it("decided: token program, mint key, fee/compute, metadata format, fee split and scope, fee routing choice, supply semantics and allocation, charity model, tax reserve model, environments", () => {
    expect(DEPLOYMENT_POLICY.decisions.filter((d) => d.status === "DECIDED").map((d) => d.id).sort()).toEqual(["CHARITY_PAYOUT_MODEL", "ENVIRONMENT_POLICY", "FEE_COMPUTE_POLICY", "FEE_ROUTING_MECHANISM", "FEE_SPLIT", "FEE_SPLIT_SCOPE", "METADATA_DOCUMENT", "MINT_KEY_STRATEGY", "SUPPLY_ALLOCATION_MODEL", "SUPPLY_SEMANTICS", "TAX_RESERVE_MODEL", "TOKEN_PROGRAM"]);
  });
  it("pending (never guessed): burn mechanism, locks, metadata hosting, protocol destination, liquidity, charity governance, tax reserve funding and all three reviews", () => {
    expect(DEPLOYMENT_POLICY.decisions.filter((d) => d.status === "PENDING").map((d) => d.id).sort()).toEqual(["ALLOCATION_LOCKS_AND_VESTING", "CHARITY_VERIFICATION_GOVERNANCE", "LEGAL_REVIEW", "LIQUIDITY_STRATEGY", "METADATA_HOSTING", "PROTOCOL_DESTINATION", "SECURITY_REVIEW", "SMART_CONTRACT_REVIEW", "SUPPLY_BURN_MECHANISM", "TAX_RESERVE_FUNDING"]);
    for (const r of ["SECURITY_REVIEW", "SMART_CONTRACT_REVIEW", "LEGAL_REVIEW"] as const) expect(decisionOf(DEPLOYMENT_POLICY, r).status).toBe("PENDING"); // no audit or legal approval is claimed
  });
  it("the decided token program is classic SPL Token and records why Token-2022 is not used", () => {
    expect(decisionOf(DEPLOYMENT_POLICY, "TOKEN_PROGRAM").value).toMatchObject({ name: "SPL_TOKEN", programId: TOKEN_PROGRAM, token2022: "NOT_USED" });
    expect(decisionOf(DEPLOYMENT_POLICY, "TOKEN_PROGRAM").summary).toMatch(/Token-2022/);
  });
  it("the mint key decision keeps the private key in the client", () => {
    expect(decisionOf(DEPLOYMENT_POLICY, "MINT_KEY_STRATEGY").value).toMatchObject({ generatedIn: "CLIENT", privateKeyLeavesClient: false, serverReceives: "PUBLIC_KEY_ONLY", mintIsClientHeldSigner: true });
  });
  it("the fee/compute policy fixes who pays, forbids priority fees and retries, and hard-codes no lamport figure", () => {
    const v = decisionOf(DEPLOYMENT_POLICY, "FEE_COMPUTE_POLICY").value as Record<string, unknown>;
    expect(v).toMatchObject({ feePayer: "CREATOR_WALLET", platformPays: false, rentPayer: "CREATOR_WALLET", priorityFees: { allowed: false }, retry: "NONE_AUTOMATIC", maxTransactions: 2, maxTransactionBytes: 1232, computeBudget: "RUNTIME_SIMULATION_REQUIRED", lamportFigures: "NONE_STATIC" });
    expect(JSON.stringify(v)).not.toMatch(/lamports"?:\s*\d/);
  });
  it("the decided fee split is the canonical 60/15/15/10 and sums to 10000", () => {
    expect(decisionOf(DEPLOYMENT_POLICY, "FEE_SPLIT").value).toEqual(CANONICAL_FEE_SPLIT);
    expect(Object.values(CANONICAL_FEE_SPLIT).reduce((a, b) => a + b, 0)).toBe(TOTAL_BPS);
    expect(decisionOf(DEPLOYMENT_POLICY, "FEE_SPLIT").summary).toMatch(/nothing enforces it on-chain/);
  });
  it("no summary or missing text claims guarantees, immutability, automation or trustlessness", () => {
    for (const d of DEPLOYMENT_POLICY.decisions) {
      const t = `${d.summary} ${d.missing ?? ""} ${JSON.stringify(d.value)}`;
      expect(t, d.id).not.toMatch(/\b(guaranteed|immutable|trustless|automatic(ally)?|safe)\b/i);
      for (const b of BANNED_PHRASES) expect(t.toLowerCase(), d.id).not.toContain(b.toLowerCase());
    }
  });
  it("the policy hash changes with any single decision change", () => {
    const h = policyHash(DEPLOYMENT_POLICY); const seen = new Set([h]);
    for (const d of DEPLOYMENT_POLICY.decisions) { const x = policyHash(withDecisions(DEPLOYMENT_POLICY, { [d.id]: { version: d.version + 1 } })); expect(seen.has(x), d.id).toBe(false); seen.add(x); }
  });
});

describe("execution readiness: production policy", () => {
  const r = evaluateExecutionReadiness(base());
  it("is BLOCKED, never permits execution, and every gate carries a status, reason, provenance and blocking flag", () => {
    expect(r.overall).toBe("BLOCKED"); expect(r.prerequisitesMet).toBe(false); expect(r.executionPermitted).toBe(false);
    expect(r.gates.map((g) => g.id)).toEqual([...GATE_IDS]);
    for (const g of r.gates) { expect(g.reason.length).toBeGreaterThan(5); expect(g.provenance.length).toBeGreaterThan(3); expect(g.blocking).toBe(g.status === "BLOCKED" || g.status === "PENDING"); if (g.blocking) expect(g.required!.length).toBeGreaterThan(5); }
  });
  it("passes what is decided and true, and blocks the rest", () => {
    for (const id of ["LAUNCH_READY", "FINGERPRINT_CURRENT", "PLAN_BUILDABLE", "PLAN_RECORDED_CURRENT", "TOKEN_PROGRAM_SELECTED", "SUPPLY_ALLOCATION_DEFINED", "ALLOCATIONS_SUM_10000_BPS", "FEE_SPLIT_SCOPE_DEFINED", "FEE_ROUTING_DEFINED", "CHARITY_DESTINATIONS_VERIFIED", "TAX_RESERVE_DESTINATION_VALID", "FEE_SPLIT_VALID", "MINT_STRATEGY_DEFINED", "FEE_POLICY_DEFINED", "CLUSTER_VALID"] as const) expect(gateOf(r, id).status, id).toBe("PASS");
    for (const id of ["SUPPLY_BURN_MECHANISM_DEFINED", "METADATA_STRATEGY_DEFINED", "PROTOCOL_DESTINATION_VALID", "LIQUIDITY_STRATEGY_DEFINED", "FEE_ROUTING_ENFORCEABLE", "PRODUCT_APPROVAL_COMPLETE", "SECURITY_REVIEW_COMPLETE", "SMART_CONTRACT_REVIEW_COMPLETE", "LEGAL_REVIEW_COMPLETE"] as const) expect(gateOf(r, id).blocking, id).toBe(true);
    expect(gateOf(r, "REAL_EXECUTION_ENABLED")).toMatchObject({ status: "BLOCKED", blocking: true });
  });
  it("names the fee routing blocker exactly and never calls the configured split enforced", () => {
    const g = gateOf(r, "FEE_ROUTING_ENFORCEABLE");
    expect(g.reason).toContain("FEE_ROUTING_ENFORCEMENT_NOT_IMPLEMENTED"); expect(g.reason).toMatch(/no on-chain mechanism enforces it/);
    expect(gateOf(r, "FEE_SPLIT_VALID").reason).toMatch(/CONFIGURATION, not on-chain enforcement/);
    expect(gateOf(r, "PROTOCOL_DESTINATION_VALID").required).toMatch(/PROTOCOL_DESTINATION_PENDING/);
  });
  it("the summary adds up and the response never says ready", () => {
    const s = r.summary; expect(s.pass + s.blocked + s.pending + s.notApplicable).toBe(r.gates.length); expect(s.blocking).toBe(s.blocked + s.pending);
    const resp = buildReadinessResponse(base().launch, r);
    expect(resp.execution).toMatchObject({ enabled: false, label: "DISABLED" }); expect(JSON.stringify(resp)).not.toMatch(/READY_FOR_SIGNING/);
  });
});

describe("execution readiness: invariants", () => {
  it("with every decision filled (TEST-ONLY) all prerequisites pass and the answer is still EXECUTION_DISABLED, never permitted", () => {
    const r = evaluateExecutionReadiness(base({ policy: FULL }));
    expect(r.prerequisitesMet).toBe(true); expect(r.overall).toBe("EXECUTION_DISABLED"); expect(r.executionPermitted).toBe(false);
    expect(r.gates.filter((g) => g.blocking).map((g) => g.id)).toEqual(["REAL_EXECUTION_ENABLED"]);
    expect(gateOf(r, "SMART_CONTRACT_REVIEW_COMPLETE").status).toBe("NOT_APPLICABLE"); // no custom program in the test policy
    expect(gateOf(r, "ALLOCATIONS_SUM_10000_BPS").status).toBe("PASS");
  });
  it("making any one required decision PENDING again blocks readiness (one at a time)", () => {
    const required: DecisionId[] = ["SUPPLY_SEMANTICS", "SUPPLY_BURN_MECHANISM", "TOKEN_PROGRAM", "MINT_KEY_STRATEGY", "FEE_COMPUTE_POLICY", "METADATA_DOCUMENT", "METADATA_HOSTING", "SUPPLY_ALLOCATION_MODEL", "ALLOCATION_LOCKS_AND_VESTING", "CHARITY_VERIFICATION_GOVERNANCE", "TAX_RESERVE_FUNDING", "FEE_SPLIT", "FEE_SPLIT_SCOPE", "FEE_ROUTING_MECHANISM", "PROTOCOL_DESTINATION", "CHARITY_PAYOUT_MODEL", "TAX_RESERVE_MODEL", "LIQUIDITY_STRATEGY", "ENVIRONMENT_POLICY", "SECURITY_REVIEW", "LEGAL_REVIEW"];
    for (const id of required) {
      const p = withDecisions(FULL, { [id]: { status: "PENDING", value: null, provenance: "NONE", missing: "x" } });
      const r = evaluateExecutionReadiness(base({ policy: p }));
      expect(r.prerequisitesMet, id).toBe(false); expect(r.overall, id).toBe("BLOCKED");
    }
  });
  it("a configured fee split without an enforcing mechanism, and a venue without a builder, stay blocked", () => {
    const noEnforce = withDecisions(FULL, { FEE_ROUTING_MECHANISM: { value: { mechanism: "TEST_ONLY", implemented: false, enforcesSplit: false, programId: null } } });
    expect(gateOf(evaluateExecutionReadiness(base({ policy: noEnforce })), "FEE_ROUTING_ENFORCEABLE")).toMatchObject({ status: "BLOCKED", blocking: true });
    const noBuilder = withDecisions(FULL, { LIQUIDITY_STRATEGY: { value: { venue: "TEST_ONLY", builderImplemented: false } } });
    const g = gateOf(evaluateExecutionReadiness(base({ policy: noBuilder })), "LIQUIDITY_STRATEGY_DEFINED");
    expect(g.status).toBe("BLOCKED"); expect(g.reason).toContain("LIQUIDITY_BUILD_NOT_IMPLEMENTED");
  });
  it("pending or incomplete reviews block; a review needs an evidence reference and a date; the smart-contract review applies only if a custom program may exist", () => {
    for (const bad of [{ evidenceRef: "", completedOn: "2000-01-01" }, { evidenceRef: "x", completedOn: "yesterday" }, { evidenceRef: "   ", completedOn: "2000-01-01" }]) {
      expect(gateOf(evaluateExecutionReadiness(base({ policy: withDecisions(FULL, { LEGAL_REVIEW: { value: bad } }) })), "LEGAL_REVIEW_COMPLETE").status).toBe("BLOCKED");
    }
    const custom = withDecisions(FULL, { FEE_ROUTING_MECHANISM: { value: { mechanism: "TEST_ONLY", implemented: true, enforcesSplit: true, programId: fixtureAddress("prog") } }, SMART_CONTRACT_REVIEW: { status: "PENDING", value: null, provenance: "NONE", missing: "x" } });
    expect(gateOf(evaluateExecutionReadiness(base({ policy: custom })), "SMART_CONTRACT_REVIEW_COMPLETE")).toMatchObject({ status: "PENDING", blocking: true });
    const none = withDecisions(FULL, { SMART_CONTRACT_REVIEW: { status: "PENDING", value: null, provenance: "NONE", missing: "x" } });
    expect(gateOf(evaluateExecutionReadiness(base({ policy: none })), "SMART_CONTRACT_REVIEW_COMPLETE").status).toBe("NOT_APPLICABLE");
  });
  it("protocol destination must be a valid address with an approver", () => {
    for (const v of [{ address: "nope", control: "MULTISIG", approvedBy: "x" }, { address: fixtureAddress("p"), control: "MULTISIG", approvedBy: "" }, { address: fixtureAddress("p"), approvedBy: "x" }]) {
      expect(gateOf(evaluateExecutionReadiness(base({ policy: withDecisions(FULL, { PROTOCOL_DESTINATION: { value: v } }) })), "PROTOCOL_DESTINATION_VALID").status).toBe("BLOCKED");
    }
  });
  it("allocations that do not sum to 10000 bps, or are negative or fractional, are blocked; valid ones sum exactly", () => {
    for (const m of [{ charityBps: 1000, taxReserveBps: 1000, protocolBps: 1200, burnBps: 1999 }, { charityBps: -1, taxReserveBps: 1000, protocolBps: 1200, burnBps: 2000 }, { charityBps: 1000.5, taxReserveBps: 1000, protocolBps: 1200, burnBps: 2000 }, { charityBps: 6000, taxReserveBps: 6000, protocolBps: 1200, burnBps: 2000 }]) {
      const r = evaluateExecutionReadiness(base({ policy: withDecisions(FULL, { SUPPLY_ALLOCATION_MODEL: { value: { version: 1, ...m } } }) }));
      expect(gateOf(r, "ALLOCATIONS_SUM_10000_BPS").status, JSON.stringify(m)).toBe("BLOCKED"); expect(r.prerequisitesMet).toBe(false);
    }
  });
  it("PROPERTY: for any whole-number model that sums to 10000 the resolution sums to 10000; any other total is refused", () => {
    let seed = 7; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % (n + 1); };
    const c = LaunchConfigSchema.parse(fixtureLaunchConfig()); // creator 800 + liquidity 4000
    for (let i = 0; i < 300; i++) {
      const rest = TOTAL_BPS - 4800; const a = rnd(rest), b = rnd(rest - a), d = rnd(rest - a - b);
      const m: SupplyAllocationModel = { version: 1, charityBps: a, taxReserveBps: b, protocolBps: d, burnBps: rest - a - b - d };
      const r = resolveSupplyAllocation(c, m); expect(r.ok).toBe(true);
      if (r.ok) expect(r.entries.reduce((s, e) => s + e.bps, 0)).toBe(TOTAL_BPS);
      expect(resolveSupplyAllocation(c, { ...m, burnBps: m.burnBps + 1 }).ok).toBe(false);
      if (m.burnBps > 0) expect(resolveSupplyAllocation(c, { ...m, burnBps: m.burnBps - 1 }).ok).toBe(false);
    }
  });
  it("a non-READY launch, a stale fingerprint and a failed review block, and the plan cannot be built", () => {
    for (const status of ["DRAFT", "CONFIGURED", "REVIEW", "CANCELLED"] as const) {
      const r = evaluateExecutionReadiness(base({ launch: fixtureReadyLaunch(undefined, { status }), policy: FULL }));
      expect(gateOf(r, "LAUNCH_READY").status).toBe("BLOCKED"); expect(gateOf(r, "PLAN_BUILDABLE").status).toBe("BLOCKED"); expect(r.prerequisitesMet).toBe(false); expect(r.planHash).toBeNull();
    }
    const stale = evaluateExecutionReadiness(base({ launch: fixtureReadyLaunch(undefined, { reviewedFingerprint: "a".repeat(64) }), policy: FULL }));
    expect(gateOf(stale, "FINGERPRINT_CURRENT").status).toBe("BLOCKED"); expect(stale.prerequisitesMet).toBe(false);
    const l = fixtureReadyLaunch(); const edited = evaluateExecutionReadiness(base({ launch: { ...l, config: { ...l.config, name: "Edited After Review" } }, policy: FULL }));
    expect(gateOf(edited, "FINGERPRINT_CURRENT").status).toBe("BLOCKED");
  });
  it("the recorded plan must be current: none is PENDING, a stale one is BLOCKED", () => {
    expect(gateOf(evaluateExecutionReadiness(base({ planState: { recorded: false, supersededPlans: 0 }, policy: FULL })), "PLAN_RECORDED_CURRENT").status).toBe("PENDING");
    const s = gateOf(evaluateExecutionReadiness(base({ planState: { recorded: false, supersededPlans: 2 }, policy: FULL })), "PLAN_RECORDED_CURRENT");
    expect(s.status).toBe("BLOCKED"); expect(s.reason).toMatch(/stale/);
  });
  it("charity: missing, unverified, no wallet or an invalid wallet block", () => {
    for (const ch of [null, { ...FIXTURE_CHARITY, verificationState: "SUSPENDED" }, { ...FIXTURE_CHARITY, walletAddress: null }, { ...FIXTURE_CHARITY, walletAddress: "DEMOcharityWater111111111111" }]) {
      const r = evaluateExecutionReadiness(base({ charity: ch, policy: FULL })); expect(gateOf(r, "CHARITY_DESTINATIONS_VERIFIED").status).toBe("BLOCKED"); expect(r.prerequisitesMet).toBe(false);
    }
  });
  it("a changed charity wallet changes the plan hash, so a plan recorded before is stale", () => {
    const a = buildDeploymentPlan({ launch: fixtureReadyLaunch(), charity: FIXTURE_CHARITY }), b = buildDeploymentPlan({ launch: fixtureReadyLaunch(), charity: { ...FIXTURE_CHARITY, walletAddress: FIXTURE_WALLETS.other } });
    if (!a.ok || !b.ok) throw new Error("builds");
    expect(a.plan.identity.planHash).not.toBe(b.plan.identity.planHash);
  });
  it("a tax reserve destination that is not a valid address blocks (and the plan refuses to build)", () => {
    const l = fixtureReadyLaunch(cfg({ taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: "not-an-address-0000000000000000" } }));
    const r = evaluateExecutionReadiness(base({ launch: l, policy: FULL }));
    expect(gateOf(r, "TAX_RESERVE_DESTINATION_VALID").status).toBe("BLOCKED"); expect(gateOf(r, "PLAN_BUILDABLE").status).toBe("BLOCKED");
  });
  it("a changed fee split in the configuration is blocked", () => {
    const l = fixtureReadyLaunch(cfg({ feeSplit: { creator: 5000, taxReserve: 2500, charity: 1500, protocol: 1000 } }));
    expect(gateOf(evaluateExecutionReadiness(base({ launch: l, policy: FULL })), "FEE_SPLIT_VALID").status).toBe("BLOCKED");
  });
  it("a fee split different from the canonical 60/15/15/10 is blocked even if a decision record and the configuration agree with each other", () => {
    const odd = { creator: 5000, taxReserve: 2500, charity: 1500, protocol: 1000 };
    const l = fixtureReadyLaunch(cfg({ feeSplit: odd }));
    const r = evaluateExecutionReadiness(base({ launch: l, policy: withDecisions(FULL, { FEE_SPLIT: { value: odd } }) }));
    expect(gateOf(r, "FEE_SPLIT_VALID").status).toBe("BLOCKED"); expect(r.prerequisitesMet).toBe(false);
  });
  it("clusters: devnet passes, mainnet-beta needs all three reviews, a non-launch cluster is refused", () => {
    const main = fixtureReadyLaunch(cfg({ network: "mainnet-beta" }));
    expect(gateOf(evaluateExecutionReadiness(base({ launch: main })), "CLUSTER_VALID").status).toBe("BLOCKED");
    expect(gateOf(evaluateExecutionReadiness(base({ launch: main, policy: FULL })), "CLUSTER_VALID").status).toBe("PASS");
    const bad = fixtureReadyLaunch(cfg({ network: "local-fake" }));
    expect(gateOf(evaluateExecutionReadiness(base({ launch: bad, policy: FULL })), "CLUSTER_VALID").status).toBe("BLOCKED");
  });
  it("there is no input that can carry a frontend flag: extra fields change nothing", () => {
    const a = evaluateExecutionReadiness(base());
    const b = evaluateExecutionReadiness({ ...base(), ready: true, approved: true, executionEnabled: true, overall: "EXECUTION_DISABLED" } as never);
    expect(b).toEqual(a);
  });
  it("the decision summary reports counts and which decisions block this launch", () => {
    const l = base().launch; const r = evaluateExecutionReadiness(base());
    const s = DeploymentDecisionSummary.parse(buildDecisionSummary(l, r));
    expect(s.counts).toEqual({ decided: 12, pending: 10, unapproved: 11 }); expect(s.execution.enabled).toBe(false);
    expect(s.blockingForThisLaunch).toEqual(expect.arrayContaining(["SUPPLY_BURN_MECHANISM", "PROTOCOL_DESTINATION", "LIQUIDITY_STRATEGY", "FEE_ROUTING_MECHANISM", "METADATA_HOSTING", "LEGAL_REVIEW", "SECURITY_REVIEW"]));
    expect(s.blockingForThisLaunch).not.toContain("SUPPLY_ALLOCATION_MODEL"); // decided and consistent with this launch
  });
});

describe("plan integration (policy, environment, expected state)", () => {
  const plan = (policy?: DeploymentPolicy, launch = fixtureReadyLaunch()) => { const r = buildDeploymentPlan({ launch, charity: FIXTURE_CHARITY, ...(policy ? { policy } : {}) }); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.plan; };
  it("the plan carries the policy hash and its cluster environment; a changed decision changes the plan hash", () => {
    const p = plan();
    expect(p.identity.policyHash).toBe(policyHash(DEPLOYMENT_POLICY)); expect(p.environment).toMatchObject({ cluster: "devnet", environmentId: "devnet", executionAllowed: false });
    expect(p.environment.programs.tokenProgram).toBe(TOKEN_PROGRAM);
    const q = plan(withDecisions(DEPLOYMENT_POLICY, { FEE_ROUTING_MECHANISM: { version: 2 } }));
    expect(q.identity.planHash).not.toBe(p.identity.planHash); expect(q.identity.policyHash).not.toBe(p.identity.policyHash);
  });
  it("a plan built for one cluster is refused on another", () => {
    const dev = plan(); const main = plan(undefined, fixtureReadyLaunch(cfg({ network: "mainnet-beta" })));
    expect(assertPlanCluster(dev, "devnet")).toEqual({ ok: true }); expect(assertPlanCluster(dev, "mainnet-beta")).toMatchObject({ ok: false, code: "CLUSTER_MISMATCH" });
    expect(assertPlanCluster(main, "devnet")).toMatchObject({ ok: false, code: "CLUSTER_MISMATCH" }); expect(main.environment.cluster).toBe("mainnet-beta");
    expect(main.identity.planHash).not.toBe(dev.identity.planHash);
  });
  it("the plan refuses the local-fake cluster and every cluster is declared with its programs", () => {
    expect(buildDeploymentPlan({ launch: fixtureReadyLaunch(cfg({ network: "local-fake" })), charity: FIXTURE_CHARITY }).ok).toBe(false);
    for (const c of CLUSTERS) { expect(ENVIRONMENTS[c].executionAllowed).toBe(false); expect(ENVIRONMENTS[c].cluster).toBe(c); }
    expect(ENVIRONMENTS["local-fake"].launchAllowed).toBe(false);
  });
  it("expected state carries the cluster, the token program, the metadata document hash and a separate expected liquidity", () => {
    const e = plan().expectedState;
    expect(e).toMatchObject({ cluster: "devnet", tokenProgramName: "SPL_TOKEN", liquidityObserved: null, liquidity: { kind: "LIQUIDITY_EXPECTED" } });
    expect(e.metadata.documentSha256).toBe(metadataDocumentSha256(fixtureReadyLaunch().config));
  });
  it("an unsupported token program is refused whether it comes from the caller or from an undecided policy", () => {
    expect(buildDeploymentPlan({ launch: fixtureReadyLaunch(), charity: FIXTURE_CHARITY, tokenProgram: "TOKEN_2022" }).ok).toBe(false);
    const undecided = withDecisions(DEPLOYMENT_POLICY, { TOKEN_PROGRAM: { status: "PENDING", value: null, provenance: "NONE", missing: "x" } });
    expect(buildDeploymentPlan({ launch: fixtureReadyLaunch(), charity: FIXTURE_CHARITY, policy: undecided }).ok).toBe(false);
  });
});

describe("metadata document", () => {
  const c = fixtureReadyLaunch().config;
  it("is canonical, deterministic and changes with any field it contains", () => {
    expect(metadataDocumentSha256(c)).toMatch(/^[0-9a-f]{64}$/); expect(metadataDocumentSha256({ ...c })).toBe(metadataDocumentSha256(c));
    for (const over of [{ name: "Other" }, { symbol: "OTHR" }, { description: "different" }, { imageUri: "https://example.org/a.png" }, { website: "https://example.org" }]) expect(metadataDocumentSha256({ ...c, ...over }), JSON.stringify(over)).not.toBe(metadataDocumentSha256(c));
    expect(metadataDocumentSha256({ ...c, totalSupply: "5" })).toBe(metadataDocumentSha256(c)); // not a metadata field
    expect(Object.keys(canonicalMetadataDocument(c))).toEqual(["name", "symbol", "description", "seller_fee_basis_points"]);
  });
});

describe("mint public key binding (no key material, ever)", () => {
  it("accepts a well-formed public key", () => { expect(validateMintPublicKey(fixtureAddress("mint"))).toEqual({ ok: true, address: fixtureAddress("mint") }); });
  it("refuses secret-key-shaped values, garbage, non-strings, programs and reserved destinations", () => {
    expect(validateMintPublicKey(base58Encode(new Uint8Array(64).fill(9)))).toMatchObject({ ok: false, code: "SECRET_KEY_SHAPED" });
    expect(validateMintPublicKey(base58Encode(new Uint8Array(65).fill(9)))).toMatchObject({ ok: false, code: "SECRET_KEY_SHAPED" });
    for (const bad of ["", "not base58 !!", "DEMO3fB8cJ5yR1uH6dV2KEq47M", base58Encode(new Uint8Array(31).fill(3))]) expect(validateMintPublicKey(bad), bad).toMatchObject({ ok: false, code: "INVALID_ADDRESS" });
    for (const bad of [null, 5, {}, ["x"]]) expect(validateMintPublicKey(bad)).toMatchObject({ ok: false, code: "NOT_A_STRING" });
    expect(validateMintPublicKey(TOKEN_PROGRAM)).toMatchObject({ ok: false, code: "RESERVED_ADDRESS" });
    expect(validateMintPublicKey(FIXTURE_WALLETS.creator, [FIXTURE_WALLETS.creator])).toMatchObject({ ok: false, code: "RESERVED_ADDRESS" });
  });
  it("never echoes the refused value", () => {
    const secret = base58Encode(new Uint8Array(64).fill(7));
    expect(JSON.stringify(validateMintPublicKey(secret))).not.toContain(secret);
  });
});

describe("execution gate and the deployment attempt state machine", () => {
  it("real execution is a false constant and assertExecutionDisabled always throws", () => {
    expect(REAL_EXECUTION_ENABLED).toBe(false);
    expect(() => assertExecutionDisabled("sign")).toThrow(ExecutionDisabledError); expect(() => assertExecutionDisabled("send")).toThrow(EXECUTION_DISABLED_MESSAGE);
  });
  it("only states without a signature, send or confirmation are recordable now", () => {
    expect(ATTEMPT_STATES_WITHOUT_EXECUTION).toEqual(["PLAN_BUILT", "FAILED", "CANCELLED"]);
    for (const s of ATTEMPT_STATES) expect(attemptStateRecordable(s), s).toBe(ATTEMPT_STATES_WITHOUT_EXECUTION.includes(s));
  });
  it("the transition table is closed: terminal states go nowhere, every target is a known state, and the happy path is ordered", () => {
    for (const s of ATTEMPT_STATES) for (const t of ATTEMPT_TRANSITIONS[s]) expect(ATTEMPT_STATES).toContain(t);
    for (const s of ["VERIFIED", "FAILED", "CANCELLED"] as const) expect(ATTEMPT_TRANSITIONS[s]).toEqual([]);
    const path = ["PLAN_BUILT", "AWAITING_SIGNATURE", "SIGNED", "SUBMITTED", "CONFIRMING", "CONFIRMED", "RECONCILING", "VERIFIED"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    expect(canTransition("PLAN_BUILT", "SIGNED")).toBe(false); expect(canTransition("CONFIRMED", "VERIFIED")).toBe(false); expect(canTransition("VERIFIED", "FAILED")).toBe(false);
  });
  it("event hashes chain and change with any field", () => {
    const a = { attemptId: "x", seq: 1, status: "PLAN_BUILT" as const, failureCategory: null, note: null, prevHash: null };
    const h = attemptEventHash(a); expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(attemptEventHash({ ...a, seq: 2 })).not.toBe(h); expect(attemptEventHash({ ...a, status: "CANCELLED" })).not.toBe(h); expect(attemptEventHash({ ...a, prevHash: "a".repeat(64) })).not.toBe(h);
  });
  it("later-stage failure vocabulary stays separate from build errors", () => { expect(FUTURE_FAILURES.length).toBeGreaterThan(5); });
});
