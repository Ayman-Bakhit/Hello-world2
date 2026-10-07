import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDeploymentPlan, fixtureAddress } from "./deployment";
import {
  DECISION_IDS, DEPLOYMENT_POLICY, MILESTONES, MILESTONE_IDS, REAL_EXECUTION_ENABLED, decisionOf, isApproved, milestoneBlockers, milestoneStatus, policyHash, withDecisions, type DecisionId, type DeploymentPolicy,
} from "./deploymentPolicy";
import { TOTAL_BPS } from "./feesplit";
import { buildDecisionSummary, evaluateExecutionReadiness, type GateId } from "./readiness";
import { launchFingerprint } from "./launchModel";
import { FIXTURE_CHARITY, fixtureReadyLaunch } from "./demo/deploymentFixtures";
import { fixtureLaunchConfig } from "./demo/proofFixtures";
import { TOKEN_PROGRAM, SYSTEM_PROGRAM, ASSOCIATED_TOKEN_PROGRAM } from "./chain/types";

const base = (policy?: DeploymentPolicy) => ({ launch: fixtureReadyLaunch(), charity: FIXTURE_CHARITY, planState: { recorded: true, supersededPlans: 0 }, ...(policy ? { policy } : {}) });
const gate = (r: ReturnType<typeof evaluateExecutionReadiness>, id: GateId) => r.gates.find((g) => g.id === id)!;
/** TEST-ONLY approval of one decision */
const approve = (p: DeploymentPolicy, id: DecisionId, over: Record<string, unknown> = {}): DeploymentPolicy => {
  const d = decisionOf(p, id);
  return withDecisions(p, { [id]: { approval: { status: "APPROVED", approver: "TEST-ONLY", approvedAt: "2000-01-01", reference: "TEST-ONLY", approvedVersion: d.version, ...over } } as never });
};
const DOC = readFileSync(join(__dirname, "../../../docs/PRODUCT_DECISIONS.md"), "utf8");

describe("PRODUCT_DECISIONS.md is the canonical record and cannot drift from the code", () => {
  const rows = new Map<string, string[]>();
  for (const l of DOC.split("\n")) { const m = l.match(/^\| `([A-Z_]+)` \|(.*)\|$/); if (m && (DECISION_IDS as readonly string[]).includes(m[1]!)) rows.set(m[1]!, l.split("|").slice(2, -1).map((c) => c.trim())); }
  it("has a status row for every decision, and no stray rows", () => {
    expect([...rows.keys()].sort()).toEqual([...DECISION_IDS].sort());
  });
  it("each row states the code's status, approval, dependencies and blocked milestones", () => {
    for (const d of DEPLOYMENT_POLICY.decisions) {
      const [status, approval, deps, blocks] = rows.get(d.id)!;
      expect(status!.startsWith(d.status), `${d.id} status`).toBe(true);
      expect(approval, `${d.id} approval`).toBe(isApproved(d) ? "APPROVED" : "PENDING PRODUCT APPROVAL");
      expect(deps === "none" ? [] : deps!.split(", ").sort(), `${d.id} depends`).toEqual([...d.dependsOn].sort());
      expect(blocks === "none" ? [] : blocks!.split(", ").sort(), `${d.id} blocks`).toEqual(MILESTONES.filter((m) => m.decisions.includes(d.id)).map((m) => m.id).sort());
    }
  });
  it("states the counts, every milestone, and the rules that matter", () => {
    expect(DOC).toContain(`Counts: ${DEPLOYMENT_POLICY.decisions.filter((d) => d.status === "DECIDED").length} DECIDED, ${DEPLOYMENT_POLICY.decisions.filter((d) => d.status === "PENDING").length} PENDING, ${DEPLOYMENT_POLICY.decisions.filter((d) => !isApproved(d)).length} without product approval`);
    for (const m of MILESTONE_IDS) expect(DOC, m).toContain(`\`${m}\``);
    for (const phrase of ["Approval is not implementation", "FEE_ROUTING_ENFORCEMENT_NOT_IMPLEMENTED", "PENDING PRODUCT APPROVAL", "Decisions the product owner must make next", "creator allocation", "Where the existing requirements conflict"]) expect(DOC.toLowerCase(), phrase).toContain(phrase.toLowerCase());
  });
  it("contains no address-shaped value, no URI and no observation (only program ids may appear in code)", () => {
    expect(DOC.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)?.filter((w) => !/^[A-Za-z_]+$/.test(w) || /\d/.test(w))).toBeUndefined();
    expect(DOC).not.toMatch(/https?:\/\//);
  });
});

