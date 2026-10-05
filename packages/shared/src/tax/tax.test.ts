import { describe, expect, it } from "vitest";
import { estimateTax, holdingPeriod, percentOfGains, realize, reserveStatus } from "./engine.js";
import type { AcquisitionLot, Disposal, TaxAssumptions } from "./types.js";

const D = 9; // SOL-like
const SOL = 10n ** 9n;
const t = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

const lot = (id: string, qty: bigint, at: number, cents: bigint, asset = "SOL"): AcquisitionLot => ({
  lotId: id, sourceTxId: `tx-${id}`, asset, decimals: D, quantity: qty, acquiredAt: at, costBasisCents: cents,
});
const disp = (id: string, qty: bigint, at: number, cents: bigint, asset = "SOL"): Disposal => ({
  txId: id, asset, decimals: D, quantity: qty, disposedAt: at, proceedsCents: cents,
});
const assume: TaxAssumptions = {
  jurisdiction: "US", taxYear: 2026, shortTermRateBps: 3000, longTermRateBps: 1500, stateRateBps: 500,
};

describe("holdingPeriod", () => {
  it("exactly one year is short term, one second more is long term", () => {
    expect(holdingPeriod(t(2024, 1, 1), t(2025, 1, 1))).toBe("SHORT_TERM");
    expect(holdingPeriod(t(2024, 1, 1), t(2025, 1, 1) + 1)).toBe("LONG_TERM");
  });
  it("handles leap day acquisition without throwing", () => {
    expect(holdingPeriod(t(2024, 2, 29), t(2025, 3, 2))).toBe("LONG_TERM");
  });
  it("rejects disposal before acquisition", () => {
    expect(() => holdingPeriod(t(2025, 1, 2), t(2025, 1, 1))).toThrow();
  });
});

