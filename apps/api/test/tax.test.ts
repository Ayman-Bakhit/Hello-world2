import { afterEach, describe, expect, it } from "vitest";
import {
  KNOWN_DEX_PROGRAMS, SYSTEM_PROGRAM, TOKEN_PROGRAM, TaxDetailsResponse, TaxReserveResponse, TaxResponse, fakeBase58, fakeMint, fakeSignature, fakeTokenAccount, type TxSpec,
} from "@project-name/shared";
import { createSession } from "../src/auth/session";
import { FixtureHistoricalPriceProvider, ObservationHistoricalPriceProvider, pointLookup } from "../src/prices/historical";
import { NullPriceProvider } from "../src/prices/provider";
import { FakeSolanaRpc } from "../src/solana/fake";
import { bearer, makeCtx, W, type Ctx } from "./helpers";

const SOL = 1_000_000_000n;
const DEX = Object.keys(KNOWN_DEX_PROGRAMS)[0]!;
const MINT = fakeMint("tax-token");
const T = 1_700_000_000;

let ctx: Ctx;
let rpc: FakeSolanaRpc;
afterEach(async () => { await ctx?.close(); ctx = undefined as never; });

interface U { userId: string; walletId: string; address: string; token: string }
async function user(seed: string): Promise<U> {
  const u = await ctx.pool.query("INSERT INTO users (display_name) VALUES ($1) RETURNING id", [seed]);
  return { userId: u.rows[0].id, ...(await wallet(u.rows[0].id, `${seed}-1`)) } as U;
}
async function wallet(userId: string, seed: string) {
  const address = fakeBase58(`taxwallet:${seed}`, 44);
  const w = await ctx.pool.query("INSERT INTO wallets (user_id, chain, address, label, data_source, ownership_verified_at) VALUES ($1,'solana',$2,'Live','database', now()) RETURNING id", [userId, address]);
  const { token } = await createSession(ctx.pool, { userId, walletId: w.rows[0].id, authMethod: "wallet_signature", ttlHours: 1 });
  return { walletId: w.rows[0].id as string, address, token };
}
const boot = async (taxPrices?: FixtureHistoricalPriceProvider) => {
  rpc = new FakeSolanaRpc();
  ctx = await makeCtx({ INDEXER_MIN_SYNC_INTERVAL_SECONDS: "0", INDEXER_SYNC_ON_LOGIN: "false" }, undefined, { rpc, metadata: rpc, prices: new NullPriceProvider() }, taxPrices);
};
const sync = async (u: { token: string; walletId: string }) => {
  await ctx.app.inject({ method: "POST", url: `/api/wallets/${u.walletId}/sync`, headers: bearer(u.token) });
  await ctx.app.indexer.drain();
};
const get = (u: { token: string }, url: string) => ctx.app.inject({ method: "GET", url, headers: bearer(u.token) });
const tax = async (u: U, q = "") => TaxResponse.parse((await get(u, `/api/tax/${u.walletId}${q}`)).json());
const details = async (u: U, q = "") => TaxDetailsResponse.parse((await get(u, `/api/tax/${u.walletId}/details${q}`)).json());

/** wallet swaps 1 SOL for 25 tokens through a recognized DEX at time T+n */
const swapSpec = (addr: string, n: number): TxSpec => ({
  signature: fakeSignature(`swap${n}-${addr}`), slot: 100 + n, blockTime: T + n * 86_400, fee: 5000,
  accounts: [{ key: addr, pre: 5n * SOL, post: 4n * SOL - 5000n }, { key: fakeTokenAccount(`t${n}-${addr}`), pre: 0, post: 0 }],
  tokens: [{ index: 1, mint: MINT, owner: addr, pre: 0n, post: 25_000_000n, decimals: 6 }], programs: [DEX],
});
const solIn = (addr: string, n: number): TxSpec => ({
  signature: fakeSignature(`in${n}-${addr}`), slot: 10 + n, blockTime: T + n, fee: 5000,
  accounts: [{ key: fakeBase58("payer", 44), pre: 9n * SOL, post: 8n * SOL - 5000n }, { key: addr, pre: 0, post: 3n * SOL }], programs: [SYSTEM_PROGRAM],
});

