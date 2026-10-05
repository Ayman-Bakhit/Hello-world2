import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiErrorBody, DEMO_IDS, DEMO_WALLETS, Launch, LaunchList } from "@project-name/shared";
import { makeCtx, makeOtherUser, bearer, type Ctx } from "./helpers";

let ctx: Ctx;
let other: Awaited<ReturnType<typeof makeOtherUser>>;
beforeAll(async () => { ctx = await makeCtx(); other = await makeOtherUser(ctx.pool); });
afterAll(async () => { await ctx.close(); });

const creator = DEMO_WALLETS[1]!.address;
const valid = () => ({
  name: "Example Token", symbol: "EXMPL", description: "A test configuration", totalSupply: "1000000000", decimals: 6,
  creatorAllocationPercent: "8", creatorWallet: creator,
  liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 30 },
  feeSplit: { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 },
  charityConfiguration: { charityId: DEMO_IDS.charities.c1 },
  taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: creator },
});
const post = (url: string, payload?: unknown, token = ctx.demoToken) => ctx.app.inject({ method: "POST", url, ...(payload === undefined ? {} : { payload: payload as object }), headers: bearer(token) });
const get = (url: string, token = ctx.demoToken) => ctx.app.inject({ url, headers: bearer(token) });

describe("POST /launches", () => {
  it("creates a draft configuration: not deployed, labeled, defaults transparent", async () => {
    const r = await post("/api/launches", valid());
    expect(r.statusCode).toBe(201);
    const l = Launch.parse(r.json());
    expect(l).toMatchObject({ status: "draft", review: null, dataSource: "database", deployment: { status: "not_deployed", contractAddress: null } });
    expect(l.config).toMatchObject({ mintAuthority: "disabled", freezeAuthority: "disabled", feeSplit: valid().feeSplit });
  });
  it("rejects fee splits that are not exactly 10000 bps (shared validator)", async () => {
    const before = Number((await ctx.pool.query("SELECT count(*) FROM launch_configurations")).rows[0].count);
    for (const creatorBps of [6001, 5999, 0, 10000]) {
      const body = { ...valid(), feeSplit: { ...valid().feeSplit, creator: creatorBps } };
      const r = await post("/api/launches", body);
      expect(r.statusCode, String(creatorBps)).toBe(400);
      const e = ApiErrorBody.parse(r.json()).error;
      expect(e.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(e.fields)).toContain("exactly 10000");
    }
    expect(Number((await ctx.pool.query("SELECT count(*) FROM launch_configurations")).rows[0].count)).toBe(before);
  });
  it("rejects floats, negatives, strings, missing and extra fee fields", async () => {
    for (const feeSplit of [
      { creator: 6000.5, taxReserve: 1499.5, charity: 1500, protocol: 1000 }, { creator: -1, taxReserve: 6001, charity: 3000, protocol: 1000 },
      { creator: "6000", taxReserve: 1500, charity: 1500, protocol: 1000 }, { creator: 6000, taxReserve: 1500, charity: 1500 },
      { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000, extra: 0 },
    ]) expect((await post("/api/launches", { ...valid(), feeSplit })).statusCode, JSON.stringify(feeSplit)).toBe(400);
  });
  it("validates the rest of the configuration", async () => {
    for (const patch of [
      { name: "" }, { symbol: "ab" }, { symbol: "TOOLONGSYMBOL1" }, { totalSupply: "0" }, { totalSupply: "1e9" }, { decimals: 10 }, { decimals: 1.5 },
      { creatorAllocationPercent: "101" }, { description: "x".repeat(281) }, { unknownField: true }, { mintAuthority: "everyone" },
      { liquidityConfiguration: { initialLiquidityUsdc: "0", supplyPercentage: "40", lockDays: 30 } },
      { liquidityConfiguration: { initialLiquidityUsdc: "5", supplyPercentage: "40", lockDays: -1 } },
      { charityConfiguration: { charityId: "nope" } }, { taxReserveConfiguration: { destinationType: "platform", destinationAddress: creator } },
    ]) expect((await post("/api/launches", { ...valid(), ...patch })).statusCode, JSON.stringify(patch)).toBe(400);
  });
  it("creatorWallet must be one of the actor's wallets", async () => {
    const r = await post("/api/launches", { ...valid(), creatorWallet: other.address });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("WALLET_NOT_OWNED");
  });
  it("the database independently refuses a bad split", async () => {
    const bad = { ...valid(), feeSplit: { creator: 6001, taxReserve: 1500, charity: 1500, protocol: 1000 } };
    await expect(ctx.pool.query("INSERT INTO launch_configurations (creator_user_id, creator_wallet_id, name, symbol, config) VALUES ($1,$2,'x','XX',$3)", [DEMO_IDS.user, DEMO_IDS.wallets.creator, JSON.stringify(bad)])).rejects.toThrow(/launch_fee_split_is_10000_bps/);
  });
});

