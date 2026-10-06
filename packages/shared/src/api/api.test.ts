import { describe, expect, it } from "vitest";
import {
  BANNED_PHRASES, DEMO_IDS, DEMO_TOKENS, DiscoverQuery, FeeSplitSchema, LaunchConfigSchema, SetTaxReserveTargetRequest,
  buildDiscover, buildPortfolio, buildTax, buildTaxReserve, buildTokenProof, buildTransactions, centsToUsdString,
  discoverTokens, parseUsdToCents, reviewLaunchConfig, validateFeeSplit, type LaunchConfig,
} from "../index";

const W = DEMO_IDS.wallets;
const ok = { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 };

describe("money helpers", () => {
  it("round trips", () => {
    expect(parseUsdToCents("10,000.50")).toBe(1_000_050n);
    expect(centsToUsdString(1_000_050n)).toBe("10000.50");
    expect(parseUsdToCents("0")).toBeNull();
  });
});

describe("FeeSplitSchema uses the shared validator", () => {
  it("accepts exactly 10000", () => expect(FeeSplitSchema.safeParse(ok).success).toBe(true));
  it("rejects 10001 and 9999 with the total in the message", () => {
    for (const creator of [6001, 5999]) {
      const r = FeeSplitSchema.safeParse({ ...ok, creator });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain("exactly 10000");
    }
  });
  it("rejects floats, negatives, extra keys", () => {
    expect(FeeSplitSchema.safeParse({ ...ok, creator: 6000.5 }).success).toBe(false);
    expect(FeeSplitSchema.safeParse({ ...ok, creator: -1, protocol: 2001 }).success).toBe(false);
    expect(FeeSplitSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
  it("agrees with validateFeeSplit on random splits", () => {
    for (let i = 0; i < 200; i++) {
      const s = { creator: (i * 37) % 10_001, taxReserve: (i * 91) % 5_000, charity: (i * 13) % 3_000, protocol: (i * 7) % 2_000 };
      expect(FeeSplitSchema.safeParse(s).success).toBe(validateFeeSplit(s).length === 0);
    }
  });
});

describe("tax reserve target request", () => {
  it("accepts percentage and amount, rejects mixed/invalid", () => {
    expect(SetTaxReserveTargetRequest.safeParse({ targetType: "percentage", targetPercentage: "30" }).success).toBe(true);
    expect(SetTaxReserveTargetRequest.safeParse({ targetType: "amount", targetAmount: "10000.00" }).success).toBe(true);
    for (const bad of [
      { targetType: "percentage", targetPercentage: "0" }, { targetType: "percentage", targetPercentage: "100.01" },
      { targetType: "percentage", targetPercentage: "abc" }, { targetType: "amount", targetAmount: "-5" },
      { targetType: "amount", targetAmount: "1.234" }, { targetType: "amount", targetAmount: "0" },
      { targetType: "percentage", targetPercentage: "30", targetAmount: "5" }, { targetType: "amount", targetAmount: "5", currency: "ETH" },
    ]) expect(SetTaxReserveTargetRequest.safeParse(bad).success).toBe(false);
  });
});

describe("demo builders", () => {
  it("portfolio totals across the three wallets match the frontend demo ($42,810)", () => {
    const total = [W.trading, W.creator, W.cold].map((w) => BigInt(buildPortfolio(w)!.totalValueCents)).reduce((a, b) => a + b, 0n);
    expect(total).toBe(4_281_000n);
    const realized = [W.trading, W.creator, W.cold].map((w) => BigInt(buildPortfolio(w)!.realizedPnlCents)).reduce((a, b) => a + b, 0n);
    expect(realized).toBe(5_810_000n);
  });
  it("every response is labeled demo and not on-chain verified", () => {
    for (const r of [buildPortfolio(W.trading)!, buildTransactions(W.trading, 5, 0)!, buildTax(W.trading), buildTaxReserve(W.trading, null, "demo"), buildTokenProof("demo")!, buildDiscover(DiscoverQuery.parse({}))]) {
      expect(r.dataSource).toBe("demo");
      expect(r.verifiedOnChain).toBe(false);
    }
  });
  it("tax matches the spec example and never says tax bill", () => {
    const t = buildTax(W.trading);
    expect(t.estimatedTaxExposureCents).toBe("1842000");
    expect(t.estimatedTaxableEvents).toBe(37);
    expect(t.estimatedRealizedGainsCents).toBe("6550000");
    expect(t.estimatedRealizedLossesCents).toBe("740000");
    const text = JSON.stringify(t).toLowerCase();
    expect(text).not.toContain("taxbill");
    for (const p of BANNED_PHRASES.filter((p) => p !== "your tax bill")) expect(text).not.toContain(p);
  });
  it("reserve coverage 77.09%, $4,220 more; percentage target resolves from net gains", () => {
    const r = buildTaxReserve(W.trading, { targetType: "percentage", percentBps: 3000, targetCents: null, updatedAt: "x" }, "database");
    expect(r.coverageBps).toBe(7709);
    expect(r.recommendedAdditionalReserveCents).toBe("422000");
    expect(r.resolvedTargetCents).toBe("1743000"); // 30% of $58,100
    expect(r.target?.targetPercentage).toBe("30");
    expect(r.custody).toBe("none");
  });
  it("transactions paginate and never carry explorer links", () => {
    const a = buildTransactions(W.trading, 3, 0)!;
    expect(a.transactions).toHaveLength(3);
    expect(a.pagination).toMatchObject({ total: 6, nextOffset: 3 });
    const b = buildTransactions(W.trading, 3, 3)!;
    expect(b.pagination.nextOffset).toBeNull();
    expect([...a.transactions, ...b.transactions].every((t) => t.source === "demo" && t.explorerUrl === null)).toBe(true);
    expect(buildTransactions("00000000-0000-4000-8000-0000000000ff", 3, 0)).toBeNull();
  });
  it("proof never claims a contract or enforcement", () => {
    const p = buildTokenProof("demo")!;
    expect(p.contractAddress).toBeNull();
    expect(p.feeSplit).toMatchObject({ label: "Configured fee split", enforcement: "not_enforced", mutability: "UNDETERMINED" });
    expect(p.evidence).toEqual([]);
    expect(buildTokenProof("nope")).toBeNull();
  });
});

describe("discover", () => {
  const q = (o: object) => DiscoverQuery.parse(o);
  it("sorts deterministically by each key", () => {
    expect(discoverTokens(DEMO_TOKENS, q({ sort: "volume" })).items[0]?.symbol).toBe("ORCH");
    expect(discoverTokens(DEMO_TOKENS, q({ sort: "lowestCreatorConcentration" })).items[0]?.symbol).toBe("ORCH");
    expect(discoverTokens(DEMO_TOKENS, q({ sort: "newest" })).items[0]?.symbol).toBe("LNTN");
    expect(discoverTokens(DEMO_TOKENS, q({ sort: "trending" })).items[0]?.symbol).toBe("FNDM");
  });
  it("applies numeric filters in whole dollars", () => {
    expect(discoverTokens(DEMO_TOKENS, q({ minMarketCap: "1000000" })).items.map((t) => t.symbol).sort()).toEqual(["HRBR", "ORCH", "TIDE"]);
    expect(discoverTokens(DEMO_TOKENS, q({ maxMarketCap: "100000" })).total).toBe(0);
    expect(discoverTokens(DEMO_TOKENS, q({ minLiquidity: "100000" })).items.map((t) => t.symbol).sort()).toEqual(["ORCH", "TIDE"]);
    expect(discoverTokens(DEMO_TOKENS, q({ minHolders: 2000 })).total).toBe(2);
    expect(discoverTokens(DEMO_TOKENS, q({ minVolume: "20000" })).items.map((t) => t.symbol).sort()).toEqual(["HRBR", "ORCH"]);
  });
  it("verifiedTransparency filters on all 9 reported checks", () => {
    expect(discoverTokens(DEMO_TOKENS, q({ verifiedTransparency: "true" })).items.map((t) => t.symbol).sort()).toEqual(["HRBR", "ORCH"]);
    expect(discoverTokens(DEMO_TOKENS, q({ verifiedTransparency: "false" })).total).toBe(4);
  });
  it("launchedWithinDays keeps only recent launches (fixed demo reference time)", () => {
    expect(discoverTokens(DEMO_TOKENS, q({ launchedWithinDays: 14, sort: "newest" })).items.map((t) => t.symbol)).toEqual(["LNTN", "FNDM"]);
    expect(discoverTokens(DEMO_TOKENS, q({ launchedWithinDays: 30 })).items.map((t) => t.symbol).sort()).toEqual(["FNDM", "LNTN", "MRDN"]);
    expect(DiscoverQuery.safeParse({ launchedWithinDays: 0 }).success).toBe(false);
    expect(DiscoverQuery.safeParse({ launchedWithinDays: "x" }).success).toBe(false);
  });
  it("paginates", () => {
    const r = discoverTokens(DEMO_TOKENS, q({ limit: 2, offset: 2 }));
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(6);
  });
  it("rejects bad queries", () => {
    for (const bad of [{ sort: "pump" }, { minMarketCap: "-1" }, { minMarketCap: "1.5" }, { minMarketCap: "10", maxMarketCap: "5" }, { limit: 0 }, { limit: 1000 }, { unknown: 1 }, { verifiedTransparency: "yes" }]) {
      expect(DiscoverQuery.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("launch config + review", () => {
  const cfg: LaunchConfig = LaunchConfigSchema.parse({
    name: "Example", symbol: "EXMPL", totalSupply: "1000000000", decimals: 6, creatorAllocationPercent: "8",
    creatorWallet: "DEMO3fB8cJ5yR1uH6dV2KEq47M", liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 30 },
    feeSplit: ok, charityConfiguration: { charityId: DEMO_IDS.charities.c1 },
    taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: "DEMO3fB8cJ5yR1uH6dV2KEq47M" },
  });
  const ctx = { ownedWalletAddresses: ["DEMO3fB8cJ5yR1uH6dV2KEq47M"], charity: { verified: true, hasVerifiedWallet: true }, now: new Date("2026-10-05T00:00:00Z") };

  it("defaults are transparency-favoring", () => {
    expect(cfg).toMatchObject({ mintAuthority: "disabled", freezeAuthority: "disabled", description: "" });
  });
  it("passes a good config but is never deployable and never says immutable", () => {
    const r = reviewLaunchConfig(cfg, ctx);
    expect(r.passed).toBe(true);
    expect(r.deployable).toBe(false);
    expect(r.feeSplitEnforcement).toBe("not_enforced");
    expect(r.moneyFlowExampleCents).toEqual({ creator: "60000", taxReserve: "15000", charity: "15000", protocol: "10000" });
    expect(JSON.stringify(r).toLowerCase()).not.toContain("immutable");
  });
  it("fails on foreign wallets, unverified charity, oversubscribed supply", () => {
    const r = reviewLaunchConfig(
      { ...cfg, creatorWallet: "SOMEONEELSE111111111111111", creatorAllocationPercent: "70" },
      { ...ctx, charity: { verified: false, hasVerifiedWallet: false } },
    );
    expect(r.passed).toBe(false);
    expect(r.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["creatorWallet", "charityConfiguration.charityId", "supply"]));
  });
  it("re-checks the fee split even if validation upstream was skipped", () => {
    const r = reviewLaunchConfig({ ...cfg, feeSplit: { ...ok, creator: 6001 } }, ctx);
    expect(r.passed).toBe(false);
    expect(r.moneyFlowExampleCents.creator).toBe("0");
  });
  it("schema rejects invalid configs", () => {
    const base = JSON.parse(JSON.stringify(cfg));
    for (const patch of [{ symbol: "bad sym" }, { decimals: 12 }, { totalSupply: "0" }, { totalSupply: "1.5" }, { feeSplit: { ...ok, creator: 6001 } }, { rogue: true }]) {
      expect(LaunchConfigSchema.safeParse({ ...base, ...patch }).success, JSON.stringify(patch)).toBe(false);
    }
  });
});
