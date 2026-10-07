import { describe, expect, it } from "vitest";
import { allErrors, stepErrors, type StepContext } from "./launch";
import { DEFAULT_LAUNCH_CONFIG } from "@/mock";

const ctx: StepContext = { walletConnected: true, verifiedCharityIds: ["c1"], walletIds: ["w1"] };
const ok = { ...DEFAULT_LAUNCH_CONFIG, name: "Example", symbol: "EXMPL" };

describe("launch validation", () => {
  it("default config plus name and symbol is fully valid", () => {
    expect(allErrors(ok, ctx)).toEqual([]);
  });
  it("requires a connected wallet", () => {
    expect(stepErrors("connect", ok, { ...ctx, walletConnected: false })).toHaveLength(1);
    expect(stepErrors("supply", ok, { ...ctx, walletIds: [] }).join()).toContain("Connect a wallet");
  });
  it("validates token info", () => {
    expect(stepErrors("info", { ...ok, symbol: "bad sym" }, ctx)).toHaveLength(1);
    expect(stepErrors("info", { ...ok, name: "" }, ctx)).toHaveLength(1);
  });
  it("validates supply, decimals, allocation", () => {
    expect(stepErrors("supply", { ...ok, totalSupply: "0" }, ctx)).toHaveLength(1);
    expect(stepErrors("supply", { ...ok, decimals: "10" }, ctx)).toHaveLength(1);
    expect(stepErrors("supply", { ...ok, creatorAllocationPercent: "101" }, ctx)).toHaveLength(1);
  });
  it("the fee split step has nothing to edit: it is fixed at 60/15/15/10", () => {
    expect(stepErrors("fees", ok, ctx)).toEqual([]);
  });
  it("only verified charities are selectable", () => {
    expect(stepErrors("charity", { ...ok, charityId: "c4" }, ctx)).toHaveLength(1);
  });
});