describe("realize", () => {
  it("simple full disposal gain", () => {
    const { events, remainingLots } = realize(
      [lot("a", SOL, t(2026, 1, 1), 10_000n)],
      [disp("s1", SOL, t(2026, 3, 1), 15_000n)],
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      cost_basis: 10_000n, proceeds: 15_000n, gain_loss: 5_000n,
      classification: "CAPITAL_GAIN", holding_period: "SHORT_TERM",
      transaction_id: "s1", lot_id: "a",
    });
    expect(events[0]?.disposal_price_micro).toBe(150_000_000n); // $150.00
    expect(remainingLots).toEqual([]);
  });

  it("FIFO vs LIFO vs HIFO choose different lots", () => {
    const lots = [
      lot("old", SOL, t(2025, 1, 1), 5_000n),
      lot("mid", SOL, t(2025, 6, 1), 20_000n),
      lot("new", SOL, t(2026, 1, 1), 10_000n),
    ];
    const d = [disp("s", SOL, t(2026, 2, 1), 12_000n)];
    expect(realize(lots, d, "FIFO").events[0]?.lot_id).toBe("old");
    expect(realize(lots, d, "LIFO").events[0]?.lot_id).toBe("new");
    expect(realize(lots, d, "HIFO").events[0]?.lot_id).toBe("mid");
  });

  it("partial lot consumption keeps basis exact (no drift)", () => {
    const lots = [lot("a", 3n, t(2026, 1, 1), 100n)];
    const d = [disp("s1", 1n, t(2026, 2, 1), 50n), disp("s2", 1n, t(2026, 2, 2), 50n), disp("s3", 1n, t(2026, 2, 3), 50n)];
    const { events, remainingLots } = realize(lots, d);
    expect(events.reduce((s, e) => s + e.cost_basis, 0n)).toBe(100n);
    expect(remainingLots).toEqual([]);
  });

  it("one disposal spanning lots splits proceeds exactly", () => {
    const lots = [lot("a", SOL, t(2025, 1, 1), 10_000n), lot("b", SOL, t(2026, 1, 1), 20_000n)];
    const { events } = realize(lots, [disp("s", 2n * SOL, t(2026, 2, 1), 33_333n)]);
    expect(events).toHaveLength(2);
    expect(events.reduce((s, e) => s + e.proceeds, 0n)).toBe(33_333n);
    expect(events.reduce((s, e) => s + e.cost_basis, 0n)).toBe(30_000n);
    expect(events[0]?.holding_period).toBe("LONG_TERM");
    expect(events[1]?.holding_period).toBe("SHORT_TERM");
  });

  it("losses classify correctly", () => {
    const { events } = realize([lot("a", SOL, t(2026, 1, 1), 10_000n)], [disp("s", SOL, t(2026, 2, 1), 4_000n)]);
    expect(events[0]).toMatchObject({ gain_loss: -6_000n, classification: "CAPITAL_LOSS" });
  });

  it("throws rather than inventing basis when oversold", () => {
    expect(() => realize([lot("a", SOL, t(2026, 1, 1), 1n)], [disp("s", 2n * SOL, t(2026, 2, 1), 1n)])).toThrow(/exceeds/);
  });

  it("ignores lots acquired after the disposal", () => {
    expect(() =>
      realize([lot("future", SOL, t(2026, 5, 1), 1n)], [disp("s", SOL, t(2026, 2, 1), 1n)]),
    ).toThrow();
  });

  it("keeps assets separate and does not mutate inputs", () => {
    const lots = [lot("a", SOL, t(2026, 1, 1), 100n, "SOL"), lot("b", SOL, t(2026, 1, 1), 999n, "BONK")];
    const snapshot = JSON.stringify(lots, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const { events, remainingLots } = realize(lots, [disp("s", SOL, t(2026, 2, 1), 200n, "BONK")]);
    expect(events[0]?.asset).toBe("BONK");
    expect(remainingLots.map((l) => l.lotId)).toEqual(["a"]);
    expect(JSON.stringify(lots, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(snapshot);
  });

  it("rejects non-positive quantities", () => {
    expect(() => realize([lot("a", 0n, 1, 1n)], [])).toThrow();
    expect(() => realize([lot("a", SOL, 1, 1n)], [disp("s", 0n, 2, 1n)])).toThrow();
  });
});

describe("estimateTax", () => {
  const mk = (st: bigint, lt: bigint, year = 2026) => {
    const base = {
      lot_id: "x", asset: "SOL", quantity: 1n, acquisition_price_micro: 0n, disposal_price_micro: 0n,
      cost_basis: 0n, proceeds: 0n, classification: "CAPITAL_GAIN" as const, acquisition_timestamp: 0,
    };
    return [
      { ...base, transaction_id: "1", holding_period: "SHORT_TERM" as const, gain_loss: st, disposal_timestamp: t(year, 6, 1) },
      { ...base, transaction_id: "2", holding_period: "LONG_TERM" as const, gain_loss: lt, disposal_timestamp: t(year, 6, 2) },
    ];
  };

  it("applies configured rates plus state", () => {
    // ST 10000 * 35% = 3500, LT 10000 * 20% = 2000
    expect(estimateTax(mk(10_000n, 10_000n), assume).estimatedExposureCents).toBe(5_500n);
  });
  it("never negative; losses give zero exposure", () => {
    expect(estimateTax(mk(-5_000n, -5_000n), assume).estimatedExposureCents).toBe(0n);
  });
  it("cross-offsets ST loss against LT gain", () => {
    // LT 10000 - 4000 = 6000 * 20% = 1200
    expect(estimateTax(mk(-4_000n, 10_000n), assume).estimatedExposureCents).toBe(1_200n);
  });
  it("cross-offsets LT loss against ST gain", () => {
    // ST 10000 - 4000 = 6000 * 35% = 2100
    expect(estimateTax(mk(10_000n, -4_000n), assume).estimatedExposureCents).toBe(2_100n);
  });
  it("loss larger than gain floors at zero", () => {
    expect(estimateTax(mk(-9_000n, 2_000n), assume).estimatedExposureCents).toBe(0n);
  });
  it("filters by tax year", () => {
    expect(estimateTax(mk(10_000n, 10_000n, 2025), assume).taxableEventCount).toBe(0);
  });
  it("is labeled as an estimate and validates assumptions", () => {
    expect(estimateTax([], assume).label).toBe("ESTIMATE_NOT_TAX_ADVICE");
    expect(() => estimateTax([], { ...assume, stateRateBps: -1 })).toThrow();
    expect(() => estimateTax([], { ...assume, longTermRateBps: 10_001 })).toThrow();
  });
  it("different assumptions change the result (no hardcoded rate)", () => {
    const a = estimateTax(mk(10_000n, 0n), { ...assume, shortTermRateBps: 0, stateRateBps: 0 });
    expect(a.estimatedExposureCents).toBe(0n);
  });
});

describe("reserve", () => {
  it("matches spec example numbers", () => {
    const s = reserveStatus(1_400_000n, 1_842_000n);
    expect(s.coverageBps).toBe(7600); // 76.00% (floor)
    expect(s.recommendedAdditionalCents).toBe(442_000n);
  });
  it("zero exposure has null coverage; overfunded recommends nothing", () => {
    expect(reserveStatus(100n, 0n).coverageBps).toBeNull();
    expect(reserveStatus(200n, 100n).recommendedAdditionalCents).toBe(0n);
  });
  it("percentOfGains ignores losses", () => {
    expect(percentOfGains(100_000n, 3000)).toBe(30_000n);
    expect(percentOfGains(-5n, 3000)).toBe(0n);
    expect(() => percentOfGains(1n, 10_001)).toThrow();
  });
});
