import { describe, expect, it } from "vitest";
import { EMPTY_TAX_DRAFT, draftToQuery } from "./taxQuery";

describe("tax form -> query", () => {
  it("empty draft sends nothing (server defaults are echoed back, never silent)", () => {
    expect(draftToQuery(EMPTY_TAX_DRAFT)).toEqual({ ok: true, query: {} });
  });
  it("method, year and all three rates convert exactly (no floats)", () => {
    const r = draftToQuery({ year: "2024", method: "HIFO", swap: "NOT_ASSESSED", shortRate: "32", longRate: "15", stateRate: "4.5" });
    expect(r).toEqual({ ok: true, query: { taxYear: 2024, method: "HIFO", swapTreatment: "NOT_ASSESSED", shortTermRateBps: 3200, longTermRateBps: 1500, stateRateBps: 450 } });
  });
  it("rates are all-or-none and bounded; junk is rejected", () => {
    expect(draftToQuery({ ...EMPTY_TAX_DRAFT, shortRate: "30" }).ok).toBe(false);
    expect(draftToQuery({ ...EMPTY_TAX_DRAFT, shortRate: "101", longRate: "1", stateRate: "1" }).ok).toBe(false);
    expect(draftToQuery({ ...EMPTY_TAX_DRAFT, shortRate: "abc", longRate: "1", stateRate: "1" }).ok).toBe(false);
    expect(draftToQuery({ ...EMPTY_TAX_DRAFT, shortRate: "1.234", longRate: "1", stateRate: "1" }).ok).toBe(false);
    expect(draftToQuery({ ...EMPTY_TAX_DRAFT, year: "24" }).ok).toBe(false);
  });
});
