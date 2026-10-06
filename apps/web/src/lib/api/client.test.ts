import {
  CharityList, DEMO_IDS, DEMO_TOKENS, DiscoverResponse, DonationsResponse, PortfolioResponse, TaxReserveResponse, TaxResponse, TokenProof,
} from "@project-name/shared";
import { describe, expect, it, vi } from "vitest";
import { DEMO_WALLETS } from "@project-name/shared";
import { ApiClientError, createApiClient } from "./client";
import { describeApiError } from "./errors";
import { resolveApiMode } from "./config";

const W = DEMO_IDS.wallets.trading;

describe("api mode resolution", () => {
  it("defaults to mock; only the exact value 'api' switches", () => {
    expect(resolveApiMode(undefined)).toBe("mock");
    expect(resolveApiMode("")).toBe("mock");
    expect(resolveApiMode("API")).toBe("mock");
    expect(resolveApiMode("api")).toBe("api");
  });
});

describe("mock mode", () => {
  const c = createApiClient({ mode: "mock" });
  it("returns contract-valid, demo-labeled data without touching the network", async () => {
    const f = vi.fn();
    const mc = createApiClient({ mode: "mock", fetchImpl: f as unknown as typeof fetch });
    const all = [
      PortfolioResponse.parse(await mc.getPortfolio(W)), TaxResponse.parse(await mc.getTaxEstimate(W)),
      TaxReserveResponse.parse(await mc.getTaxReserve(W)), DonationsResponse.parse(await mc.getDonations(W)),
      TokenProof.parse(await mc.getTokenProof("demo")), DiscoverResponse.parse(await mc.getDiscover({ sort: "holders" })),
    ];
    expect(all.every((r) => r.dataSource === "demo" && r.verifiedOnChain === false)).toBe(true);
    expect(CharityList.parse({ charities: await mc.getCharities() }).charities).toHaveLength(4);
    expect(f).not.toHaveBeenCalled();
  });
  it("accepts the frontend mock ids (w1) as well as UUIDs", async () => {
    expect((await c.getPortfolio("w1")).walletId).toBe(W);
  });
  it("never invents launches; unknown things are NOT_FOUND", async () => {
    expect((await c.getLaunches()).launches).toEqual([]);
    await expect(c.getLaunch("x")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(c.getTokenProof("nope")).rejects.toBeInstanceOf(ApiClientError);
    await expect(c.getPortfolio("00000000-0000-4000-8000-0000000000ff")).rejects.toMatchObject({ status: 404 });
  });
  it("discover filters work and bad params are rejected", async () => {
    expect((await c.getDiscover({ verifiedTransparency: true })).tokens.map((t) => t.symbol).sort()).toEqual(["HRBR", "ORCH"]);
    expect((await c.getDiscover({ minHolders: 1000 })).tokens).toHaveLength(3);
    await expect(c.getDiscover({ sort: "pump" as never })).rejects.toThrow();
  });
  it("matches the frontend mock data on headline numbers (parity)", async () => {
    expect((await c.getTokenProof("demo")).moneyFlowCents.creator).toBe("4932000");
    expect((await c.getTaxEstimate(W)).estimatedTaxExposureCents).toBe("1842000");
    expect(DEMO_TOKENS).toHaveLength(6);
  });
});

describe("api mode", () => {
  const body = (b: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } }));

  it("calls /api paths with query params and bearer auth, and validates the response", async () => {
    const mc = createApiClient({ mode: "mock" });
    const f = vi.fn(async (..._a: Parameters<typeof fetch>) => body(await mc.getDiscover({ sort: "holders" })));
    const c = createApiClient({ mode: "api", baseUrl: "http://api.test/", fetchImpl: f as unknown as typeof fetch, getToken: () => "TOKEN43" });
    await c.getDiscover({ sort: "holders", minHolders: 100, verifiedTransparency: false });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/discover?sort=holders&minHolders=100&verifiedTransparency=false");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer TOKEN43" });
  });
  it("sends no Authorization header without a session, and escapes ids", async () => {
    const f = vi.fn(async (..._a: Parameters<typeof fetch>) => body({ error: { code: "UNAUTHENTICATED", message: "A valid session is required" } }, 401));
    const c = createApiClient({ mode: "api", baseUrl: "http://api.test", fetchImpl: f as unknown as typeof fetch, getToken: () => null });
    await expect(c.getPortfolio("a/b")).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/portfolio/a%2Fb");
    expect((init as RequestInit).headers).not.toHaveProperty("authorization");
  });
  it("maps structured validation errors, network failures, and non-JSON failures", async () => {
    const v = createApiClient({ mode: "api", baseUrl: "http://x", getToken: () => null, fetchImpl: (async () => body({ error: { code: "VALIDATION_ERROR", message: "bad", fields: { sort: ["no"] } } }, 400)) as unknown as typeof fetch });
    await expect(v.getDiscover()).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: { sort: ["no"] } });
    const n = createApiClient({ mode: "api", baseUrl: "http://x", getToken: () => null, fetchImpl: (async () => { throw new TypeError("fail"); }) as unknown as typeof fetch });
    await expect(n.getCharities()).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
    const h = createApiClient({ mode: "api", baseUrl: "http://x", getToken: () => null, fetchImpl: (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch });
    await expect(h.getCharities()).rejects.toMatchObject({ code: "HTTP_ERROR", status: 502 });
  });
  it("rejects a response that violates the contract instead of passing it to the UI", async () => {
    const c = createApiClient({ mode: "api", baseUrl: "http://x", getToken: () => null, fetchImpl: (async () => body({ walletId: "nope" })) as unknown as typeof fetch });
    await expect(c.getTaxEstimate(W)).rejects.toThrow();
  });
});


