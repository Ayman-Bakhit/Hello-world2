import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BANNED_PHRASES, estimateTax, reserveStatus, validateFeeSplit, type RealizedEvent } from "@project-name/shared";
import { describe, expect, it } from "vitest";
import { portfolioRows, portfolioTotals } from "@/lib/portfolio";
import { DEMO_CHARITIES, DEMO_DONATIONS, DEMO_PORTFOLIO, DEMO_TAX_ESTIMATE as E, DEMO_TAX_RESERVE, DEMO_TOKENS, tokenMoneyFlow, FEATURED_TOKEN } from "@/mock";

describe("mock data consistency", () => {
  it("portfolio totals match the numbers shown elsewhere", () => {
    const t = portfolioTotals(DEMO_PORTFOLIO);
    expect(t.valueCents).toBe(4_281_000n);
    expect(t.realizedCents).toBe(E.realizedGainsCents - E.realizedLossesCents);
    expect(t.assets).toBe(5);
  });
  it("allocations sum to ~100%", () => {
    const sum = portfolioRows(DEMO_PORTFOLIO).reduce((s, r) => s + r.allocationBps, 0);
    expect(sum).toBeGreaterThanOrEqual(9_995);
    expect(sum).toBeLessThanOrEqual(10_000);
  });
  it("demo tax exposure equals what the shared engine computes from the stated assumptions", () => {
    const ev = (st: bigint, lt: bigint): RealizedEvent[] =>
      [["SHORT_TERM", st], ["LONG_TERM", lt]].map(([hp, g], i) => ({
        transaction_id: String(i), lot_id: "x", asset: "SOL", quantity: 1n, acquisition_timestamp: 0,
        acquisition_price_micro: 0n, disposal_timestamp: Date.UTC(2026, 5, 1) / 1000, disposal_price_micro: 0n,
        cost_basis: 0n, proceeds: g as bigint, gain_loss: g as bigint, holding_period: hp as "SHORT_TERM" | "LONG_TERM",
        classification: "CAPITAL_GAIN",
      }));
    expect(estimateTax(ev(E.shortTermNetCents, E.longTermNetCents), E.assumptions).estimatedExposureCents).toBe(E.exposureCents);
    expect(E.shortTermNetCents + E.longTermNetCents).toBe(E.realizedGainsCents - E.realizedLossesCents);
  });
  it("reserve numbers match the spec example (77.1%, $4,220 more)", () => {
    const s = reserveStatus(DEMO_TAX_RESERVE.reserveCents, E.exposureCents);
    expect(s.coverageBps).toBe(7709);
    expect(s.recommendedAdditionalCents).toBe(422_000n);
  });
  it("confirmed donations total $1,840", () => {
    expect(DEMO_DONATIONS.filter((d) => d.status === "confirmed").reduce((s, d) => s + d.amountCents, 0n)).toBe(184_000n);
  });
  it("every token fee split is exactly 10000 bps and money flow sums to lifetime fees", () => {
    for (const t of DEMO_TOKENS) {
      expect(validateFeeSplit(t.feeSplit)).toEqual([]);
      const f = tokenMoneyFlow(t);
      expect(f.creator + f.taxReserve + f.charity + f.protocol).toBe(t.lifetimeFeesCents);
    }
  });
  it("no demo token claims a contract; slugs unique; featured is /token/demo", () => {
    expect(DEMO_TOKENS.every((t) => t.contractAddress === null)).toBe(true);
    expect(new Set(DEMO_TOKENS.map((t) => t.slug)).size).toBe(DEMO_TOKENS.length);
    expect(FEATURED_TOKEN.slug).toBe("demo");
  });
  it("at least one charity is unverified (shows the gate)", () => {
    expect(DEMO_CHARITIES.some((c) => c.verification === "pending")).toBe(true);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("copy lint over the frontend source", () => {
  const files = walk(join(__dirname, "..")).filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith(".test.ts"));
  it("contains no banned phrases and makes no positive safety claims", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8").toLowerCase();
      for (const p of BANNED_PHRASES) expect(text, `${f}: "${p}"`).not.toContain(p);
      // Positive safety claims are banned. Negations ("does not mean a token is safe") are fine.
      expect(text, `${f}: safety claim`).not.toMatch(/(100% safe|completely safe|totally safe|very safe|safe token|safe launch|safe to (buy|invest)|>safe<)/);
    }
  });
});

describe("parity with the shared demo fixtures the API serves", () => {
  it("frontend mock tokens, fee splits, and totals match shared fixtures", async () => {
    const { DEMO_TOKENS: shared, buildTax, buildTaxReserve, DEMO_IDS } = await import("@project-name/shared");
    expect(DEMO_TOKENS.map((t) => [t.slug, t.symbol])).toEqual(shared.map((t) => [t.id, t.symbol]));
    for (const t of DEMO_TOKENS) {
      const s = shared.find((x) => x.id === t.slug)!;
      expect(t.feeSplit).toEqual(s.feeSplit);
      expect(t.marketCapCents).toBe(s.marketCapCents);
      expect(t.liquidityCents).toBe(s.liquidityCents);
      expect(t.holders).toBe(s.holders);
      expect(t.lifetimeFeesCents).toBe(s.lifetimeFeesCents);
    }
    expect(buildTax(DEMO_IDS.wallets.trading).estimatedTaxExposureCents).toBe(E.exposureCents.toString());
    expect(buildTaxReserve(DEMO_IDS.wallets.trading, null, "demo").currentReserveCents).toBe(DEMO_TAX_RESERVE.reserveCents.toString());
  });
});