describe("approval is explicit, versioned and never implied", () => {
  it("nothing is approved today: every decision lacks an approver, date, reference and version", () => {
    for (const d of DEPLOYMENT_POLICY.decisions) { expect(isApproved(d), d.id).toBe(false); expect(d.approval).toEqual({ status: "PENDING_PRODUCT_APPROVAL", approver: null, approvedAt: null, reference: null, approvedVersion: null }); }
  });
  it("an approval needs an approver, a date, a reference and the SAME version; a pending decision can never be approved; REJECTED is not approval", () => {
    const id: DecisionId = "TOKEN_PROGRAM";
    expect(isApproved(decisionOf(approve(DEPLOYMENT_POLICY, id), id))).toBe(true);
    for (const bad of [{ approver: null }, { approver: "  " }, { approvedAt: null }, { approvedAt: "last week" }, { reference: "" }, { approvedVersion: 99 }, { approvedVersion: null }, { status: "REJECTED" }, { status: "PENDING_PRODUCT_APPROVAL" }]) {
      expect(isApproved(decisionOf(approve(DEPLOYMENT_POLICY, id, bad), id)), JSON.stringify(bad)).toBe(false);
    }
    expect(isApproved(decisionOf(approve(DEPLOYMENT_POLICY, "PROTOCOL_DESTINATION"), "PROTOCOL_DESTINATION"))).toBe(false); // PENDING decision
    const bumped = withDecisions(approve(DEPLOYMENT_POLICY, id), { [id]: { version: 2 } });
    expect(isApproved(decisionOf(bumped, id))).toBe(false); // changing the decision invalidates the approval
  });
  it("PRODUCT_APPROVAL_COMPLETE names every unapproved decided item and stays blocking", () => {
    const g = gate(evaluateExecutionReadiness(base()), "PRODUCT_APPROVAL_COMPLETE");
    expect(g).toMatchObject({ status: "PENDING", blocking: true, category: "PRODUCT" });
    for (const d of DEPLOYMENT_POLICY.decisions.filter((x) => x.status === "DECIDED")) expect(g.reason).toContain(d.id);
    expect(g.reason).toMatch(/engineering default/); expect(g.reason).toMatch(/approval is not on-chain implementation/);
  });
  it("approving every decided item clears the gate; approving all but one does not", () => {
    const decided = DEPLOYMENT_POLICY.decisions.filter((d) => d.status === "DECIDED").map((d) => d.id);
    let p = DEPLOYMENT_POLICY;
    for (const id of decided.slice(1)) p = approve(p, id);
    expect(gate(evaluateExecutionReadiness(base(p)), "PRODUCT_APPROVAL_COMPLETE").status).toBe("PENDING");
    p = approve(p, decided[0]!);
    expect(gate(evaluateExecutionReadiness(base(p)), "PRODUCT_APPROVAL_COMPLETE").status).toBe("PASS");
    expect(evaluateExecutionReadiness(base(p)).prerequisitesMet).toBe(false); // the pending decisions still block
  });
  it("an approval changes the policy hash and the plan hash, so a recorded plan must be recorded again", () => {
    const plan = (p: DeploymentPolicy) => { const r = buildDeploymentPlan({ launch: fixtureReadyLaunch(), charity: FIXTURE_CHARITY, policy: p }); if (!r.ok) throw new Error("builds"); return r.plan.identity; };
    const a = approve(DEPLOYMENT_POLICY, "TOKEN_PROGRAM");
    expect(policyHash(a)).not.toBe(policyHash(DEPLOYMENT_POLICY)); expect(plan(a).planHash).not.toBe(plan(DEPLOYMENT_POLICY).planHash);
  });
});