describe("GET /launches", () => {
  it("lists and fetches only the actor's launches", async () => {
    const created = Launch.parse((await post("/api/launches", valid())).json());
    const list = LaunchList.parse((await get("/api/launches?limit=100")).json());
    expect(list.launches.some((l) => l.id === created.id)).toBe(true);
    expect(Launch.parse((await get(`/api/launches/${created.id}`)).json()).id).toBe(created.id);
    expect(LaunchList.parse((await get("/api/launches", other.token)).json()).launches).toEqual([]);
    expect((await get(`/api/launches/${created.id}`, other.token)).statusCode).toBe(404);
    expect((await get("/api/launches/not-a-uuid")).statusCode).toBe(400);
  });
  it("paginates", async () => {
    const r = LaunchList.parse((await get("/api/launches?limit=1&offset=0")).json());
    expect(r.launches).toHaveLength(1);
    expect(r.pagination.total).toBeGreaterThan(1);
    expect((await get("/api/launches?limit=0")).statusCode).toBe(400);
  });
});

describe("POST /launches/:id/review", () => {
  it("passes a good configuration but never makes it deployable or 'immutable'", async () => {
    const l = Launch.parse((await post("/api/launches", valid())).json());
    const r = Launch.parse((await post(`/api/launches/${l.id}/review`)).json());
    expect(r.status).toBe("review_passed");
    expect(r.review).toMatchObject({ passed: true, errors: [], deployable: false, feeSplitLabel: "Configured fee split", feeSplitEnforcement: "not_enforced" });
    expect(r.review?.moneyFlowExampleCents).toEqual({ creator: "60000", taxReserve: "15000", charity: "15000", protocol: "10000" });
    expect(r.deployment.status).toBe("not_deployed");
    expect(JSON.stringify(r).toLowerCase()).not.toContain("immutable");
  });
  it("fails when the charity is unverified (decided at review time, from the database)", async () => {
    const l = Launch.parse((await post("/api/launches", { ...valid(), charityConfiguration: { charityId: DEMO_IDS.charities.c4 } })).json());
    const r = Launch.parse((await post(`/api/launches/${l.id}/review`)).json());
    expect(r.status).toBe("review_failed");
    expect(r.review?.errors.map((e) => e.field)).toContain("charityConfiguration.charityId");
  });
  it("fails when the reserve destination is not a wallet the actor controls, or supply is oversubscribed", async () => {
    const l = Launch.parse((await post("/api/launches", { ...valid(), creatorAllocationPercent: "70", taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: "SOMEONEELSE1111111111111111" } })).json());
    const r = Launch.parse((await post(`/api/launches/${l.id}/review`)).json());
    expect(r.review?.passed).toBe(false);
    expect(r.review?.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["taxReserveConfiguration.destinationAddress", "supply"]));
  });
  it("re-review reflects current state and warns about risky authorities", async () => {
    const l = Launch.parse((await post("/api/launches", { ...valid(), mintAuthority: "creator", liquidityConfiguration: { initialLiquidityUsdc: "5", supplyPercentage: "10", lockDays: 0 } })).json());
    const r = Launch.parse((await post(`/api/launches/${l.id}/review`)).json());
    expect(r.review?.warnings.join(" ")).toMatch(/Mint authority/);
    expect(r.review?.warnings.join(" ")).toMatch(/No liquidity lock/);
    expect(r.review?.warnings.join(" ")).toMatch(/not enforced on-chain/);
  });
  it("is owner-scoped and validates ids", async () => {
    const l = Launch.parse((await post("/api/launches", valid())).json());
    expect((await post(`/api/launches/${l.id}/review`, undefined, other.token)).statusCode).toBe(404);
    expect((await post("/api/launches/xyz/review")).statusCode).toBe(400);
    expect((await get(`/api/launches/${l.id}`)).json().status).toBe("draft");
  });
});
