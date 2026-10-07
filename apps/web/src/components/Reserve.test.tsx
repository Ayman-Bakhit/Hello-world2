import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { BANNED_PHRASES, RESERVE_SCENARIOS, buildReserveScenario, buildReserveState, buildTax, DEMO_IDS, type ReserveInput, type ReserveScenarioId } from "@project-name/shared";
import { describe, expect, it } from "vitest";
import { createApiClient } from "@/lib/api/client";
import { validateTargetDraft } from "@/lib/reserveTarget";
import { TaxReserveView } from "./screens/TaxReserveScreen";
import { TaxView } from "./screens/TaxScreen";
import { ReserveSummary, TargetEditor, taxStatusBadge } from "./TaxReservePanels";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const view = (data: ReturnType<typeof buildReserveScenario>) => html(<TaxReserveView data={data} onSave={() => undefined} saving={false} saveError={null} savedNotice={false} />);
const scenario = (id: ReserveScenarioId) => view(buildReserveScenario(id));
const realWallet = (over: Partial<ReserveInput> = {}) => buildReserveState({
  walletId: DEMO_IDS.wallets.trading, taxSource: "TAX_ENGINE", taxStatus: "COMPLETE", exposureCents: 1_243_000n, netGainsCents: 5_810_000n, ratesSupplied: true, requirements: [], target: null, balance: null, ...over,
});

describe("reserve screen by tax status", () => {
  it("COMPLETE, no target: estimate, recommendation, set-target prompt, balance unavailable", () => {
    const out = scenario("COMPLETE_NO_TARGET");
    for (const t of ["Estimated tax exposure", "$12,430", "ESTIMATE · TAX DATA COMPLETE", "ESTIMATED RESERVE TARGET", "Recommended reserve", "No reserve target set.", "SET RESERVE TARGET",
      "RESERVE BALANCE UNAVAILABLE", "Reserve funding is not enabled in this beta."]) expect(out, t).toContain(t);
    expect(out).not.toContain("EDIT RESERVE TARGET");
  });
  it("PARTIAL: labeled as an incomplete estimate, with what is missing", () => {
    const out = scenario("PARTIAL");
    expect(out).toContain("ESTIMATED RESERVE — TAX DATA INCOMPLETE");
    expect(out).toContain("TAX DATA INCOMPLETE");
    expect(out).toContain("Tax data incomplete: this may be missing items.");
    expect(out).toContain("What is missing");
    expect(out).toContain("UNKNOWN or unassessed transactions");
  });
  it("DATA_REQUIRED: no recommendation or exposure number, and what is required", () => {
    const out = scenario("DATA_REQUIRED");
    expect(out).toContain("TAX DATA REQUIRED — NO RESERVE RECOMMENDATION");
    expect(out).toContain("What is missing");
    expect(out).toContain("a USD price is missing");
    expect(out).not.toContain("$12,430");
    expect(out.match(/UNAVAILABLE/g)!.length).toBeGreaterThanOrEqual(3);
  });
  it("UNAVAILABLE: NO TAX RESERVE ESTIMATE AVAILABLE", () => {
    const out = scenario("UNAVAILABLE");
    expect(out).toContain("NO TAX RESERVE ESTIMATE AVAILABLE");
    expect(out).toContain("No wallet has been synced");
    expect(out).not.toContain("$12,430");
  });
  it("no rates: asks for the user's own rates and assumes none", () => {
    const out = scenario("NO_RATES");
    expect(out).toContain("RATES REQUIRED FOR A RESERVE ESTIMATE");
    expect(out).toContain("none are assumed");
  });
  it("target below and above the estimate are described against the ESTIMATE", () => {
    expect(scenario("COMPLETE_TARGET_BELOW_ESTIMATE")).toContain("Target is 80.45% of the estimated exposure (an estimate).");
    expect(scenario("COMPLETE_TARGET_ABOVE_ESTIMATE")).toContain("Target is 125% of the estimated exposure (an estimate).");
    expect(scenario("COMPLETE_TARGET_BELOW_ESTIMATE")).toContain("EDIT RESERVE TARGET");
  });
  it("the demo balance fixture shows coverage as a share of the TARGET and the remaining amount, labeled DEMO", () => {
    const out = scenario("COMPLETE_DEMO_BALANCE");
    for (const t of ["DEMO RESERVE BALANCE", "$8,000.00", "80% of target", "$2,000.00", "DEMO DATA", "A fictional fixture balance. It is not real funds."]) expect(out, t).toContain(t);
    expect(out).not.toMatch(/80% of (your )?tax/i);
  });
  it("every demo scenario is labeled DEMO DATA, and only the balance fixture shows a balance", () => {
    for (const id of Object.keys(RESERVE_SCENARIOS) as ReserveScenarioId[]) {
      const out = scenario(id);
      expect(out, id).toContain("DEMO DATA");
      if (id !== "COMPLETE_DEMO_BALANCE") expect(out, id).toContain("RESERVE BALANCE UNAVAILABLE");
    }
  });
});

