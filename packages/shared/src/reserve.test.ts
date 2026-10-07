import { describe, expect, it } from "vitest";
import {
  BANNED_PHRASES, DEFAULT_RESERVE_POLICY, RESERVE_COPY, RESERVE_POLICIES, RESERVE_SCENARIOS, TaxReserveResponse, buildReserveScenario, buildReserveState,
  percentFromBps, type ReserveInput, type ReserveScenarioId,
} from "./index";

const real = (over: Partial<ReserveInput> = {}): ReserveInput => ({
  walletId: "00000000-0000-4000-8000-000000000001", taxSource: "TAX_ENGINE", taxStatus: "COMPLETE", exposureCents: 1_243_000n, netGainsCents: 5_810_000n,
  ratesSupplied: true, requirements: [], target: null, balance: null, ...over,
});
const tgt = (cents: bigint, over = {}) => ({ targetType: "amount" as const, percentBps: null, targetCents: cents, source: "USER_SET" as const, enabled: true, updatedAt: "2026-01-01T00:00:00.000Z", dataSource: "database" as const, ...over });

describe("recommendation respects the tax status (never upgrades certainty)", () => {
  it("COMPLETE: an estimate equal to the estimated exposure", () => {
    const r = buildReserveState(real());
    expect(r.recommendation).toMatchObject({ status: "ESTIMATE", label: "ESTIMATED RESERVE TARGET", recommendedCents: "1243000", authoritative: false, source: "SYSTEM_RECOMMENDATION" });
    expect(r.taxEstimate).toMatchObject({ status: "COMPLETE", estimatedExposureCents: "1243000", incomplete: false, authoritative: false, verifiedOnChain: false, label: "ESTIMATE" });
  });
  it("PARTIAL: shown only as an estimate with the incompleteness disclosed", () => {
    const r = buildReserveState(real({ taxStatus: "PARTIAL", requirements: [{ kind: "HISTORY", severity: "incomplete", count: 1, message: "Wallet history is incomplete" }] }));
    expect(r.recommendation).toMatchObject({ status: "ESTIMATE_INCOMPLETE", label: "ESTIMATED RESERVE — TAX DATA INCOMPLETE", recommendedCents: "1243000" });
    expect(r.recommendation.reason).toMatch(/incomplete/);
    expect(r.taxEstimate.incomplete).toBe(true);
    expect(r.taxEstimate.missing.map((m) => m.kind)).toContain("HISTORY");
  });
  it("DATA_REQUIRED: no recommendation and no exposure figure, with what is missing", () => {
    const r = buildReserveState(real({ taxStatus: "DATA_REQUIRED", exposureCents: 500_000n, requirements: [{ kind: "PRICE", severity: "blocks_total", count: 3, message: "price missing" }] }));
    expect(r.recommendation).toMatchObject({ status: "WITHHELD", recommendedCents: null, label: "TAX DATA REQUIRED — NO RESERVE RECOMMENDATION" });
    expect(r.taxEstimate.estimatedExposureCents).toBeNull();
    expect(r.taxEstimate.withheldReason).toMatch(/not a total/);
    expect(r.taxEstimate.missing).toEqual([{ kind: "PRICE", severity: "blocks_total", count: 3, message: "price missing" }]);
  });
  it("UNAVAILABLE: nothing", () => {
    const r = buildReserveState(real({ taxStatus: "UNAVAILABLE", exposureCents: null, netGainsCents: null }));
    expect(r.recommendation).toMatchObject({ status: "UNAVAILABLE", recommendedCents: null, label: "NO TAX RESERVE ESTIMATE AVAILABLE" });
    expect(r.taxEstimate.estimatedExposureCents).toBeNull();
  });
  it("no tax rates supplied: no recommendation, no invented rate", () => {
    const r = buildReserveState(real({ ratesSupplied: false, exposureCents: null }));
    expect(r.recommendation).toMatchObject({ status: "UNAVAILABLE", recommendedCents: null, label: "RATES REQUIRED FOR A RESERVE ESTIMATE" });
    expect(r.taxEstimate.withheldReason).toMatch(/none are assumed/);
    // even if a caller passes an exposure without rates, none is shown
    expect(buildReserveState(real({ ratesSupplied: false, exposureCents: 99n })).taxEstimate.estimatedExposureCents).toBeNull();
  });
  it("property: the recommendation never exceeds what the status allows, for every status and input", () => {
    for (const status of ["COMPLETE", "PARTIAL", "DATA_REQUIRED", "UNAVAILABLE"] as const) for (const rates of [true, false]) for (const exp of [null, 0n, 1n, 123_456_789_012_345n]) {
      const r = buildReserveState(real({ taxStatus: status, ratesSupplied: rates, exposureCents: exp }));
      const rec = r.recommendation;
      if (status === "DATA_REQUIRED" || status === "UNAVAILABLE" || !rates || exp === null) {
        expect(rec.recommendedCents).toBeNull();
        expect(["WITHHELD", "UNAVAILABLE"]).toContain(rec.status);
      } else {
        expect(rec.recommendedCents).toBe(exp.toString());
        expect(rec.status).toBe(status === "COMPLETE" ? "ESTIMATE" : "ESTIMATE_INCOMPLETE");
      }
      expect(rec.authoritative).toBe(false);
      expect(r.taxEstimate.authoritative).toBe(false);
      expect(r.verifiedOnChain).toBe(false);
    }
  });
  it("the policy is the identity and no tax rate or percentage exists in the layer", () => {
    expect(DEFAULT_RESERVE_POLICY).toBe("EXPOSURE_1X");
    for (const e of [0n, 1n, 1_243_000n, 10n ** 20n]) expect(RESERVE_POLICIES.EXPOSURE_1X(e)).toBe(e);
    expect(Object.keys(RESERVE_POLICIES)).toEqual(["EXPOSURE_1X"]);
  });
  it("is deterministic", () => {
    const a = JSON.stringify(buildReserveState(real({ target: tgt(1_000_000n) })));
    expect(JSON.stringify(buildReserveState(real({ target: tgt(1_000_000n) })))).toBe(a);
  });
});