describe("tax API: real wallets", () => {
  it("never synced: UNAVAILABLE, no figures, SYNC requirement", async () => {
    await boot();
    const u = await user("t-unsynced");
    const t = await tax(u);
    expect(t).toMatchObject({ status: "UNAVAILABLE", figuresComplete: false, dataSource: "chain", verifiedOnChain: false, estimatedRealizedGainsCents: null, estimatedTaxExposureCents: null });
    expect(t.requirements.map((r) => r.kind)).toContain("SYNC");
  });
  it("synced but no prices: swap is DATA_REQUIRED (PRICE DATA UNAVAILABLE), value null (never zero), never COMPLETE", async () => {
    await boot();
    const u = await user("t-noprice");
    rpc.addWallet(u.address, { lamports: 4n * SOL });
    rpc.addTx([u.address], solIn(u.address, 1));
    rpc.addTx([u.address], swapSpec(u.address, 2));
    await sync(u);
    const t = await tax(u, "?taxYear=2023");
    expect(t.status).toBe("DATA_REQUIRED");
    expect(t.figuresComplete).toBe(false);
    expect(t.requirements.some((r) => r.kind === "PRICE" && r.severity === "blocks_total")).toBe(true);
    expect(t.calculation!.priceSources).toEqual([]);
    const d = await details(u, "?taxYear=2023");
    const swapEvents = d.events.filter((e) => e.classification.kind === "swap");
    expect(swapEvents.length).toBe(2);
    for (const e of swapEvents) expect(e).toMatchObject({ status: "DATA_REQUIRED", usdValueCents: null, priceMicroUsd: null, missing: ["PRICE"], confidence: "NONE" });
    expect(swapEvents[0]!.reason).toContain("PRICE DATA UNAVAILABLE");
    expect(d.realized).toEqual([]);
  });
  it("fixture prices: events are priced and labeled (fixture); SOL cost basis is still missing, so still DATA_REQUIRED", async () => {
    await boot(new FixtureHistoricalPriceProvider([{ asset: "native", observedAt: T, priceMicroUsd: 100_000_000n }, { asset: "native", observedAt: T + 2 * 86_400 - 60, priceMicroUsd: 120_000_000n }], 3600));
    const u = await user("t-fixture");
    rpc.addWallet(u.address, { lamports: 4n * SOL });
    rpc.addTx([u.address], solIn(u.address, 1));
    rpc.addTx([u.address], swapSpec(u.address, 2));
    await sync(u);
    const t = await tax(u, "?taxYear=2023");
    expect(t.calculation!.priceSources).toEqual(["fixture (fixture)"]);
    const d = await details(u, "?taxYear=2023");
    const sell = d.events.find((e) => e.kind === "SELL")!;
    expect(sell).toMatchObject({ asset: "SOL", usdValueCents: "12000", priceSource: "fixture (fixture)", valuation: "PRICE", confidence: "ESTIMATED" });
    const buy = d.events.find((e) => e.kind === "BUY")!;
    expect(buy).toMatchObject({ mint: MINT, valuation: "COUNTER_LEG", usdValueCents: "12000", quantity: "25000000" });
    // the SOL it sold arrived by an unmatched transfer: no cost basis is invented
    expect(sell.status).toBe("DATA_REQUIRED");
    expect(sell.missing).toEqual(["COST_BASIS"]);
    expect(sell.uncoveredQuantity).toBe(SOL.toString());
    expect(t.status).toBe("DATA_REQUIRED");
    expect(d.events.find((e) => e.kind === "TRANSFER_IN")).toMatchObject({ status: "UNRESOLVED", missing: ["TRANSFER_MATCH"], usdValueCents: null });
    expect(d.realized).toEqual([]);
  });
  it("price too old (outside the tolerance) is NOT used: no look-ahead, no stale reuse", async () => {
    await boot(new FixtureHistoricalPriceProvider([{ asset: "native", observedAt: T - 100_000, priceMicroUsd: 100_000_000n }, { asset: "native", observedAt: T + 10 * 86_400, priceMicroUsd: 100_000_000n }], 3600));
    const u = await user("t-stale");
    rpc.addWallet(u.address, { lamports: 4n * SOL });
    rpc.addTx([u.address], swapSpec(u.address, 2));
    await sync(u);
    const t = await tax(u, "?taxYear=2023");
    expect(t.status).toBe("DATA_REQUIRED");
    expect(t.calculation!.priceSources).toEqual([]);
  });
  it("internal transfer between the user's two wallets (same transaction) is MATCHED and the result is COMPLETE", async () => {
    await boot();
    const a = await user("t-two");
    const b = await wallet(a.userId, "t-two-2");
    rpc.addWallet(a.address, { lamports: 4n * SOL }).addWallet(b.address, { lamports: SOL });
    const spec: TxSpec = { signature: fakeSignature("internal"), slot: 50, blockTime: T, fee: 5000, accounts: [{ key: a.address, pre: 5n * SOL, post: 4n * SOL - 5000n }, { key: b.address, pre: 0, post: SOL }], programs: [SYSTEM_PROGRAM] };
    rpc.addTx([a.address, b.address], spec);
    await sync(a); await sync(b);
    const t = await tax(a, "?taxYear=2023&shortTermRateBps=3000&longTermRateBps=1500&stateRateBps=500");
    expect(t.calculation!.walletsIncluded).toBe(2);
    expect(t.calculation!.counts).toMatchObject({ matched: 2, unresolved: 0, TRANSFER_IN: 1, TRANSFER_OUT: 1 });
    expect(t.status).toBe("COMPLETE");
    expect(t.estimatedTaxExposureCents).toBe("0");
    const d = await details(a, "?taxYear=2023");
    expect(d.events.every((e) => e.status === "MATCHED" && e.matchedWith !== null)).toBe(true);
    expect(d.realized).toEqual([]);
    // the same user-level result is returned whichever of the user's wallets is asked
    expect((await tax({ ...b, userId: a.userId }, "?taxYear=2023")).calculation!.inputFingerprint).toBe(t.calculation!.inputFingerprint);
  });
  it("one wallet of two never synced: history/holdings incomplete, so PARTIAL at best", async () => {
    await boot();
    const a = await user("t-half");
    await wallet(a.userId, "t-half-2"); // never synced
    rpc.addWallet(a.address, { lamports: SOL });
    await sync(a);
    const t = await tax(a, "?taxYear=2023");
    expect(t.status).toBe("PARTIAL");
    expect(t.requirements.map((r) => r.kind)).toEqual(expect.arrayContaining(["HISTORY", "HOLDINGS"]));
  });
  it("accounting method is explicit: requested vs default, echoed everywhere; bad values rejected", async () => {
    await boot();
    const u = await user("t-method");
    rpc.addWallet(u.address, { lamports: SOL });
    await sync(u);
    expect(await tax(u)).toMatchObject({ costBasisMethod: "FIFO", methodSource: "default" });
    for (const m of ["FIFO", "LIFO", "HIFO"]) expect(await tax(u, `?method=${m}`)).toMatchObject({ costBasisMethod: m, methodSource: "requested" });
    expect((await details(u, "?method=HIFO")).costBasisMethod).toBe("HIFO");
    expect((await get(u, `/api/tax/${u.walletId}?method=SPECIFIC`)).statusCode).toBe(400);
    expect((await get(u, `/api/tax/${u.walletId}?taxYear=1999`)).statusCode).toBe(400);
    expect((await get(u, `/api/tax/${u.walletId}?foo=1`)).statusCode).toBe(400);
  });
  it("rates: none => no exposure (and RATES info); all three => echoed assumptions; partial => 400", async () => {
    await boot();
    const u = await user("t-rates");
    rpc.addWallet(u.address, { lamports: SOL });
    await sync(u);
    const none = await tax(u, "?taxYear=2023");
    expect(none.estimatedTaxExposureCents).toBeNull();
    expect(none.assumptions).toBeNull();
    expect(none.requirements.find((r) => r.kind === "RATES")!.severity).toBe("info");
    const some = await tax(u, "?taxYear=2023&shortTermRateBps=3000&longTermRateBps=1500&stateRateBps=0");
    expect(some.assumptions).toEqual({ jurisdiction: "US", taxYear: 2023, shortTermRateBps: 3000, longTermRateBps: 1500, stateRateBps: 0 });
    expect(some.estimatedTaxExposureCents).toBe("0");
    expect((await get(u, `/api/tax/${u.walletId}?shortTermRateBps=3000`)).statusCode).toBe(400);
    expect((await get(u, `/api/tax/${u.walletId}?shortTermRateBps=99999&longTermRateBps=1&stateRateBps=1`)).statusCode).toBe(400);
  });
  it("reproducible: same inputs => same fingerprint; new transaction => different fingerprint", async () => {
    await boot();
    const u = await user("t-fp");
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.addTx([u.address], solIn(u.address, 1));
    await sync(u);
    const a = (await tax(u, "?taxYear=2023")).calculation!.inputFingerprint;
    expect((await tax(u, "?taxYear=2023")).calculation!.inputFingerprint).toBe(a);
    expect((await tax(u, "?taxYear=2024")).calculation!.inputFingerprint).not.toBe(a);
    rpc.addTx([u.address], solIn(u.address, 2));
    rpc.slot = 9000n;
    await sync(u);
    expect((await tax(u, "?taxYear=2023")).calculation!.inputFingerprint).not.toBe(a);
  });
  it("raw quantities above 2^53 are exact in the details", async () => {
    await boot();
    const u = await user("t-big");
    const big = 18_446_744_073_709_551_615n;
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.addTx([u.address], { signature: fakeSignature("bigtok"), slot: 5, blockTime: T, fee: 5000, accounts: [{ key: fakeBase58("payer", 44), pre: SOL, post: SOL - 5000n }, { key: fakeTokenAccount("bt"), pre: 0, post: 0 }], tokens: [{ index: 1, mint: MINT, owner: u.address, pre: 0n, post: big, decimals: 9 }], programs: [TOKEN_PROGRAM] });
    await sync(u);
    const d = await details(u, "?taxYear=2023");
    expect(d.events.find((e) => e.kind === "TRANSFER_IN")!.quantity).toBe(big.toString());
  });
  it("failed transactions are FEE events with the fee recorded and never create lots", async () => {
    await boot();
    const u = await user("t-failed");
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.addTx([u.address], { signature: fakeSignature("failedtx"), slot: 5, blockTime: T, fee: 7000, err: { InstructionError: [0, "Custom"] }, accounts: [{ key: u.address, pre: SOL, post: SOL - 7000n }], programs: [SYSTEM_PROGRAM] });
    await sync(u);
    const d = await details(u, "?taxYear=2023");
    expect(d.events).toHaveLength(1);
    expect(d.events[0]).toMatchObject({ kind: "FEE", feeLamports: "7000", status: "READY" });
    expect(d.realized).toEqual([]);
    expect((await tax(u, "?taxYear=2023")).calculation!.feePolicy).toBe("RECORDED_NOT_APPLIED");
  });
});