describe("pending decisions block, and product approval never implies implementation", () => {
  const r = evaluateExecutionReadiness(base());
  it("undefined supply allocation cannot become executable: the gates block and the plan keeps the remainder UNASSIGNED", () => {
    expect(gate(r, "SUPPLY_ALLOCATION_DEFINED")).toMatchObject({ status: "PENDING", blocking: true }); expect(gate(r, "ALLOCATIONS_SUM_10000_BPS").blocking).toBe(true); expect(gate(r, "ALLOCATION_LOCKS_DEFINED").blocking).toBe(true);
    const plan = buildDeploymentPlan({ launch: fixtureReadyLaunch(), charity: FIXTURE_CHARITY }); if (!plan.ok) throw new Error("builds");
    expect(plan.plan.supplyAllocations.find((a) => a.role === "UNASSIGNED")).toMatchObject({ status: "UNDEFINED" });
    expect(plan.plan.instructions.find((i) => i.id === "mint-supply")!.status).toBe("BLOCKED");
    expect(milestoneBlockers(DEPLOYMENT_POLICY, "PLAN_EXECUTABLE")).toContain("SUPPLY_ALLOCATION_MODEL");
  });
  it("a decided fee split scope is not enforcement: routing still blocks until a mechanism is decided, implemented and enforcing", () => {
    const scoped = approve(withDecisions(DEPLOYMENT_POLICY, { FEE_SPLIT_SCOPE: { status: "DECIDED", value: { stream: "TEST_ONLY" }, missing: null, provenance: "ENGINEERING_DEFAULT" } }), "FEE_SPLIT_SCOPE");
    const rr = evaluateExecutionReadiness(base(scoped));
    expect(gate(rr, "FEE_SPLIT_SCOPE_DEFINED").status).toBe("PASS"); expect(gate(rr, "FEE_ROUTING_ENFORCEABLE")).toMatchObject({ blocking: true }); expect(gate(rr, "FEE_ROUTING_ENFORCEABLE").reason).toContain("FEE_ROUTING_ENFORCEMENT_NOT_IMPLEMENTED");
    const mech = approve(withDecisions(scoped, { FEE_ROUTING_MECHANISM: { status: "DECIDED", value: { mechanism: "TEST_ONLY", implemented: false, enforcesSplit: false, programId: null }, missing: null, provenance: "ENGINEERING_DEFAULT" } }), "FEE_ROUTING_MECHANISM");
    expect(gate(evaluateExecutionReadiness(base(mech)), "FEE_ROUTING_ENFORCEABLE").status).toBe("BLOCKED"); // approved, still not implemented
  });
  it("pending protocol destination, liquidity design, metadata hosting and product approval each block, and each blocks named milestones", () => {
    for (const [id, ms] of [["PROTOCOL_DESTINATION_VALID", ["PLAN_EXECUTABLE", "MINT_CREATION", "FEE_ROUTING"]], ["LIQUIDITY_STRATEGY_DEFINED", ["PLAN_EXECUTABLE", "LIQUIDITY_CREATION"]], ["METADATA_STRATEGY_DEFINED", ["PLAN_EXECUTABLE", "MINT_CREATION"]], ["PRODUCT_APPROVAL_COMPLETE", []]] as const) {
      expect(gate(r, id).blocking, id).toBe(true);
      void ms;
    }
    expect(milestoneBlockers(DEPLOYMENT_POLICY, "MINT_CREATION")).toEqual(expect.arrayContaining(["PROTOCOL_DESTINATION", "METADATA_HOSTING"]));
    expect(milestoneBlockers(DEPLOYMENT_POLICY, "LIQUIDITY_CREATION")).toContain("LIQUIDITY_STRATEGY");
  });
  it("a liquidity design that is approved but has no builder still blocks (decision is not implementation)", () => {
    const p = approve(withDecisions(DEPLOYMENT_POLICY, { LIQUIDITY_STRATEGY: { status: "DECIDED", value: { venue: "TEST_ONLY", builderImplemented: false }, missing: null, provenance: "ENGINEERING_DEFAULT" } }), "LIQUIDITY_STRATEGY");
    expect(gate(evaluateExecutionReadiness(base(p)), "LIQUIDITY_STRATEGY_DEFINED")).toMatchObject({ status: "BLOCKED", blocking: true });
  });
  it("the new governance and funding decisions block while pending", () => {
    for (const id of ["CHARITY_GOVERNANCE_DEFINED", "TAX_RESERVE_FUNDING_DEFINED"] as const) expect(gate(r, id), id).toMatchObject({ status: "PENDING", blocking: true });
  });
  it("every pending decision says exactly what is required", () => {
    for (const d of DEPLOYMENT_POLICY.decisions.filter((x) => x.status === "PENDING")) expect(d.requires.length, d.id).toBeGreaterThan(0);
    expect(decisionOf(DEPLOYMENT_POLICY, "LIQUIDITY_STRATEGY").requires.join(" ")).toMatch(/LP position/);
    expect(decisionOf(DEPLOYMENT_POLICY, "METADATA_HOSTING").requires.join(" ")).toMatch(/content-addressed/);
  });
  it("execution stays disabled whatever is approved or decided", () => {
    expect(REAL_EXECUTION_ENABLED).toBe(false);
    let p = DEPLOYMENT_POLICY;
    for (const d of DEPLOYMENT_POLICY.decisions) p = approve(p, d.id);
    const x = evaluateExecutionReadiness(base(p));
    expect(x.executionPermitted).toBe(false); expect(gate(x, "REAL_EXECUTION_ENABLED").blocking).toBe(true);
  });
});

