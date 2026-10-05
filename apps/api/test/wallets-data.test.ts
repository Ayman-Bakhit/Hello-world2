import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApiErrorBody, DEMO_IDS, PortfolioResponse, TaxReserveResponse, TaxResponse, TransactionsResponse, Wallet,
  buildPortfolio, buildTax,
} from "@project-name/shared";
import { makeCtx, makeOtherUser, bearer, W, type Ctx } from "./helpers";

let ctx: Ctx;
let other: Awaited<ReturnType<typeof makeOtherUser>>;
beforeAll(async () => { ctx = await makeCtx(); other = await makeOtherUser(ctx.pool); });
afterAll(async () => { await ctx.close(); });
const get = (url: string, token = ctx.demoToken) => ctx.app.inject({ url, headers: bearer(token) });
const post = (url: string, payload: unknown, token = ctx.demoToken) => ctx.app.inject({ method: "POST", url, payload: payload as object, headers: bearer(token) });

describe("wallets", () => {
  it("lists the actor's wallets: public fields only, labeled demo, ownership unverified", async () => {
    const r = await get("/api/wallets");
    expect(r.statusCode).toBe(200);
    const { wallets } = r.json();
    expect(wallets).toHaveLength(3);
    for (const w of wallets) {
      Wallet.parse(w);
      expect(w.dataSource).toBe("demo");
      expect(w.ownershipVerified).toBe(false);
      expect(Object.keys(w).sort()).toEqual(["address", "chain", "createdAt", "dataSource", "id", "label", "ownershipVerified"]);
    }
  });
  it("no response anywhere carries key/seed/secret fields", async () => {
    const urls = ["/api/wallets", `/api/wallets/${W.trading}`, `/api/portfolio/${W.trading}`, `/api/tax/${W.trading}`, `/api/tax-reserve/${W.trading}`, `/api/donations/${W.trading}`];
    for (const u of urls) expect((await get(u)).body).not.toMatch(/private|secret|seed|mnemonic/i);
  });
  it("gets one wallet; rejects bad ids; hides other users' wallets", async () => {
    expect((await get(`/api/wallets/${W.creator}`)).json().label).toBe("Creator");
    expect((await get("/api/wallets/not-a-uuid")).statusCode).toBe(400);
    expect((await get(`/api/wallets/${W.trading.replace(/1$/, "9")}`)).statusCode).toBe(404);
    expect((await get(`/api/wallets/${other.walletId}`)).statusCode).toBe(404);
  });
  it("another user sees only their own wallet", async () => {
    const r = await get("/api/wallets", other.token);
    expect(r.json().wallets.map((w: { id: string }) => w.id)).toEqual([other.walletId]);
  });
});

describe("portfolio", () => {
  it("returns totals, assets, allocations and provenance (demo, not on-chain)", async () => {
    const r = await get(`/api/portfolio/${W.trading}`);
    expect(r.statusCode).toBe(200);
    const p = PortfolioResponse.parse(r.json());
    expect(p).toEqual(buildPortfolio(W.trading));
    expect(p.dataSource).toBe("demo");
    expect(p.verifiedOnChain).toBe(false);
    expect(p.assets.map((a) => a.symbol)).toEqual(["SOL", "USDC", "BONK", "JUP"]);
    expect(p.assets.reduce((s, a) => s + a.allocationBps, 0)).toBeLessThanOrEqual(10_000);
    expect(BigInt(p.totalValueCents) - BigInt(p.costBasisCents)).toBe(BigInt(p.unrealizedPnlCents));
  });
  it("fictional token is flagged", async () => {
    const p = PortfolioResponse.parse((await get(`/api/portfolio/${W.creator}`)).json());
    expect(p.assets[0]).toMatchObject({ symbol: "HRBR", isFictionalToken: true });
  });
  it("rejects invalid and foreign wallet ids", async () => {
    expect((await get("/api/portfolio/xyz")).statusCode).toBe(400);
    const foreign = await get(`/api/portfolio/${other.walletId}`);
    expect(foreign.statusCode).toBe(404);
    expect((await get(`/api/portfolio/${W.trading}`, other.token)).statusCode).toBe(404);
  });
  it("a non-demo wallet has no fabricated data", async () => {
    // Own wallet, but it is a 'database' wallet with no indexed data: 404, never invented balances.
    expect((await get(`/api/portfolio/${other.walletId}`, other.token)).statusCode).toBe(404);
  });
});

describe("transactions", () => {
  it("paginates and labels every record as demo", async () => {
    const a = TransactionsResponse.parse((await get(`/api/transactions/${W.trading}?limit=2`)).json());
    expect(a.transactions).toHaveLength(2);
    expect(a.pagination).toEqual({ limit: 2, offset: 0, total: 6, nextOffset: 2 });
    const b = TransactionsResponse.parse((await get(`/api/transactions/${W.trading}?limit=2&offset=4`)).json());
    expect(b.pagination.nextOffset).toBeNull();
    expect([...a.transactions, ...b.transactions].every((t) => t.source === "demo" && t.explorerUrl === null && t.signature.startsWith("DEMO-"))).toBe(true);
    expect(a.dataSource).toBe("demo");
    expect(a.verifiedOnChain).toBe(false);
  });
  it("rejects bad pagination", async () => {
    for (const q of ["limit=0", "limit=101", "offset=-1", "limit=abc", "page=2"]) {
      expect((await get(`/api/transactions/${W.trading}?${q}`)).statusCode, q).toBe(400);
    }
  });
  it("is owner-scoped", async () => {
    expect((await get(`/api/transactions/${W.trading}`, other.token)).statusCode).toBe(404);
  });
});