describe("tax API: authorization and isolation", () => {
  it("401 without a session; foreign and unknown wallets are 404; bad ids 400", async () => {
    await boot();
    const owner = await user("t-own"), other = await user("t-other");
    for (const p of [`/api/tax/${owner.walletId}`, `/api/tax/${owner.walletId}/details`, `/api/tax-reserve/${owner.walletId}`]) {
      expect((await ctx.app.inject({ method: "GET", url: p })).statusCode, p).toBe(401);
      expect((await get(other, p)).statusCode, p).toBe(404);
    }
    expect((await get(owner, "/api/tax/not-a-uuid")).statusCode).toBe(400);
  });
  it("a user's tax never includes another user's transactions", async () => {
    await boot();
    const a = await user("t-iso-a"), b = await user("t-iso-b");
    rpc.addWallet(a.address, { lamports: SOL }).addWallet(b.address, { lamports: SOL });
    rpc.addTx([a.address], solIn(a.address, 1));
    await sync(a); await sync(b);
    expect((await details(a)).events).toHaveLength(1);
    expect((await details(b)).events).toHaveLength(0);
  });
  it("demo wallets get labeled demo results; real wallets never do", async () => {
    await boot();
    const demo = { token: ctx.demoToken, walletId: W.trading };
    const d = TaxResponse.parse((await get(demo, `/api/tax/${W.trading}`)).json());
    expect(d).toMatchObject({ dataSource: "demo", methodSource: "demo_fixture", calculation: null });
    const dd = TaxDetailsResponse.parse((await get(demo, `/api/tax/${W.trading}/details`)).json());
    expect(dd).toMatchObject({ dataSource: "demo", events: [], realized: [] });
    const u = await user("t-nodemo");
    expect(JSON.stringify(await tax(u))).not.toMatch(/18420|DEMO/);
  });
  it("responses use cautious language: no guarantee/loophole/tax-free wording, no 'tax bill' field", async () => {
    await boot();
    const u = await user("t-copy");
    rpc.addWallet(u.address, { lamports: SOL });
    await sync(u);
    const body = JSON.stringify([await tax(u), await details(u), (await get(u, `/api/tax-reserve/${u.walletId}`)).json()]);
    expect(body).not.toMatch(/guarantee|loophole|tax-free|write-off|write off|taxbill|tax_bill/i);
    expect(body).toContain("tax advice");
  });
});