describe("real wallet behavior", () => {
  it("shows no demo label and no demo numbers, and RESERVE BALANCE UNAVAILABLE instead of $0", () => {
    const out = view(realWallet({ target: { targetType: "amount", percentBps: null, targetCents: 1_000_000n, source: "USER_SET", enabled: true, updatedAt: "2026-01-01T00:00:00.000Z", dataSource: "database" } }));
    expect(out).toContain("RESERVE BALANCE UNAVAILABLE");
    expect(out).not.toContain("DEMO DATA");
    expect(out).not.toContain("$14,200");
    expect(out).not.toMatch(/\$0\b/);
    expect(out).not.toMatch(/0 reserved/i);
    expect(out).toContain("$10,000"); // the user's own target is shown, as a target
    expect(out).toContain("UNAVAILABLE");
  });
  it("a real wallet with no tax data: NO TAX RESERVE ESTIMATE AVAILABLE and no fabricated numbers", () => {
    const out = view(realWallet({ taxStatus: "UNAVAILABLE", exposureCents: null, netGainsCents: null }));
    expect(out).toContain("NO TAX RESERVE ESTIMATE AVAILABLE");
    expect(out).not.toMatch(/\$\d/);
    expect(out).toContain("No reserve target set.");
  });
});

describe("tax page reserve summary", () => {
  it("shows the recommendation, an unavailable balance and no funding", () => {
    const d = buildReserveScenario("COMPLETE_NO_TARGET");
    const out = html(<ReserveSummary data={d} />);
    for (const t of ["Recommended reserve", "ESTIMATED RESERVE TARGET", "UNAVAILABLE", "RESERVE BALANCE UNAVAILABLE", "Reserve funding is not enabled in this beta."]) expect(out, t).toContain(t);
    const tax = html(<TaxView tax={buildTax(DEMO_IDS.wallets.trading)} reserve={d} details={null} />);
    expect(tax).toContain("Recommended reserve (estimate)");
    expect(tax).toContain("Reserve balance");
  });
});