describe("mock mode: stored-data stand-ins behave like the API", () => {
  const W = DEMO_IDS.wallets.trading;
  it("wallets and transactions", async () => {
    const c = createApiClient({ mode: "mock" });
    expect((await c.getWallets()).wallets).toHaveLength(3);
    const t = await c.getTransactions(W, { limit: 2 });
    expect(t.transactions).toHaveLength(2);
    expect(t.dataSource).toBe("demo");
    expect((await c.getTokens()).tokens).toHaveLength(6);
  });
  it("saving a reserve target validates like the API (400 with fields) and then persists in memory", async () => {
    const c = createApiClient({ mode: "mock" });
    await expect(c.setTaxReserveTarget(W, { targetType: "percentage", targetPercentage: "101" })).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    const r = await c.setTaxReserveTarget(W, { targetType: "amount", targetAmount: "10000.00" });
    expect(r.target?.targetAmount).toBe("10000.00");
    expect((await c.getTaxReserve(W)).target?.targetAmount).toBe("10000.00");
    expect(r.custody).toBe("none");
  });
  it("launch configurations: invalid fee split rejected, valid saved and reviewed, never deployable", async () => {
    const c = createApiClient({ mode: "mock" });
    const creator = DEMO_WALLETS[1]!.address;
    const cfg = {
      name: "Example", symbol: "EXMPL", description: "", totalSupply: "1000000000", decimals: 6, creatorAllocationPercent: "8", creatorWallet: creator,
      liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 30 },
      feeSplit: { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 },
      charityConfiguration: { charityId: DEMO_IDS.charities.c1 },
      taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: creator },
    };
    await expect(c.createLaunch({ ...cfg, feeSplit: { ...cfg.feeSplit, creator: 6001 } })).rejects.toMatchObject({ status: 400 });
    expect((await c.getLaunches()).launches).toHaveLength(0);
    const l = await c.createLaunch(cfg);
    expect(l).toMatchObject({ status: "draft", deployment: { status: "not_deployed", contractAddress: null }, dataSource: "demo" });
    const r = await c.reviewLaunch(l.id);
    expect(r.status).toBe("review_passed");
    expect(r.review).toMatchObject({ deployable: false, feeSplitLabel: "Configured fee split", feeSplitEnforcement: "not_enforced" });
    expect((await c.getLaunch(l.id)).id).toBe(l.id);
    expect((await c.getLaunches()).launches).toHaveLength(1);
    await expect(c.getLaunch("00000000-0000-4000-8000-0000000000aa")).rejects.toMatchObject({ status: 404 });
    // unverified charity fails review, as on the server
    const bad = await c.createLaunch({ ...cfg, charityConfiguration: { charityId: DEMO_IDS.charities.c4 } });
    expect((await c.reviewLaunch(bad.id)).status).toBe("review_failed");
  });
});

