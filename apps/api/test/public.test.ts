import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiErrorBody, DiscoverResponse, TokenList, TokenProof } from "@project-name/shared";
import { makeCtx, type Ctx } from "./helpers";

let ctx: Ctx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.close(); });
const get = (url: string) => ctx.app.inject({ url });

describe("token proof", () => {
  it("returns required fields and says demo, not on-chain verified", async () => {
    const r = await get("/api/tokens/demo/proof");
    expect(r.statusCode).toBe(200);
    const p = TokenProof.parse(r.json());
    for (const k of ["contractAddress", "creatorWallet", "liquidity", "feeSplit", "charity", "taxReserve", "protocol", "mintAuthority", "freezeAuthority", "adminStatus", "dataSource"]) expect(p).toHaveProperty(k);
    expect(p.dataSource).toBe("demo");
    expect(p.verifiedOnChain).toBe(false);
    expect(p.contractAddress).toBeNull();
    expect(p.evidence).toEqual([]);
    expect(p.feeSplit).toMatchObject({ label: "Configured fee split", enforcement: "not_enforced", mutability: "UNDETERMINED" });
    expect(p.notice).toMatch(/nothing here is verified on-chain/i);
  });
  it("money flow sums to lifetime fees and fee split to 10000 bps", async () => {
    const p = TokenProof.parse((await get("/api/tokens/demo/proof")).json());
    const f = p.moneyFlowCents;
    expect(BigInt(f.creator) + BigInt(f.taxReserve) + BigInt(f.charity) + BigInt(f.protocol)).toBe(8_220_000n);
    expect(p.feeSplit.creator + p.feeSplit.taxReserve + p.feeSplit.charity + p.feeSplit.protocol).toBe(10_000);
  });
  it("/proof/:id returns the same data; unknown 404; malformed 400", async () => {
    expect((await get("/api/proof/demo")).json()).toEqual((await get("/api/tokens/demo/proof")).json());
    expect((await get("/api/tokens/nope/proof")).statusCode).toBe(404);
    expect((await get("/api/tokens/NOT%20VALID/proof")).statusCode).toBe(400);
    expect(ApiErrorBody.parse((await get("/api/proof/nope")).json()).error.code).toBe("NOT_FOUND");
  });
  it("never claims a verified or safe status", async () => {
    for (const id of ["demo", "demo-lantern", "demo-orchard"]) {
      const body = (await get(`/api/tokens/${id}/proof`)).body.toLowerCase();
      expect(body).not.toMatch(/"safe"|anti-rug|guaranteed|"immutable"/);
    }
  });
  it("lists tokens as demo", async () => {
    const l = TokenList.parse((await get("/api/tokens")).json());
    expect(l.tokens).toHaveLength(6);
    expect(l.tokens.every((t) => t.dataSource === "demo")).toBe(true);
  });
});

describe("discover", () => {
  const q = async (qs: string) => DiscoverResponse.parse((await get(`/api/discover${qs}`)).json());
  it("defaults to volume ranking with a public rule and demo provenance", async () => {
    const d = await q("");
    expect(d.tokens.map((t) => t.symbol)).toEqual(["ORCH", "HRBR", "TIDE", "MRDN", "FNDM", "LNTN"]);
    expect(d.ranking.rule).toMatch(/volume/i);
    expect(d).toMatchObject({ dataSource: "demo", verifiedOnChain: false });
    expect(d.notice).toMatch(/nothing is boosted, paid, or manufactured/i);
  });
  it("supports every sort", async () => {
    for (const sort of ["volume", "liquidity", "holders", "marketCap", "newest", "trending", "charity", "lowestCreatorConcentration"]) {
      expect((await q(`?sort=${sort}`)).tokens).toHaveLength(6);
    }
    expect((await q("?sort=newest")).tokens[0]?.symbol).toBe("LNTN");
    expect((await q("?sort=holders")).tokens[0]?.symbol).toBe("ORCH");
  });
  it("filters by market cap, liquidity, volume, holders", async () => {
    expect((await q("?minMarketCap=1000000&maxMarketCap=3000000")).tokens.map((t) => t.symbol).sort()).toEqual(["HRBR", "TIDE"]);
    expect((await q("?minLiquidity=100000")).tokens.map((t) => t.symbol).sort()).toEqual(["ORCH", "TIDE"]);
    expect((await q("?minVolume=20000")).tokens.map((t) => t.symbol).sort()).toEqual(["HRBR", "ORCH"]);
    expect((await q("?minHolders=1000")).tokens.map((t) => t.symbol).sort()).toEqual(["HRBR", "ORCH", "TIDE"]);
    expect((await q("?minHolders=1000&minLiquidity=100000&sort=liquidity")).tokens.map((t) => t.symbol)).toEqual(["ORCH", "TIDE"]);
  });
  it("launchedWithinDays filters recent launches", async () => {
    expect((await q("?launchedWithinDays=14&sort=newest")).tokens.map((t) => t.symbol)).toEqual(["LNTN", "FNDM"]);
    expect((await get("/api/discover?launchedWithinDays=0")).statusCode).toBe(400);
  });
  it("verifiedTransparency=true uses the server-derived flag: reported checks are not verification, so demo tokens never match", async () => {
    expect((await q("?verifiedTransparency=true")).tokens).toEqual([]);
    const all = await q("");
    expect(all.tokens.every((t) => t.verifiedTransparency === false)).toBe(true);
    expect(all.tokens.filter((t) => t.allTransparencyChecksReported).map((t) => t.symbol).sort()).toEqual(["HRBR", "ORCH"]);
  });
  it("paginates deterministically", async () => {
    const a = await q("?limit=2&offset=0"), b = await q("?limit=2&offset=2");
    expect(a.pagination.total).toBe(6);
    expect([...a.tokens, ...b.tokens].map((t) => t.symbol)).toEqual(["ORCH", "HRBR", "TIDE", "MRDN"]);
  });
  it("rejects invalid filters with field errors", async () => {
    for (const qs of ["?sort=pump", "?minMarketCap=-1", "?minMarketCap=1.5", "?minMarketCap=10&maxMarketCap=5", "?limit=0", "?minHolders=abc", "?verifiedTransparency=yes", "?boost=1"]) {
      const r = await get(`/api/discover${qs}`);
      expect(r.statusCode, qs).toBe(400);
      expect(ApiErrorBody.parse(r.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });
  it("returns an empty list, not fabricated tokens, when nothing matches", async () => {
    const d = await q("?minMarketCap=999999999999");
    expect(d.tokens).toEqual([]);
    expect(d.pagination.total).toBe(0);
  });
});