describe("balance, coverage and remaining are unavailable without a real balance", () => {
  it("a real wallet has no balance: UNAVAILABLE, never $0, never funded", () => {
    const r = buildReserveState(real({ target: tgt(1_000_000n) }));
    expect(r.reserveBalance).toMatchObject({ source: "UNAVAILABLE", status: "NOT_CONNECTED", cents: null, label: "RESERVE BALANCE UNAVAILABLE" });
    expect(r.coverage).toMatchObject({ available: false, bps: null, label: "UNAVAILABLE" });
    expect(r.remaining).toMatchObject({ available: false, cents: null });
    expect(r.coverage.reason).toBe("Reserve balance is unavailable.");
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/"cents":"0"/);
    expect(r.funding).toEqual({ enabled: false, message: "Reserve funding is not enabled in this beta.", custody: "none", moneyMovement: "NOT_ENABLED" });
  });
  it("the target is never the balance and the recommendation is never the funded amount", () => {
    const r = buildReserveState(real({ target: tgt(1_243_000n) })); // target == recommendation == exposure
    expect(r.reserveBalance.cents).toBeNull();
    expect(r.coverage.available).toBe(false);
    expect(r.userTarget.isMoney).toBe(false);
    expect(r.remaining.cents).toBeNull();
  });
  it("a fixture balance is refused unless the tax estimate itself is a demo fixture", () => {
    expect(() => buildReserveState(real({ balance: { source: "DEMO_FIXTURE", cents: 1n } }))).toThrow(/only allowed with a demo/);
  });
  it("negative inputs are refused", () => {
    expect(() => buildReserveState(real({ exposureCents: -1n }))).toThrow();
    expect(() => buildReserveState({ ...real({ taxSource: "DEMO_FIXTURE" }), balance: { source: "DEMO_FIXTURE", cents: -1n } })).toThrow();
  });
  it("demo fixture: $8,000 against a $10,000 target is 80% of target, with $2,000 remaining", () => {
    const r = buildReserveScenario("COMPLETE_DEMO_BALANCE");
    expect(r.reserveBalance).toMatchObject({ source: "DEMO_FIXTURE", status: "DEMO", label: "DEMO RESERVE BALANCE", cents: "800000" });
    expect(r.coverage).toMatchObject({ available: true, bps: 8000, label: "80% of target" });
    expect(r.coverage.label).not.toMatch(/liability|tax bill/i);
    expect(r.remaining).toMatchObject({ available: true, cents: "200000" });
    expect(r.dataSource).toBe("demo");
  });
  it("over-funded fixture reports 0 remaining, and a tiny target cannot overflow the ratio", () => {
    const over = buildReserveState({ ...real({ taxSource: "DEMO_FIXTURE", target: tgt(100n) }), balance: { source: "DEMO_FIXTURE", cents: 250n } });
    expect(over.coverage.bps).toBe(25_000);
    expect(over.remaining.cents).toBe("0");
    const huge = buildReserveState({ ...real({ taxSource: "DEMO_FIXTURE", target: tgt(1n) }), balance: { source: "DEMO_FIXTURE", cents: 10n ** 30n } });
    expect(Number.isSafeInteger(huge.coverage.bps)).toBe(true);
  });
});

