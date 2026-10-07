import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LaunchConfigSchema } from "./api/schemas";
import { buildDeploymentPlan } from "./deployment";
import {
  CANONICAL_SUPPLY_MODEL, DEPLOYMENT_POLICY, REAL_EXECUTION_ENABLED, assertExecutionDisabled, decisionOf, isApproved, resolveSupplyAllocation,
} from "./deploymentPolicy";
import { evaluateExecutionReadiness } from "./readiness";
import { CANONICAL_SUPPLY_ALLOCATION, ISSUED_ROLES, SUPPLY_ROLES, bpsSum, issuedBps, supplyBreakdown } from "./supplyModel";
import { FIXTURE_CHARITY, fixtureReadyLaunch } from "./demo/deploymentFixtures";
import { fixtureLaunchConfig } from "./demo/proofFixtures";
import { TOKEN_PROGRAM } from "./chain/types";

const plan = (over: Record<string, unknown> = {}) => buildDeploymentPlan({ launch: fixtureReadyLaunch({ ...fixtureLaunchConfig(), ...over } as never), charity: FIXTURE_CHARITY });
const gateOf = (r: ReturnType<typeof evaluateExecutionReadiness>, id: string) => r.gates.find((g) => g.id === id)!;

describe("the canonical supply model: creator 8%, liquidity 40%, permanently unissued 52%", () => {
  it("is exactly 800 / 4000 / 5200 bps with 0 for charity, tax reserve and protocol, summing to 10000", () => {
    expect(CANONICAL_SUPPLY_ALLOCATION).toEqual({ CREATOR: 800, LIQUIDITY: 4000, CHARITY: 0, TAX_RESERVE: 0, PROTOCOL: 0, PERMANENTLY_UNISSUED: 5200 });
    expect(bpsSum(CANONICAL_SUPPLY_ALLOCATION)).toBe(10000); expect(issuedBps(CANONICAL_SUPPLY_ALLOCATION)).toBe(4800);
    expect(Object.isFrozen(CANONICAL_SUPPLY_ALLOCATION)).toBe(true);
    expect(SUPPLY_ROLES).toContain("PERMANENTLY_UNISSUED"); expect([...SUPPLY_ROLES].some((r) => /BURN/.test(r))).toBe(false);
    expect(ISSUED_ROLES).not.toContain("PERMANENTLY_UNISSUED");
  });
  it("the policy decision records the same numbers, marks them fixed and not configurable, and says never minted, not burned", () => {
    const d = decisionOf(DEPLOYMENT_POLICY, "SUPPLY_ALLOCATION_MODEL");
    expect(d.value).toMatchObject({ creatorBps: 800, liquidityBps: 4000, charityBps: 0, taxReserveBps: 0, protocolBps: 0, permanentlyUnissuedBps: 5200, fixed: true, configurable: false, permanentlyUnissuedMeaning: "NEVER_MINTED_NOT_BURNED" });
    expect(d.provenance).toBe("PRODUCT_OWNER_DECISION"); expect(isApproved(d)).toBe(true);
    expect(CANONICAL_SUPPLY_MODEL).toMatchObject({ creatorBps: 800, liquidityBps: 4000, permanentlyUnissuedBps: 5200 });
  });
  it("minted supply is exactly 48% of the intended supply, unissued 52%, and minted + unissued = intended (property over many supplies)", () => {
    let seed = 11; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 300; i++) {
      const supply = String((1 + rnd(900000)) * 25); const dec = rnd(10);
      const r = supplyBreakdown(supply, dec);
      if (!r.ok) continue; // a supply that would need rounding is refused, never rounded
      const v = r.value;
      expect(v.mintedRaw * 100n, supply).toBe(v.intendedRaw * 48n); expect(v.unissuedRaw * 100n).toBe(v.intendedRaw * 52n); expect(v.mintedRaw + v.unissuedRaw).toBe(v.intendedRaw);
      expect(v.roles.reduce((a, x) => a + x.raw, 0n)).toBe(v.intendedRaw);
    }
  });
  it("intended 100,000,000 gives creator 8,000,000 + liquidity 40,000,000 = minted 48,000,000; 52,000,000 is unissued; 100,000,000 is never on-chain", () => {
    const r = supplyBreakdown("100000000", 0); if (!r.ok) throw new Error("ok");
    expect(r.value.roles.map((x) => [x.role, x.raw, x.issued])).toEqual([["CREATOR", 8000000n, true], ["LIQUIDITY", 40000000n, true], ["CHARITY", 0n, true], ["TAX_RESERVE", 0n, true], ["PROTOCOL", 0n, true], ["PERMANENTLY_UNISSUED", 52000000n, false]]);
    expect(r.value.mintedRaw).toBe(48000000n); expect(r.value.unissuedRaw).toBe(52000000n); expect(r.value.intendedRaw).toBe(100000000n);
    expect(r.value.mintedRaw).not.toBe(r.value.intendedRaw);
  });
  it("a share that would need rounding is refused, and an allocation that does not sum to 10000 is refused", () => {
    expect(supplyBreakdown("7", 0)).toMatchObject({ ok: false, reason: "NOT_WHOLE_UNITS" });
    expect(supplyBreakdown("100", 0, { ...CANONICAL_SUPPLY_ALLOCATION, PERMANENTLY_UNISSUED: 5199 })).toMatchObject({ ok: false, reason: "DOES_NOT_SUM" });
    expect(supplyBreakdown("100", 0, { ...CANONICAL_SUPPLY_ALLOCATION, CHARITY: -1, PERMANENTLY_UNISSUED: 5201 })).toMatchObject({ ok: false, reason: "DOES_NOT_SUM" });
    expect(supplyBreakdown("18446744074", 9)).toMatchObject({ ok: false, reason: "OVERFLOW" });
  });
});