describe("api mode: new endpoints and status handling", () => {
  const res = (b: unknown, status: number) => Promise.resolve(new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } }));
  const mock = createApiClient({ mode: "mock" });

  it("POST target: method, body, credentials, and 200 response", async () => {
    const body = await mock.setTaxReserveTarget(DEMO_IDS.wallets.trading, { targetType: "percentage", targetPercentage: "25" });
    const f = vi.fn(async (..._a: Parameters<typeof fetch>) => res(body, 200));
    const c = createApiClient({ mode: "api", baseUrl: "http://api.test", fetchImpl: f as unknown as typeof fetch, getToken: () => null });
    await c.setTaxReserveTarget("W", { targetType: "percentage", targetPercentage: "25" });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/tax-reserve/W/target");
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ targetType: "percentage", targetPercentage: "25" }) });
  });
  it("POST /api/launches handles 201 Created", async () => {
    const created = await mock.createLaunch({
      name: "A", symbol: "AA", totalSupply: "1", decimals: 0, creatorAllocationPercent: "1", creatorWallet: DEMO_WALLETS[0]!.address,
      liquidityConfiguration: { initialLiquidityUsdc: "1", supplyPercentage: "1", lockDays: 0 },
      feeSplit: { creator: 10000, taxReserve: 0, charity: 0, protocol: 0 }, charityConfiguration: { charityId: DEMO_IDS.charities.c1 },
      taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: DEMO_WALLETS[0]!.address },
    });
    const c = createApiClient({ mode: "api", baseUrl: "http://api.test", getToken: () => null, fetchImpl: (async () => res(created, 201)) as unknown as typeof fetch });
    expect((await c.createLaunch({})).id).toBe(created.id);
  });
  it.each([
    [400, "VALIDATION_ERROR"], [401, "UNAUTHENTICATED"], [403, "ORIGIN_NOT_ALLOWED"], [404, "NOT_FOUND"], [404, "NO_LIVE_DATA"],
    [409, "LIMIT_REACHED"], [429, "RATE_LIMITED"], [500, "INTERNAL_ERROR"],
  ])("maps %s %s to ApiClientError and a safe view", async (status, code) => {
    const c = createApiClient({ mode: "api", baseUrl: "http://x", getToken: () => null, fetchImpl: (async () => res({ error: { code, message: "m", ...(status === 400 ? { fields: { a: ["bad"] } } : {}) } }, status)) as unknown as typeof fetch });
    const err = await c.getPortfolio("w").then(() => null, (x: unknown) => x);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status, code });
    expect(describeApiError(err).title).toBeTruthy();
  });
  it("wallets/transactions/tokens GET paths", async () => {
    const f = vi.fn(async (..._a: Parameters<typeof fetch>) => res({ wallets: [] }, 200));
    const c = createApiClient({ mode: "api", baseUrl: "http://api.test", fetchImpl: f as unknown as typeof fetch, getToken: () => null });
    await c.getWallets();
    expect(String(f.mock.calls[0]![0])).toBe("http://api.test/api/wallets");
    await c.getTransactions("w1", { limit: 5, offset: 10 }).catch(() => undefined);
    expect(String(f.mock.calls[1]![0])).toBe("http://api.test/api/transactions/w1?limit=5&offset=10");
  });
});