describe("tax reserve (estimate only, no money movement)", () => {
  it("real wallet: estimated requirement only; balance/coverage are null (not read), target resolves from realized net gains", async () => {
    await boot();
    const u = await user("t-res");
    rpc.addWallet(u.address, { lamports: SOL });
    await sync(u);
    const post = await ctx.app.inject({ method: "POST", url: `/api/tax-reserve/${u.walletId}/target`, payload: { targetType: "percentage", targetPercentage: "30" }, headers: bearer(u.token) });
    expect(post.statusCode).toBe(200);
    const r = TaxReserveResponse.parse((await get(u, `/api/tax-reserve/${u.walletId}?taxYear=2023&shortTermRateBps=3000&longTermRateBps=1500&stateRateBps=0`)).json());
    expect(r).toMatchObject({ custody: "none", currentReserveCents: null, reserveDataSource: null, coverageBps: null, recommendedAdditionalReserveCents: null, estimatedTaxExposureCents: "0", resolvedTargetCents: "0", dataSource: "chain" });
    expect(r.target).toMatchObject({ targetType: "percentage", targetPercentage: "30" });
    expect(r.disclaimer.join(" ")).toMatch(/never moves funds/);
    const noRates = TaxReserveResponse.parse((await get(u, `/api/tax-reserve/${u.walletId}`)).json());
    expect(noRates.estimatedTaxExposureCents).toBeNull();
  });
  it("incomplete data is called out in the reserve disclaimer", async () => {
    await boot();
    const u = await user("t-res2");
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.addTx([u.address], solIn(u.address, 1));
    await sync(u);
    const r = TaxReserveResponse.parse((await get(u, `/api/tax-reserve/${u.walletId}`)).json());
    expect(r.status).toBe("PARTIAL");
    expect(r.disclaimer.join(" ")).toContain("TAX DATA INCOMPLETE");
  });
  it("there is no route that moves funds (no transfer/deposit/withdraw/fund endpoints exist)", async () => {
    await boot();
    const u = await user("t-nomove");
    for (const [m, p] of [["POST", "fund"], ["POST", "transfer"], ["POST", "deposit"], ["POST", "withdraw"]] as const) {
      expect((await ctx.app.inject({ method: m, url: `/api/tax-reserve/${u.walletId}/${p}`, headers: bearer(u.token), payload: {} })).statusCode, p).toBe(404);
    }
  });
});