describe("user target", () => {
  it("none: 'No reserve target set.' and no resolved numbers", () => {
    const r = buildReserveState(real());
    expect(r.userTarget).toMatchObject({ set: false, source: null, label: "No reserve target set.", resolvedCents: null, effectiveCents: null });
    expect(r.targetVsExposure).toMatchObject({ available: false, reason: "No reserve target set." });
  });
  it("target below the estimate: described relative to the ESTIMATE, not as a tax liability", () => {
    const r = buildReserveScenario("COMPLETE_TARGET_BELOW_ESTIMATE"); // $10,000 vs $12,430
    expect(r.targetVsExposure).toMatchObject({ available: true, bps: 8045 });
    expect(r.targetVsExposure.wording).toBe("Target is 80.45% of the estimated exposure (an estimate).");
    expect(r.targetVsExposure.wording).not.toMatch(/liability/i);
  });
  it("target above the estimate", () => {
    const r = buildReserveScenario("COMPLETE_TARGET_ABOVE_ESTIMATE"); // $10,000 vs $8,000
    expect(r.targetVsExposure).toMatchObject({ available: true, bps: 12_500 });
  });
  it("target vs exposure is unavailable when exposure is unavailable or zero", () => {
    expect(buildReserveScenario("UNAVAILABLE").targetVsExposure).toMatchObject({ available: false, reason: "Estimated exposure is unavailable." });
    expect(buildReserveScenario("DATA_REQUIRED").targetVsExposure.available).toBe(false);
    expect(buildReserveState(real({ exposureCents: 0n, target: tgt(5n) })).targetVsExposure).toMatchObject({ available: false, reason: "Estimated exposure is zero." });
  });
  it("a percentage target resolves only from an available estimate of gains, and gains are never negative", () => {
    const pct = { targetType: "percentage" as const, percentBps: 2500, targetCents: null };
    expect(buildReserveState(real({ target: tgt(0n, pct) })).userTarget.resolvedCents).toBe("1452500"); // 25% of $58,100.00
    expect(buildReserveState(real({ netGainsCents: -100n, target: tgt(0n, pct) })).userTarget.resolvedCents).toBe("0");
    const dr = buildReserveState(real({ taxStatus: "DATA_REQUIRED", target: tgt(0n, pct) }));
    expect(dr.userTarget.resolvedCents).toBeNull();
    expect(dr.userTarget.resolutionNote).toMatch(/needs an available estimate/);
    expect(buildReserveState(real({ target: tgt(0n, pct) })).userTarget.targetPercentage).toBe("25");
  });
  it("a disabled target is configuration only: no effective value, no coverage", () => {
    const r = buildReserveState({ ...real({ taxSource: "DEMO_FIXTURE", target: tgt(1_000_000n, { enabled: false }) }), balance: { source: "DEMO_FIXTURE", cents: 1n } });
    expect(r.userTarget).toMatchObject({ enabled: false, resolvedCents: "1000000", effectiveCents: null, label: "USER TARGET (DISABLED)" });
    expect(r.coverage.available).toBe(false);
    expect(r.coverage.reason).toBe("The target is disabled.");
  });
  it("target source is preserved as configuration provenance", () => {
    expect(buildReserveState(real({ target: tgt(1n, { source: "SYSTEM_RECOMMENDED" }) })).userTarget.source).toBe("SYSTEM_RECOMMENDED");
    expect(buildReserveState(real({ target: tgt(1n) })).userTarget.source).toBe("USER_SET");
  });
  it("amounts above 2^53 stay exact", () => {
    const big = 9_007_199_254_740_993_123n;
    const r = buildReserveState(real({ exposureCents: big, target: tgt(big) }));
    expect(r.recommendation.recommendedCents).toBe(big.toString());
    expect(r.userTarget.effectiveCents).toBe(big.toString());
    expect(r.targetVsExposure.bps).toBe(10_000);
  });
});