describe("the dependency graph", () => {
  it("references only existing decisions and milestones, and is acyclic", () => {
    for (const d of DEPLOYMENT_POLICY.decisions) for (const x of d.dependsOn) { expect(DECISION_IDS).toContain(x); expect(x).not.toBe(d.id); }
    const visit = (id: DecisionId, path: DecisionId[]) => { expect(path, `cycle at ${id}`).not.toContain(id); for (const x of decisionOf(DEPLOYMENT_POLICY, id).dependsOn) visit(x, [...path, id]); };
    for (const id of DECISION_IDS) visit(id, []);
    for (const m of MILESTONES) { for (const a of m.after) expect(MILESTONE_IDS).toContain(a); for (const d of m.decisions) expect(DECISION_IDS).toContain(d); }
  });
  it("matches the stated order: scope before routing, liquidity before routing, allocation before liquidity", () => {
    const dep = (a: DecisionId, b: DecisionId) => expect(decisionOf(DEPLOYMENT_POLICY, a).dependsOn).toContain(b);
    dep("FEE_ROUTING_MECHANISM", "FEE_SPLIT_SCOPE"); dep("FEE_ROUTING_MECHANISM", "LIQUIDITY_STRATEGY"); dep("LIQUIDITY_STRATEGY", "SUPPLY_ALLOCATION_MODEL"); dep("PROTOCOL_DESTINATION", "FEE_ROUTING_MECHANISM"); dep("LEGAL_REVIEW", "FEE_SPLIT_SCOPE");
  });
  it("every milestone is blocked today; MAINNET waits on every decision; SIGNING waits on the security review", () => {
    for (const m of MILESTONE_IDS) expect(milestoneStatus(DEPLOYMENT_POLICY, m).unblocked, m).toBe(false);
    expect(milestoneBlockers(DEPLOYMENT_POLICY, "MAINNET").sort()).toEqual([...DECISION_IDS].sort());
    expect(milestoneBlockers(DEPLOYMENT_POLICY, "SIGNING")).toContain("SECURITY_REVIEW");
  });
  it("a milestone is unblocked only when its decisions are approved AND earlier milestones are unblocked", () => {
    let p = DEPLOYMENT_POLICY;
    for (const id of ["TOKEN_PROGRAM", "MINT_KEY_STRATEGY", "FEE_COMPUTE_POLICY", "ENVIRONMENT_POLICY"] as const) p = approve(p, id);
    p = approve(withDecisions(p, { SECURITY_REVIEW: { status: "DECIDED", value: { evidenceRef: "TEST", completedOn: "2000-01-01" }, missing: null, provenance: "ENGINEERING_DEFAULT" } }), "SECURITY_REVIEW");
    const s = milestoneStatus(p, "SIGNING");
    expect(s.blockedByDecisions).toEqual([]); expect(s.blockedByMilestones).toEqual(["PLAN_EXECUTABLE"]); expect(s.unblocked).toBe(false);
  });
  it("the decision summary exposes approval, dependencies, requirements, blocking and the milestones, and never an approve control", () => {
    const l = fixtureReadyLaunch(); const s = buildDecisionSummary(l, evaluateExecutionReadiness(base()));
    expect(s.counts).toEqual({ decided: 9, pending: 12, unapproved: 21 }); expect(s.decisions.every((d) => d.blocking)).toBe(true);
    expect(s.milestones.map((m) => m.id)).toEqual([...MILESTONE_IDS]); expect(s.milestones.every((m) => !m.unblocked)).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/"(approve|setApproval|canApprove)"/);
  });
});