describe("historical price providers", () => {
  const P = (asset: string, at: number, micro: bigint) => ({ asset, observedAt: at, priceMicroUsd: micro, source: "s", confidence: "OBSERVED" as const });
  it("latest at-or-before, within max age; never a future price; zero is ignored; unknown asset is null", () => {
    const f = pointLookup([P("a", 100, 5n), P("a", 200, 7n), P("a", 300, 9n), P("z", 100, 0n)], 50);
    expect(f("a", 99)).toBeNull(); // nothing before
    expect(f("a", 100)!.priceMicroUsd).toBe(5n);
    expect(f("a", 149)!.priceMicroUsd).toBe(5n);
    expect(f("a", 151)).toBeNull(); // 51s old
    expect(f("a", 250)!.priceMicroUsd).toBe(7n);
    expect(f("a", 299)).toBeNull(); // 99s after the 200 point, not the 300 one (no look-ahead)
    expect(f("z", 100)).toBeNull();
    expect(f("nope", 100)).toBeNull();
  });
  const priceAsset = async (seed: string) => {
    const mint = fakeMint(seed); // own asset: price rows are shared across parallel test files, so never touch other assets
    const r = await ctx.pool.query("INSERT INTO assets (chain, address, symbol, name, decimals, kind, data_source) VALUES ('solana',$1,NULL,NULL,6,'spl','chain') ON CONFLICT (chain,address) DO UPDATE SET decimals = 6 RETURNING id", [mint]);
    return { mint, id: r.rows[0].id as string };
  };
  it("DB-backed provider reads price_observations with source and confidence", async () => {
    await boot();
    const a = await priceAsset("price-db-1");
    await ctx.pool.query("INSERT INTO price_observations (asset_id, provider, observed_at, price_micro_usd) VALUES ($1,'coingecko', to_timestamp($2), 150000000) ON CONFLICT DO NOTHING", [a.id, T]);
    const at = await new ObservationHistoricalPriceProvider(ctx.pool, 600).loadSeries([a.mint]);
    expect(at(a.mint, T + 100)).toMatchObject({ priceMicroUsd: 150_000_000n, source: "coingecko", confidence: "OBSERVED" });
    expect(at(a.mint, T + 601)).toBeNull();
    expect(at(a.mint, T - 1)).toBeNull();
  });
  it("price rows cannot be rewritten in place and a zero price cannot be stored", async () => {
    await boot();
    const a = await priceAsset("price-db-2");
    await ctx.pool.query("INSERT INTO price_observations (asset_id, provider, observed_at, price_micro_usd) VALUES ($1,'p', now(), 5)", [a.id]);
    await expect(ctx.pool.query("UPDATE price_observations SET price_micro_usd = 9 WHERE asset_id = $1", [a.id])).rejects.toThrow();
    await expect(ctx.pool.query("INSERT INTO price_observations (asset_id, provider, observed_at, price_micro_usd) VALUES ($1,'p', now() + interval '1 second', 0)", [a.id])).rejects.toThrow();
  });
});
