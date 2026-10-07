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
    expect(p.assets.reduce((s, a) => s + a.allocationBps!, 0)).toBeLessThanOrEqual(10_000);
    expect(BigInt(p.totalValueCents!) - BigInt(p.costBasisCents!)).toBe(BigInt(p.unrealizedPnlCents!));
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
    // Own wallet, but it is a 'database' wallet with no indexed data: 404 NO_LIVE_DATA, never invented balances.
    for (const path of ["portfolio", "transactions"]) {
      const r = await get(`/api/${path}/${other.walletId}`, other.token);
      expect(r.statusCode, path).toBe(404);
      expect(r.json().error.code, path).toBe("NO_LIVE_DATA");
    }
    // Tax (Slice 6): 200 with status UNAVAILABLE and no figures, never demo numbers
    for (const path of ["tax", "tax-reserve"]) {
      const b = (await get(`/api/${path}/${other.walletId}`, other.token)).json();
      expect(path === "tax" ? b.status : b.taxEstimate.status, path).toBe("UNAVAILABLE");
      expect(b.dataSource, path).toBe("chain");
      expect(JSON.stringify(b), path).not.toMatch(/DEMO|18420|1420000/);
    }
    // storing a reserve TARGET is configuration only and is allowed for a real wallet
    const post = await ctx.app.inject({ method: "POST", url: `/api/tax-reserve/${other.walletId}/target`, payload: { targetType: "amount", targetAmount: "5.00", confirmed: true }, headers: bearer(other.token) });
    expect(post.statusCode).toBe(200);
    expect(post.json().taxEstimate.status).toBe("UNAVAILABLE");
    expect(post.json().recommendation.label).toBe("NO TAX RESERVE ESTIMATE AVAILABLE");
    expect(post.json().reserveBalance.label).toBe("RESERVE BALANCE UNAVAILABLE");
    // a foreign or unknown wallet is a plain NOT_FOUND, distinguishable from "yours but empty"
    expect((await get(`/api/portfolio/${W.trading}`, other.token)).json().error.code).toBe("NOT_FOUND");
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
  const C = { confirmed: true };

  it("GET (demo wallet) shows the stored target (seeded 30%) against a labeled DEMO balance, coverage over the TARGET, zero custody", async () => {
    const r = TaxReserveResponse.parse((await get(`/api/tax-reserve/${W.trading}`)).json());
    expect(r.userTarget).toMatchObject({ set: true, source: "USER_SET", enabled: true, targetType: "percentage", targetPercentage: "30", targetAmountCents: null, resolvedCents: "1743000" });
    expect(r.reserveBalance).toMatchObject({ source: "DEMO_FIXTURE", status: "DEMO", cents: "1420000" });
    expect(r.coverage).toMatchObject({ available: true, bps: 8146 });
    expect(r.remaining.cents).toBe("323000");
    expect(r.funding.custody).toBe("none");
    expect(r.taxEstimate).toMatchObject({ source: "DEMO_FIXTURE", status: "COMPLETE", authoritative: false });
    expect(r.dataSource).toBe("demo");
    expect(r.verifiedOnChain).toBe(false);
  });
  it("POST updates the target in the database and moves no money", async () => {
    const before = await countTables();
    const r = await post(`/api/tax-reserve/${W.trading}/target`, { targetType: "amount", targetAmount: "10000.00", currency: "USDC", ...C });
    expect(r.statusCode).toBe(200);
    const body = TaxReserveResponse.parse(r.json());
    expect(body.userTarget).toMatchObject({ targetType: "amount", targetAmountCents: "1000000", targetPercentage: null, resolvedCents: "1000000", source: "USER_SET" });
    expect(body.coverage.bps).toBe(14_200); // $14,200 demo balance over a $10,000 target
    expect(body.remaining.cents).toBe("0");
    const row = (await ctx.pool.query("SELECT rule, percent_bps, target_cents, target_source, enabled FROM tax_reserves WHERE user_id = $1", [DEMO_IDS.user])).rows[0];
    expect(row).toEqual({ rule: "MANUAL_TARGET", percent_bps: null, target_cents: "1000000", target_source: "USER_SET", enabled: true });
    expect(await countTables()).toEqual(before);
    // persisted across reads
    expect(TaxReserveResponse.parse((await get(`/api/tax-reserve/${W.trading}`)).json()).userTarget.targetAmountCents).toBe("1000000");
    // restore
    const back = await post(`/api/tax-reserve/${W.trading}/target`, { targetType: "percentage", targetPercentage: "30", ...C });
    expect(TaxReserveResponse.parse(back.json()).userTarget.targetPercentage).toBe("30");
  });
  it("accepts fractional percent without floats", async () => {
    const r = TaxReserveResponse.parse((await post(`/api/tax-reserve/${W.trading}/target`, { targetType: "percentage", targetPercentage: "12.5", ...C })).json());
    expect(r.userTarget.targetPercentage).toBe("12.5");
    expect(r.userTarget.resolvedCents).toBe("726250");
    await post(`/api/tax-reserve/${W.trading}/target`, { targetType: "percentage", targetPercentage: "30", ...C });
  });
  it("rejects invalid bodies with structured field errors", async () => {
    for (const body of [
      {}, { targetType: "percentage" }, { targetType: "percentage", targetPercentage: "101", ...C }, { targetType: "percentage", targetPercentage: "0", ...C },
      { targetType: "amount", targetAmount: "-1", ...C }, { targetType: "amount", targetAmount: "1.999", ...C }, { targetType: "amount", targetAmount: "5", currency: "ETH", ...C },
      { targetType: "percentage", targetPercentage: "30", targetAmount: "5", ...C }, { targetType: "withdraw", amount: "5", ...C },
      { targetType: "amount", targetAmount: "5" }, { targetType: "amount", targetAmount: "5", confirmed: false },
    ]) {
      const r = await post(`/api/tax-reserve/${W.trading}/target`, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(ApiErrorBody.parse(r.json()).error.code).toBe("VALIDATION_ERROR");
    }
    // unchanged
    expect(TaxReserveResponse.parse((await get(`/api/tax-reserve/${W.trading}`)).json()).userTarget.targetPercentage).toBe("30");
  });
  it("cannot be written through someone else's wallet id", async () => {
    const r = await post(`/api/tax-reserve/${W.trading}/target`, { targetType: "amount", targetAmount: "1.00", ...C }, other.token);
    expect(r.statusCode).toBe(404);
    expect(TaxReserveResponse.parse((await get(`/api/tax-reserve/${W.trading}`)).json()).userTarget.targetPercentage).toBe("30");
  });
});

