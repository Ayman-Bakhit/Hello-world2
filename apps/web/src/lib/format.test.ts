import { describe, expect, it } from "vitest";
import { formatAmount, formatCompactUsd, formatPercentBps, formatPrice, formatUsd, parseUsdToCents, shortAddress } from "./format";

describe("formatUsd", () => {
  it("rounds half up to dollars by default and shows cents on request", () => {
    expect(formatUsd(4_281_000n)).toBe("$42,810");
    expect(formatUsd(4_281_050n)).toBe("$42,811");
    expect(formatUsd(4_281_049n)).toBe("$42,810");
    expect(formatUsd(123_456n, { cents: true })).toBe("$1,234.56");
    expect(formatUsd(5n, { cents: true })).toBe("$0.05");
  });
  it("handles signs and zero", () => {
    expect(formatUsd(-150_000n)).toBe("-$1,500");
    expect(formatUsd(150_000n, { signed: true })).toBe("+$1,500");
    expect(formatUsd(0n, { signed: true })).toBe("$0");
    expect(formatUsd(-10n)).toBe("$0");
  });
});

describe("formatPercentBps", () => {
  it("matches the spec examples", () => {
    expect(formatPercentBps(7709)).toBe("77.1%");
    expect(formatPercentBps(6000, { digits: 0 })).toBe("60%");
    expect(formatPercentBps(1250, { digits: 2 })).toBe("12.50%");
    expect(formatPercentBps(10_000, { digits: 2 })).toBe("100.00%");
  });
  it("signs", () => {
    expect(formatPercentBps(210, { signed: true })).toBe("+2.1%");
    expect(formatPercentBps(-85, { signed: true })).toBe("-0.9%");
    expect(formatPercentBps(0, { signed: true })).toBe("0.0%");
  });
});

describe("formatPrice / formatAmount", () => {
  it("formats prices", () => {
    expect(formatPrice(142_500_000n)).toBe("$142.50");
    expect(formatPrice(16n)).toBe("$0.000016");
    expect(formatPrice(2_150n)).toBe("$0.00215");
    expect(formatPrice(850_000n)).toBe("$0.8500");
  });
  it("formats negative (signed) amounts and never shows a non-zero amount as 0", () => {
    expect(formatAmount(-1_500_000n, 9)).toBe("-0.0015");
    expect(formatAmount(-2n * 10n ** 9n, 9)).toBe("-2");
    expect(formatAmount(-123_456_789n, 6)).toBe("-123.4567");
    expect(formatAmount(1n, 9)).toBe("<0.0001");
    expect(formatAmount(-1n, 9)).toBe("-<0.0001");
    expect(formatAmount(0n, 9)).toBe("0");
  });
  it("formats token amounts from base units", () => {
    expect(formatAmount(130n * 10n ** 9n, 9)).toBe("130");
    expect(formatAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatAmount(1_234_567_890n, 6, 2)).toBe("1,234.56");
  });
});

describe("misc", () => {
  it("compact usd", () => {
    expect(formatCompactUsd(215_000_000n)).toBe("$2.15M");
    expect(formatCompactUsd(8_420_000n)).toBe("$84.2K");
    expect(formatCompactUsd(61_000n)).toBe("$610");
  });
  it("parseUsdToCents", () => {
    expect(parseUsdToCents("4,220")).toBe(422_000n);
    expect(parseUsdToCents("0.5")).toBe(50n);
    for (const bad of ["", "abc", "-5", "0", "1.234", "1e3"]) expect(parseUsdToCents(bad)).toBeNull();
  });
  it("shortAddress", () => expect(shortAddress("DEMO7xK2mQ9vT3pL8aZ4WNr91P")).toBe("DEMO…91P".replace("91P", "r91P")));
});