describe("tax", () => {
  it("returns an estimate with methodology, disclaimer and provenance; no tax bill field", async () => {
    const r = await get(`/api/tax/${W.trading}`);
    const t = TaxResponse.parse(r.json());
    expect(t).toEqual(buildTax(W.trading));
    expect(t.estimatedTaxExposureCents).toBe("1842000");
    expect(t.scope).toBe("user");
    expect(t.methodology.version).toBeTruthy();
    expect(t.disclaimer.join(" ")).toMatch(/not a tax bill/i);
    expect(t.disclaimer.join(" ")).toMatch(/qualified tax professional/i);
    expect(r.body.toLowerCase()).not.toMatch(/taxbill|tax_bill|tax liability|guaranteed|loophole/);
    expect(t.dataSource).toBe("demo");
  });
  it("is owner-scoped", async () => {
    expect((await get(`/api/tax/${W.trading}`, other.token)).statusCode).toBe(404);
    expect((await get("/api/tax/zzz")).statusCode).toBe(400);
  });
});

describe("tax reserve", () => {
  const countTables = async () =>
    (await ctx.pool.query("SELECT (SELECT count(*) FROM raw_transactions) AS raw, (SELECT count(*) FROM tax_reserve_transactions) AS trt, (SELECT count(*) FROM donations) AS don")).rows[0];

  it("GET shows the stored target (seeded 30%), computed coverage and zero custody", async () => {
    const r = TaxReserveResponse.parse((await get(`/api/tax-reserve/${W.trading}`)).json());
    expect(r.target).toMatchObject({ targetType: "percentage", targetPercentage: "30", targetAmount: null, currency: "USDC" });
    expect(r.resolvedTargetCents).toBe("1743000");
    expect(r.coverageBps).toBe(7709);
    expect(r.recommendedAdditionalReserveCents).toBe("422000");
    expect(r.custody).toBe("none");
    expect(r.reserveDataSource).toBe("demo");
    expect(r.verifiedOnChain).toBe(false);
  });
  it("POST updates the target in the database and moves no money", async () => {
    const before = await countTables();
    const r = await post(`/api/tax-reserve/${W.trading}/target`, { targetType: "amount", targetAmount: "10000.00", currency: "USDC" });
    expect(r.statusCode).toBe(200);
    expect(TaxReserveResponse.parse(r.json()).target).toMatchObject({ targetType: "amount", targetAmount: "10000.00", targetPercentage: null });
    expect(TaxReserveResponse.parse(r.json()).resolvedTargetCents).toBe("1000000");
    const row = (await ctx.pool.query("SELECT rule, percent_bps, target_cents FROM tax_reserves WHERE user_id = $1", [DEMO_IDS.user])).rows[0];
    expect(row).toEqual({ rule: "MANUAL_TARGET", percent_bps: null, target_cents: "1000000" });
    expect(await countTables()).toEqual(before);
    // persisted across reads
    expect(TaxReserveResponse.parse((await get(`/api/tax-reserve/${W.trading}`)).json()).target?.targetAmount).toBe("10000.00");
    // restore
    const back = await post(`/api/tax-reserve/${W.trading}/target`, { targetType: "percentage", targetPercentage: "30" });
    expect(TaxReserveResponse.parse(back.json()).target?.targetPercentage).toBe("30");
  });
  it("accepts fractional percent without floats", async () => {
    const r = TaxReserveResponse.parse((await post(`/api/tax-reserve/${W.trading}/target`, { targetType: "percentage", targetPercentage: "12.5" })).json());
    expect(r.target?.targetPercentage).toBe("12.5");
    expect(r.resolvedTargetCents).toBe("726250");
    await post(`/api/tax-reserve/${W.trading}/target`, { targetType: "percentage", targetPercentage: "30" });
  });
  it("rejects invalid bodies with structured field errors", async () => {
    for (const body of [
      {}, { targetType: "percentage" }, { targetType: "percentage", targetPercentage: "101" }, { targetType: "percentage", targetPercentage: "0" },
      { targetType: "amount", targetAmount: "-1" }, { targetType: "amount", targetAmount: "1.999" }, { targetType: "amount", targetAmount: "5", currency: "ETH" },
      { targetType: "percentage", targetPercentage: "30", targetAmount: "5" }, { targetType: "withdraw", amount: "5" },
    ]) {
      const r = await post(`/api/tax-reserve/${W.trading}/target`, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(ApiErrorBody.parse(r.json()).error.code).toBe("VALIDATION_ERROR");
    }
    // unchanged
    expect(TaxReserveResponse.parse((await get(`/api/tax-reserve/${W.trading}`)).json()).target?.targetPercentage).toBe("30");
  });
  it("cannot be written through someone else's wallet id", async () => {
    const r = await post(`/api/tax-reserve/${W.trading}/target`, { targetType: "amount", targetAmount: "1.00" }, other.token);
    expect(r.statusCode).toBe(404);
    expect(TaxReserveResponse.parse((await get(`/api/tax-reserve/${W.trading}`)).json()).target?.targetPercentage).toBe("30");
  });
});