describe("fixture scenarios", () => {
  const ids = Object.keys(RESERVE_SCENARIOS) as ReserveScenarioId[];
  it("cover every required case, and every one parses and is labeled demo", () => {
    expect(ids).toEqual(expect.arrayContaining(["COMPLETE_NO_TARGET", "COMPLETE_TARGET_BELOW_ESTIMATE", "COMPLETE_TARGET_ABOVE_ESTIMATE", "COMPLETE_DEMO_BALANCE", "PARTIAL", "DATA_REQUIRED", "UNAVAILABLE"]));
    for (const id of ids) {
      const r = TaxReserveResponse.parse(buildReserveScenario(id));
      expect(r.dataSource, id).toBe("demo");
      expect(r.taxEstimate.source, id).toBe("DEMO_FIXTURE");
      expect(r.verifiedOnChain, id).toBe(false);
      if (id !== "COMPLETE_DEMO_BALANCE") expect(r.reserveBalance.source, id).toBe("UNAVAILABLE");
    }
  });
  it("only the one fixture with a balance shows a balance", () => {
    expect(ids.filter((id) => buildReserveScenario(id).reserveBalance.cents !== null)).toEqual(["COMPLETE_DEMO_BALANCE"]);
  });
});

describe("language", () => {
  it("never calls anything verified, guaranteed, final or a bill", () => {
    const text = ([...Object.keys(RESERVE_SCENARIOS)] as ReserveScenarioId[]).map((id) => JSON.stringify(buildReserveScenario(id))).join(" ") + Object.values(RESERVE_COPY).join(" ");
    const lower = text.toLowerCase();
    for (const p of BANNED_PHRASES) expect(lower, p).not.toContain(p);
    expect(lower).not.toMatch(/\bguarantee|authoritative":true|final tax|your tax liability|you owe|tax-free|deposited|secured|funded\b(?! amount)/);
    expect(RESERVE_COPY.fundingDisabled).toBe("Reserve funding is not enabled in this beta.");
  });
  it("the banned list covers the Slice 10 phrases", () => {
    for (const p of ["your tax bill", "guaranteed tax liability", "guaranteed tax savings", "guaranteed deduction", "tax loophole", "tax-free", "irs-approved reserve", "guaranteed tax result"]) expect(BANNED_PHRASES).toContain(p);
  });
  it("percent formatting", () => {
    expect(percentFromBps(8000)).toBe("80%");
    expect(percentFromBps(8045)).toBe("80.45%");
    expect(percentFromBps(8050)).toBe("80.5%");
    expect(percentFromBps(5)).toBe("0.05%");
  });
});
