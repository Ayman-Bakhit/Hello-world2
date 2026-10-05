import { describe, expect, it } from "vitest";
import {
  bpsToPercentString,
  percentToBps,
  splitAmount,
  validateFeeSplit,
  type FeeSplitBps,
} from "./index";

const good: FeeSplitBps = { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 };

describe("validateFeeSplit", () => {
  it("accepts exactly 10000 bps", () => expect(validateFeeSplit(good)).toEqual([]));
  it("rejects 10001 and 9999", () => {
    expect(validateFeeSplit({ ...good, creator: 6001 })).toEqual([{ code: "SUM_MISMATCH", sum: 10001 }]);
    expect(validateFeeSplit({ ...good, creator: 5999 })).toEqual([{ code: "SUM_MISMATCH", sum: 9999 }]);
  });
  it("rejects negatives and non-integers", () => {
    expect(validateFeeSplit({ ...good, creator: -1 })[0]?.code).toBe("NEGATIVE");
    expect(validateFeeSplit({ ...good, creator: 60.5 })[0]?.code).toBe("NOT_INTEGER");
    expect(validateFeeSplit({ ...good, charity: NaN })[0]?.code).toBe("NOT_INTEGER");
  });
  it("accepts 100% to one bucket", () => {
    expect(validateFeeSplit({ creator: 10000, taxReserve: 0, charity: 0, protocol: 0 })).toEqual([]);
  });
});

describe("percent conversion", () => {
  it("round trips", () => {
    expect(percentToBps("60")).toBe(6000);
    expect(percentToBps("12.5")).toBe(1250);
    expect(percentToBps("0.01")).toBe(1);
    expect(bpsToPercentString(1250)).toBe("12.50");
    expect(bpsToPercentString(6000)).toBe("60");
  });
  it("rejects bad input", () => {
    for (const s of ["", "abc", "1.234", "-5", "1e2", "1000"]) expect(() => percentToBps(s)).toThrow();
  });
});

describe("splitAmount", () => {
  it("always sums to input, dust to protocol", () => {
    for (const amt of [0n, 1n, 7n, 99n, 10001n, 123456789012345678n]) {
      const p = splitAmount(amt, good);
      expect(p.creator + p.taxReserve + p.charity + p.protocol).toBe(amt);
    }
  });
  it("exact on round amounts", () => {
    expect(splitAmount(10_000n, good)).toEqual({
      creator: 6000n, taxReserve: 1500n, charity: 1500n, protocol: 1000n,
    });
  });
  it("throws on invalid split or negative amount", () => {
    expect(() => splitAmount(1n, { ...good, creator: 1 })).toThrow();
    expect(() => splitAmount(-1n, good)).toThrow();
  });
});