describe("no launch can use a different allocation or silently assign the unissued supply", () => {
  it("any creator share other than 8% is refused by the model and by the plan", () => {
    for (const p of ["0", "7.99", "8.01", "9", "10", "50"]) {
      const c = LaunchConfigSchema.parse({ ...fixtureLaunchConfig(), creatorAllocationPercent: p });
      expect(resolveSupplyAllocation(c, CANONICAL_SUPPLY_MODEL).ok, p).toBe(false);
      const r = plan({ creatorAllocationPercent: p }); expect(r.ok, p).toBe(false);
      if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("ALLOCATION_MODEL_MISMATCH");
    }
    expect(plan().ok).toBe(true);
  });
  it("any liquidity share other than 40% is refused", () => {
    for (const p of ["0", "39", "41", "52", "100"]) {
      const r = plan({ liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: p, lockDays: 30 } }); expect(r.ok, p).toBe(false);
      if (!r.ok && ["0", "39", "41"].includes(p)) expect(r.errors.map((e) => e.code)).toContain("ALLOCATION_MODEL_MISMATCH"); // 52 and 100 also overflow 100% with the creator share
    }
  });
  it("a policy model that moves any of the 52% to another role is refused even when it still sums to 10000", () => {
    const c = LaunchConfigSchema.parse(fixtureLaunchConfig());
    for (const role of ["charityBps", "taxReserveBps", "protocolBps"] as const) {
      const m = { ...CANONICAL_SUPPLY_MODEL, [role]: 100, permanentlyUnissuedBps: 5100 };
      const r = resolveSupplyAllocation(c, m); expect(r.ok, role).toBe(false);
    }
    expect(resolveSupplyAllocation(c, { ...CANONICAL_SUPPLY_MODEL, creatorBps: 900, permanentlyUnissuedBps: 5100 }).ok).toBe(false);
  });
  it("the unissued amount has no recipient and is not a mint target: only issued roles are minted", () => {
    const r = plan(); if (!r.ok) throw new Error("builds");
    const un = r.plan.supplyAllocations.find((a) => a.role === "PERMANENTLY_UNISSUED")!;
    expect(un).toMatchObject({ issued: false, bps: 5200 });
    const ex = r.plan.expectedState.allocations.find((a) => a.role === "PERMANENTLY_UNISSUED")!;
    expect(ex).toMatchObject({ recipient: null, issued: false });
    const issued = r.plan.supplyAllocations.filter((a) => a.issued);
    expect(issued.reduce((s, a) => s + BigInt(a.amountRaw!), 0n)).toBe(BigInt(r.plan.token.mintedSupplyRaw!));
    expect(JSON.stringify(r.plan).match(/BURN/g)).toBeNull();
  });
  it("52% is not represented as minted-and-burned anywhere in the plan, the review or the proof expectation", () => {
    const r = plan(); if (!r.ok) throw new Error("builds");
    const t = r.plan.token;
    expect(BigInt(t.mintedSupplyRaw!)).toBeLessThan(BigInt(t.intendedSupplyRaw)); expect(BigInt(t.mintedSupplyRaw!) * 100n).toBe(BigInt(t.intendedSupplyRaw) * 48n);
    expect(r.plan.instructions.some((i) => /burn/i.test(i.kind) || /burn/i.test(i.id))).toBe(false);
  });
});