describe("decision records cannot fabricate chain facts", () => {
  const PROGRAM_IDS = new Set([TOKEN_PROGRAM, SYSTEM_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"]);
  const walk = (v: unknown, path: string, hits: string[]) => {
    if (typeof v === "string") { if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) && !PROGRAM_IDS.has(v)) hits.push(`${path}=${v}`); if (/^https?:\/\//.test(v)) hits.push(`${path}=url`); }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, hits));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (/^(mintAddress|poolAddress|signature|transactionSignature|observed.*|confirmation|explorerUrl|lpMint)$/i.test(k)) hits.push(`${path}.${k}`); walk(x, `${path}.${k}`, hits); }
  };
  it("the policy in force holds no address (other than public program ids), URI, signature, pool, mint or observation", () => {
    const hits: string[] = []; walk(DEPLOYMENT_POLICY.decisions.map((d) => ({ id: d.id, value: d.value, approval: d.approval })), "policy", hits);
    expect(hits).toEqual([]);
    for (const d of DEPLOYMENT_POLICY.decisions) if (d.status === "PENDING") expect(d.value, d.id).toBeNull();
  });
  it("a protocol destination in a policy is data a person must supply, and the readiness gate validates it rather than trusting it", () => {
    const fake = withDecisions(DEPLOYMENT_POLICY, { PROTOCOL_DESTINATION: { status: "DECIDED", value: { address: "not-an-address", control: "MULTISIG", approvedBy: "x" }, missing: null, provenance: "ENGINEERING_DEFAULT" } });
    expect(gate(evaluateExecutionReadiness(base(fake)), "PROTOCOL_DESTINATION_VALID").status).toBe("BLOCKED");
    void fixtureAddress;
  });
});

describe("existing behavior is preserved", () => {
  it("the launch fingerprint of the reference configuration is unchanged (pinned from Slice 13)", () => {
    expect(launchFingerprint(fixtureLaunchConfig())).toBe("ca15804e40820b83cc6f4e508043af6c159d91c2aac1db87f0c11ecefa9e3800");
  });
  it("allocation shares still resolve exactly to 10000 bps", () => { expect(TOTAL_BPS).toBe(10000); });
  it("no new file in the policy or readiness layer can sign, send, serialize or touch a keypair", () => {
    for (const f of ["deploymentPolicy.ts", "readiness.ts"]) expect(readFileSync(join(__dirname, f), "utf8"), f).not.toMatch(/sendTransaction|sendRawTransaction|signTransaction|Keypair|requestAirdrop|simulateTransaction|\.sign\(/);
  });
});
