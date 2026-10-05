import {
  CharityList, DEMO_IDS, DEMO_TOKENS, DiscoverResponse, DonationsResponse, PortfolioResponse, TaxReserveResponse, TaxResponse, TokenProof,
} from "@project-name/shared";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError, createApiClient } from "./client";
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