describe("tax reserve destination, token program, execution", () => {
  it("the tax reserve destination is pending, blocks readiness, and is never shown as approved", () => {
    expect(decisionOf(DEPLOYMENT_POLICY, "TAX_RESERVE_FUNDING").status).toBe("PENDING");
    const r = evaluateExecutionReadiness({ launch: fixtureReadyLaunch(), charity: FIXTURE_CHARITY, planState: { recorded: true, supersededPlans: 0 } });
    const g = gateOf(r, "TAX_RESERVE_DESTINATION_VALID");
    expect(g).toMatchObject({ status: "PENDING", blocking: true }); expect(g.reason).toMatch(/compatibility field/); expect(g.reason).toMatch(/not an approved destination/);
    expect(r.prerequisitesMet).toBe(false);
    const p = plan(); if (!p.ok) throw new Error("builds");
    expect(p.plan.destinations.find((d) => d.role === "TAX_RESERVE")).toMatchObject({ validation: "PENDING_DECISION", provenance: "LAUNCH_CONFIGURATION_COMPATIBILITY_FIELD" });
    expect(p.plan.blockers.map((b) => b.code)).toContain("TAX_RESERVE_DESTINATION_PENDING");
  });
  it("SPL Token classic remains the approved default; Token-2022 is not used", () => {
    const d = decisionOf(DEPLOYMENT_POLICY, "TOKEN_PROGRAM");
    expect(isApproved(d)).toBe(true); expect(d.value).toMatchObject({ name: "SPL_TOKEN", programId: TOKEN_PROGRAM, token2022: "NOT_USED" });
    const p = plan(); if (!p.ok) throw new Error("builds");
    expect(p.plan.identity.tokenProgram).toMatchObject({ name: "SPL_TOKEN", programId: TOKEN_PROGRAM, token2022: "NOT_IMPLEMENTED" });
  });
  it("no execution path was introduced: execution stays disabled, the guard throws, readiness never permits", () => {
    expect(REAL_EXECUTION_ENABLED).toBe(false); expect(() => assertExecutionDisabled("test")).toThrow();
    const r = evaluateExecutionReadiness({ launch: fixtureReadyLaunch(), charity: FIXTURE_CHARITY, planState: { recorded: true, supersededPlans: 0 } });
    expect(r.executionPermitted).toBe(false); expect(r.overall).toBe("BLOCKED");
    const p = plan(); if (!p.ok) throw new Error("builds");
    expect(p.plan.executionEnabled).toBe(false); expect(p.plan.environment.executionAllowed).toBe(false); expect(p.plan.signingBoundary).toMatchObject({ serverSigns: false, serverHoldsKeys: false, submission: "NOT_IMPLEMENTED" });
  });
  it("the unissued supply is permanent only with the mint authority revoked: a launch that keeps it is refused and readiness names the gate", () => {
    const r = plan({ mintAuthority: "creator" }); expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("UNISSUED_SUPPLY_NOT_PERMANENT");
    const g = gateOf(evaluateExecutionReadiness({ launch: fixtureReadyLaunch({ ...fixtureLaunchConfig(), mintAuthority: "creator" } as never), charity: FIXTURE_CHARITY, planState: { recorded: true, supersededPlans: 0 } }), "UNISSUED_SUPPLY_PERMANENT");
    expect(g).toMatchObject({ status: "BLOCKED", blocking: true });
    expect(gateOf(evaluateExecutionReadiness({ launch: fixtureReadyLaunch(), charity: FIXTURE_CHARITY, planState: { recorded: true, supersededPlans: 0 } }), "UNISSUED_SUPPLY_PERMANENT").reason).toMatch(/nothing has been revoked yet/);
  });
});

describe("the canonical docs use the settled wording", () => {
  const DOC = readFileSync(join(__dirname, "../../../docs/PRODUCT_DECISIONS.md"), "utf8");
  it("states 8% / 40% / 52% permanently unissued, never minted and not burned, with the concrete example; \"52% burn\" appears only to explain the rejected alternative", () => {
    for (const p of ["permanently unissued", "never minted", "not burned", "100,000,000", "48,000,000", "52,000,000", "8,000,000", "40,000,000", "PERMANENTLY_UNISSUED"]) expect(DOC, p).toContain(p);
    for (const l of DOC.split("\n").filter((x) => /52% burn/i.test(x))) expect(l, l).toMatch(/Replace|rejected|called/i);
  });
});
