import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiErrorBody, Charity, CreateDonationResponse, DEMO_IDS, DonationsResponse } from "@project-name/shared";
import { makeCtx, makeOtherUser, bearer, W, type Ctx } from "./helpers";

let ctx: Ctx;
let other: Awaited<ReturnType<typeof makeOtherUser>>;
beforeAll(async () => { ctx = await makeCtx(); other = await makeOtherUser(ctx.pool); });
afterAll(async () => { await ctx.close(); });
const get = (url: string, token = ctx.demoToken) => ctx.app.inject({ url, headers: bearer(token) });
const post = (payload: unknown, token = ctx.demoToken) => ctx.app.inject({ method: "POST", url: "/api/donations", payload: payload as object, headers: bearer(token) });
const C = DEMO_IDS.charities;

describe("charities", () => {
  it("lists charities publicly with verification status, wallets, and provenance", async () => {
    const r = await ctx.app.inject({ url: "/api/charities" });
    const list = r.json().charities as Array<{ verificationStatus: string; dataSource: string }>;
    expect(list).toHaveLength(4);
    list.forEach((c) => Charity.parse(c));
    expect(list.filter((c) => c.verificationStatus === "verified")).toHaveLength(3);
    expect(list.every((c) => c.dataSource === "demo")).toBe(true);
  });
  it("filters by verified", async () => {
    expect((await ctx.app.inject({ url: "/api/charities?verified=true" })).json().charities).toHaveLength(3);
    expect((await ctx.app.inject({ url: "/api/charities?verified=false" })).json().charities).toHaveLength(1);
    expect((await ctx.app.inject({ url: "/api/charities?verified=maybe" })).statusCode).toBe(400);
  });
  it("gets one; 404 unknown; 400 malformed", async () => {
    const one = Charity.parse((await ctx.app.inject({ url: `/api/charities/${C.c1}` })).json());
    expect(one.wallets).toHaveLength(1);
    expect(one.wallets[0]?.verificationStatus).toBe("verified");
    expect((await ctx.app.inject({ url: `/api/charities/${C.c1.replace(/1$/, "f")}` })).statusCode).toBe(404);
    expect((await ctx.app.inject({ url: "/api/charities/abc" })).statusCode).toBe(400);
  });
});

describe("donations", () => {
  it("lists seeded donations as demo, with nothing confirmed", async () => {
    const d = DonationsResponse.parse((await get(`/api/donations/${W.trading}`)).json());
    expect(d.donations.length).toBeGreaterThanOrEqual(5);
    expect(d.donations.every((x) => x.status === "demo" && x.transactionSignature === null && x.receiptReference === null)).toBe(true);
    expect(d.confirmedTotalCents).toBe("0");
    expect(d.demoTotalCents).not.toBe("0");
    expect(d.taxNote).toMatch(/Potentially deductible/);
    expect(d.taxNote).not.toMatch(/guaranteed/i);
    expect(d.dataSource).toBe("demo");
    expect(d.verifiedOnChain).toBe(false);
  });
  it("POST creates a demo record, never 'confirmed', never a transaction", async () => {
    const before = Number((await ctx.pool.query("SELECT count(*) FROM raw_transactions")).rows[0].count);
    const r = await post({ walletId: W.trading, charityId: C.c2, amount: "25.50" });
    expect(r.statusCode).toBe(201);
    const { donation, notice } = CreateDonationResponse.parse(r.json());
    expect(donation).toMatchObject({ status: "demo", amountUsdCents: "2550", asset: "USDC", transactionSignature: null, receiptReference: null, dataSource: "demo", charityId: C.c2 });
    expect(notice).toMatch(/no blockchain transaction/i);
    expect(Number((await ctx.pool.query("SELECT count(*) FROM raw_transactions")).rows[0].count)).toBe(before);
    const row = (await ctx.pool.query("SELECT amount, usd_value_cents FROM donations WHERE id = $1", [donation.id])).rows[0];
    expect(row).toEqual({ amount: "25500000", usd_value_cents: "2550" }); // USDC base units
    const listed = DonationsResponse.parse((await get(`/api/donations/${W.trading}`)).json());
    expect(listed.donations.some((x) => x.id === donation.id)).toBe(true);
    expect(listed.confirmedTotalCents).toBe("0");
  });
  it("refuses unverified charities", async () => {
    const r = await post({ walletId: W.trading, charityId: C.c4, amount: "10" });
    expect(r.statusCode).toBe(422);
    expect(ApiErrorBody.parse(r.json()).error.code).toBe("CHARITY_NOT_VERIFIED");
  });
  it("404s unknown charities and foreign wallets", async () => {
    expect((await post({ walletId: W.trading, charityId: C.c1.replace(/1$/, "e"), amount: "10" })).statusCode).toBe(404);
    expect((await post({ walletId: other.walletId, charityId: C.c1, amount: "10" })).statusCode).toBe(404);
    expect((await post({ walletId: W.trading, charityId: C.c1, amount: "10" }, other.token)).statusCode).toBe(404);
  });
  it("validates the body", async () => {
    for (const body of [
      {}, { walletId: "x", charityId: C.c1, amount: "10" }, { walletId: W.trading, charityId: C.c1, amount: "0" },
      { walletId: W.trading, charityId: C.c1, amount: "-5" }, { walletId: W.trading, charityId: C.c1, amount: "1.999" },
      { walletId: W.trading, charityId: C.c1, amount: "abc" }, { walletId: W.trading, charityId: C.c1, amount: "10", status: "confirmed" },
      { walletId: W.trading, charityId: C.c1, amount: "10", asset: "SOL" },
    ]) {
      const r = await post(body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(r.json().error.code).toBe("VALIDATION_ERROR");
    }
  });
  it("client cannot force status confirmed; the database also forbids it without a transaction", async () => {
    const r = await post({ walletId: W.trading, charityId: C.c1, amount: "1", status: "confirmed" });
    expect(r.statusCode).toBe(400);
    await expect(ctx.pool.query("UPDATE donations SET status = 'confirmed' WHERE id = $1", [(await ctx.pool.query("SELECT id FROM donations LIMIT 1")).rows[0].id])).rejects.toThrow(/donations_confirmed_requires_tx/);
  });
  it("is owner-scoped on read", async () => {
    expect((await get(`/api/donations/${W.trading}`, other.token)).statusCode).toBe(404);
  });
});