describe("target editor", () => {
  it("starts closed with SET or EDIT, and never offers a fund movement", () => {
    const none = html(<TargetEditor data={buildReserveScenario("COMPLETE_NO_TARGET")} onSave={() => undefined} saving={false} error={null} />);
    expect(none).toContain("SET RESERVE TARGET");
    expect(none).toContain("STORED, NO FUNDS MOVE");
    expect(none).not.toMatch(/<input/);
    expect(html(<TargetEditor data={buildReserveScenario("COMPLETE_TARGET_BELOW_ESTIMATE")} onSave={() => undefined} saving={false} error={null} />)).toContain("EDIT RESERVE TARGET");
  });
  it("validates drafts with the API schema: positive, <= 2 decimals, digits only, exact cents", () => {
    const ok = validateTargetDraft({ kind: "amount", percent: "30", amount: "10000.5", enabled: true });
    expect(ok).toMatchObject({ ok: true, summary: "$10000.50 USDC" });
    if (ok.ok) expect(ok.request).toMatchObject({ targetType: "amount", targetAmount: "10000.5", currency: "USDC", enabled: true, confirmed: true });
    expect(validateTargetDraft({ kind: "percentage", percent: "12.5", amount: "", enabled: false })).toMatchObject({ ok: true, summary: "12.5% of realized gains (USDC) (disabled)" });
    for (const amount of ["", "0", "0.00", "-1", "NaN", "Infinity", "1e5", "+5", "5.123", "1,000", "abc", "٣", "9999999999999", " "]) {
      expect(validateTargetDraft({ kind: "amount", percent: "30", amount, enabled: true }), JSON.stringify(amount)).toMatchObject({ ok: false });
    }
    for (const percent of ["", "0", "-5", "100.01", "NaN", "1e2", "30.001"]) expect(validateTargetDraft({ kind: "percentage", percent, amount: "1", enabled: true }), percent).toMatchObject({ ok: false });
    const bad = validateTargetDraft({ kind: "amount", percent: "30", amount: "NaN", enabled: true });
    if (!bad.ok) expect(bad.errors.amount).toMatch(/digits only/);
  });
  it("a draft above 2^53 cents stays exact", () => {
    const r = validateTargetDraft({ kind: "amount", percent: "30", amount: "999999999999.99", enabled: true });
    expect(r).toMatchObject({ ok: true, summary: "$999999999999.99 USDC" });
  });
});

describe("mock client", () => {
  it("the demo reserve has a labeled balance; saving a target needs confirmation and persists only in memory", async () => {
    const c = createApiClient({ mode: "mock" });
    const before = await c.getTaxReserve("w1");
    expect(before).toMatchObject({ dataSource: "demo", reserveBalance: { source: "DEMO_FIXTURE" }, funding: { enabled: false } });
    await expect(c.setTaxReserveTarget("w1", { targetType: "amount", targetAmount: "5.00" })).rejects.toMatchObject({ status: 400 });
    const after = await c.setTaxReserveTarget("w1", { targetType: "amount", targetAmount: "5.00", confirmed: true });
    expect(after.userTarget).toMatchObject({ targetAmountCents: "500", source: "USER_SET", isMoney: false });
    expect(after.reserveBalance.source).toBe("DEMO_FIXTURE");
  });
  it("the status badge never claims certainty", () => {
    expect(taxStatusBadge("COMPLETE").label).toBe("TAX DATA COMPLETE");
    expect(taxStatusBadge("PARTIAL").label).toBe("TAX DATA INCOMPLETE");
    for (const s of ["COMPLETE", "PARTIAL", "DATA_REQUIRED", "UNAVAILABLE"] as const) expect(taxStatusBadge(s).label).not.toMatch(/verified|final|guarantee/i);
  });
});

describe("tax language lint (reserve)", () => {
  const sources = ["components/TaxReservePanels.tsx", "components/screens/TaxReserveScreen.tsx", "lib/reserveTarget.ts"].map((f) => readFileSync(join(__dirname, "..", f), "utf8").toLowerCase());
  it("rendered scenarios contain no banned or overclaiming phrase", () => {
    const pages = (Object.keys(RESERVE_SCENARIOS) as ReserveScenarioId[]).map(scenario).concat(view(realWallet())).join(" ").toLowerCase();
    for (const p of BANNED_PHRASES) expect(pages, p).not.toContain(p);
    expect(pages).not.toMatch(/your tax liability|your tax bill|you owe|final tax|\bguarantee|verified tax|authoritative|tax-free|tax advice\b(?!\.| and| consult)/);
    expect(pages).not.toMatch(/\bdeposited\b|\bsecured\b|\bescrow|\bheld in\b|funds are held/);
    expect(pages).toContain("not tax advice");
    expect(pages).toContain("consult a tax professional");
  });
  it("source files contain no banned phrase and no money-movement wording", () => {
    for (const t of sources) {
      for (const p of BANNED_PHRASES) expect(t, p).not.toContain(p);
      expect(t).not.toMatch(/dangerouslysetinnerhtml|\bdeposit\b|\bescrow|signtransaction|sendtransaction/);
    }
  });
});
