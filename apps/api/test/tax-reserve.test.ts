import { afterEach, describe, expect, it } from "vitest";
import {
  BANNED_PHRASES, DEMO_IDS, KNOWN_DEX_PROGRAMS, SYSTEM_PROGRAM, TOKEN_PROGRAM, TaxCalculateResponse, TaxReserveResponse, fakeBase58, fakeMint, fakeSignature, fakeTokenAccount, type TxSpec,
} from "@project-name/shared";
import { createSession } from "../src/auth/session";
import { type HistoricalPriceProvider } from "../src/prices/historical";
import { NullPriceProvider } from "../src/prices/provider";
import { FakeSolanaRpc } from "../src/solana/fake";
import { bearer, makeCtx, makeOtherUser, W, type Ctx } from "./helpers";

const SOL = 1_000_000_000n;
const DEX = Object.keys(KNOWN_DEX_PROGRAMS)[0]!;
const MINT = fakeMint("reserve-token");
const T = 1_700_000_000;
const DAY = 86_400;
const ISO = (t: number) => new Date(t * 1000).toISOString().replace(".000Z", "Z");
const RATES = { shortTermRateBps: 3000, longTermRateBps: 1500, stateRateBps: 0 };

let ctx: Ctx;
let rpc: FakeSolanaRpc;
afterEach(async () => { await ctx?.close(); ctx = undefined as never; });

interface U { userId: string; walletId: string; address: string; token: string }
async function user(seed: string): Promise<U> {
  const u = await ctx.pool.query("INSERT INTO users (display_name) VALUES ($1) RETURNING id", [seed]);
  const address = fakeBase58(`reservewallet:${seed}`, 44);
  const w = await ctx.pool.query("INSERT INTO wallets (user_id, chain, address, label, data_source, ownership_verified_at) VALUES ($1,'solana',$2,'Live','database', now()) RETURNING id", [u.rows[0].id, address]);
  const { token } = await createSession(ctx.pool, { userId: u.rows[0].id, walletId: w.rows[0].id, authMethod: "wallet_signature", ttlHours: 1 });
  return { userId: u.rows[0].id, walletId: w.rows[0].id, address, token };
}
class FixedPrices implements HistoricalPriceProvider {
  readonly name = "reserve-fixture";
  async loadSeries() {
    return (asset: string, at: number) => ({ asset, priceMicroUsd: asset === "native" ? 100_000_000n : 10_000_000n, observedAt: Math.min(at, T - 400 * DAY), source: "reserve-fixture", confidence: "FIXTURE" as const });
  }
}
const boot = async () => {
  rpc = new FakeSolanaRpc();
  ctx = await makeCtx({ INDEXER_MIN_SYNC_INTERVAL_SECONDS: "0", INDEXER_SYNC_ON_LOGIN: "false" }, undefined, { rpc, metadata: rpc, prices: new NullPriceProvider() }, new FixedPrices());
};
const sync = async (u: U) => { await ctx.app.inject({ method: "POST", url: `/api/wallets/${u.walletId}/sync`, headers: bearer(u.token) }); await ctx.app.indexer.drain(); };
const call = (u: { token: string }, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: object) => ctx.app.inject({ method, url, headers: bearer(u.token), ...(payload ? { payload } : {}) });
const reserve = async (u: U, body: object = { taxYear: 2024, rates: RATES }) => {
  const r = await call(u, "POST", `/api/tax-reserve/${u.walletId}/calculate`, body);
  expect(r.statusCode, r.body).toBe(200);
  return TaxReserveResponse.parse(r.json());
};
const setTarget = (u: { token: string; walletId: string }, body: object) => call(u, "POST", `/api/tax-reserve/${u.walletId}/target`, { confirmed: true, ...body });

const receipt = (addr: string, qty: bigint): TxSpec => ({
  signature: fakeSignature(`rsvrcpt-${addr}`), slot: 21, blockTime: T + 1, fee: 5000,
  accounts: [{ key: fakeBase58("payer", 44), pre: SOL, post: SOL - 5000n }, { key: fakeTokenAccount(`r-${addr}`), pre: 0, post: 0 }],
  tokens: [{ index: 1, mint: MINT, owner: addr, pre: 0n, post: qty, decimals: 6 }], programs: [TOKEN_PROGRAM],
});
const sell = (addr: string, qty: bigint, at: number): TxSpec => ({
  signature: fakeSignature(`rsvsell-${addr}`), slot: 61, blockTime: at, fee: 5000,
  accounts: [{ key: addr, pre: 2n * SOL, post: 3n * SOL - 5000n }, { key: fakeTokenAccount(`s-${addr}`), pre: 0, post: 0 }],
  tokens: [{ index: 1, mint: MINT, owner: addr, pre: qty, post: 0n, decimals: 6 }], programs: [DEX],
});
const solIn = (addr: string): TxSpec => ({
  signature: fakeSignature(`rsvin-${addr}`), slot: 11, blockTime: T + 1, fee: 5000,
  accounts: [{ key: fakeBase58("payer", 44), pre: 9n * SOL, post: 8n * SOL - 5000n }, { key: addr, pre: 0, post: 3n * SOL }], programs: [SYSTEM_PROGRAM],
});
/** a priced sale of 10 tokens in 2024 */
async function sale(seed: string, withBasis: boolean): Promise<U> {
  const u = await user(seed);
  rpc.addWallet(u.address, { lamports: SOL });
  rpc.addTx([u.address], receipt(u.address, 10_000_000n));
  rpc.addTx([u.address], sell(u.address, 10_000_000n, T + 60 * DAY));
  await sync(u);
  if (withBasis) {
    const m = await call(u, "POST", `/api/wallets/${u.walletId}/manual-basis`, { asset: MINT, decimals: 6, quantity: "10", acquiredAt: ISO(T - 100 * DAY), costBasis: "50.00", reason: "EXCHANGE_PURCHASE" });
    expect(m.statusCode, m.body).toBe(201);
  }
  return u;
}

describe("reserve recommendation follows the existing tax calculation status", () => {
  it("COMPLETE: the recommendation equals the estimated exposure, labeled as an estimate", async () => {
    await boot();
    const u = await sale("rs-complete", true);
    const r = await reserve(u);
    expect(r.taxEstimate).toMatchObject({ source: "TAX_ENGINE", status: "COMPLETE", estimatedExposureCents: "1500", ratesSupplied: true, incomplete: false, authoritative: false, verifiedOnChain: false });
    expect(r.recommendation).toMatchObject({ status: "ESTIMATE", label: "ESTIMATED RESERVE TARGET", recommendedCents: "1500", source: "SYSTEM_RECOMMENDATION", authoritative: false });
    expect(r.dataSource).toBe("chain");
    expect(r.verifiedOnChain).toBe(false);
  });
  it("DATA_REQUIRED: no recommendation, no exposure figure, and what is missing is listed", async () => {
    await boot();
    const u = await sale("rs-datareq", false); // no cost basis for the disposal
    const r = await reserve(u);
    expect(r.taxEstimate.status).toBe("DATA_REQUIRED");
    expect(r.taxEstimate.estimatedExposureCents).toBeNull();
    expect(r.recommendation).toMatchObject({ status: "WITHHELD", recommendedCents: null, label: "TAX DATA REQUIRED — NO RESERVE RECOMMENDATION" });
    expect(r.taxEstimate.missing.map((m) => m.kind)).toContain("COST_BASIS");
  });
  it("PARTIAL: shown only as an incomplete estimate", async () => {
    await boot();
    const u = await user("rs-partial");
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.addTx([u.address], solIn(u.address));
    await sync(u);
    const r = await reserve(u);
    expect(r.taxEstimate).toMatchObject({ status: "PARTIAL", incomplete: true });
    expect(r.recommendation).toMatchObject({ status: "ESTIMATE_INCOMPLETE", label: "ESTIMATED RESERVE — TAX DATA INCOMPLETE" });
    expect(r.taxEstimate.missing.length).toBeGreaterThan(0);
  });
  it("UNAVAILABLE (never synced): NO TAX RESERVE ESTIMATE AVAILABLE", async () => {
    await boot();
    const u = await user("rs-unavail");
    const r = await reserve(u);
    expect(r.taxEstimate.status).toBe("UNAVAILABLE");
    expect(r.recommendation).toMatchObject({ status: "UNAVAILABLE", recommendedCents: null, label: "NO TAX RESERVE ESTIMATE AVAILABLE" });
  });
  it("without tax rates there is no recommendation: no rate is ever assumed", async () => {
    await boot();
    const u = await sale("rs-norates", true);
    const r = await reserve(u, { taxYear: 2024 });
    expect(r.taxEstimate).toMatchObject({ ratesSupplied: false, estimatedExposureCents: null });
    expect(r.recommendation).toMatchObject({ status: "UNAVAILABLE", recommendedCents: null, label: "RATES REQUIRED FOR A RESERVE ESTIMATE" });
    const g = TaxReserveResponse.parse((await call(u, "GET", `/api/tax-reserve/${u.walletId}`)).json());
    expect(g.recommendation.recommendedCents).toBeNull();
  });
  it("the reserve layer never upgrades certainty: its numbers equal the tax API's for the same inputs", async () => {
    await boot();
    const u = await sale("rs-same", true);
    const t = TaxCalculateResponse.parse((await call(u, "POST", `/api/tax/${u.walletId}/calculate`, { taxYear: 2024, rates: RATES })).json()).tax;
    const r = await reserve(u);
    expect(r.taxEstimate.status).toBe(t.status);
    expect(r.taxEstimate.estimatedExposureCents).toBe(t.estimatedTaxExposureCents);
  });
  it("is deterministic and idempotent", async () => {
    await boot();
    const u = await sale("rs-det", true);
    const a = JSON.stringify(await reserve(u));
    expect(JSON.stringify(await reserve(u))).toBe(a);
  });
});

describe("a real wallet never gets a reserve balance, coverage or fixture numbers", () => {
  it("balance is UNAVAILABLE (not $0), coverage and remaining unavailable, no fixture data anywhere", async () => {
    await boot();
    const u = await sale("rs-nobal", true);
    expect((await setTarget(u, { targetType: "amount", targetAmount: "15.00" })).statusCode).toBe(200);
    const r = await reserve(u);
    expect(r.reserveBalance).toMatchObject({ source: "UNAVAILABLE", status: "NOT_CONNECTED", cents: null, label: "RESERVE BALANCE UNAVAILABLE" });
    expect(r.coverage).toMatchObject({ available: false, bps: null, label: "UNAVAILABLE" });
    expect(r.remaining).toMatchObject({ available: false, cents: null });
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/DEMO_FIXTURE|1420000|"cents":"0"/);
    expect(r.dataSource).toBe("chain");
  });
  it("a target equal to the recommendation does not become a balance or coverage", async () => {
    await boot();
    const u = await sale("rs-tgt-eq", true);
    await setTarget(u, { targetType: "amount", targetAmount: "15.00" }); // == recommended $15.00
    const r = await reserve(u);
    expect(r.userTarget.effectiveCents).toBe(r.recommendation.recommendedCents);
    expect(r.reserveBalance.cents).toBeNull();
    expect(r.coverage.available).toBe(false);
    expect(r.userTarget.isMoney).toBe(false);
  });
  it("the demo wallet is the only one with a balance, and it says DEMO", async () => {
    await boot();
    const r = TaxReserveResponse.parse((await call({ token: ctx.demoToken }, "GET", `/api/tax-reserve/${W.trading}`)).json());
    expect(r.reserveBalance).toMatchObject({ source: "DEMO_FIXTURE", label: "DEMO RESERVE BALANCE" });
    expect(r.dataSource).toBe("demo");
    expect(r.taxEstimate.source).toBe("DEMO_FIXTURE");
  });
});

describe("target configuration (persisted) vs derived values (never persisted)", () => {
  it("persists the target, appends a history row, and stores nothing derived", async () => {
    await boot();
    const u = await sale("rs-persist", true);
    const before = Number((await ctx.pool.query("SELECT count(*) FROM tax_reserve_target_events WHERE user_id = $1", [u.userId])).rows[0].count);
    const r = await setTarget(u, { targetType: "amount", targetAmount: "10000.00" });
    expect(r.statusCode).toBe(200);
    const body = TaxReserveResponse.parse(r.json());
    expect(body.userTarget).toMatchObject({ set: true, source: "USER_SET", enabled: true, targetType: "amount", targetAmountCents: "1000000", resolvedCents: "1000000", isMoney: false, label: "USER TARGET" });
    const row = (await ctx.pool.query("SELECT rule, percent_bps, target_cents, target_source, enabled FROM tax_reserves WHERE user_id = $1", [u.userId])).rows[0];
    expect(row).toEqual({ rule: "MANUAL_TARGET", percent_bps: null, target_cents: "1000000", target_source: "USER_SET", enabled: true });
    const ev = await ctx.pool.query("SELECT rule, target_cents, target_source, enabled, created_auth_method FROM tax_reserve_target_events WHERE user_id = $1 ORDER BY id", [u.userId]);
    expect(ev.rows).toHaveLength(before + 1);
    expect(ev.rows.at(-1)).toEqual({ rule: "MANUAL_TARGET", target_cents: "1000000", target_source: "USER_SET", enabled: true, created_auth_method: "wallet_signature" });
    // persisted across reads
    expect((await reserve(u)).userTarget.targetAmountCents).toBe("1000000");
    // no derived value has a column anywhere in the reserve tables
    const cols = (await ctx.pool.query("SELECT column_name FROM information_schema.columns WHERE table_name IN ('tax_reserves','tax_reserve_target_events')")).rows.map((x) => x.column_name as string);
    for (const c of cols) expect(c, c).not.toMatch(/exposure|recommend|coverage|remaining|balance|liabil/);
  });
  it("a target change appends history, and history is immutable", async () => {
    await boot();
    const u = await sale("rs-hist", true);
    await setTarget(u, { targetType: "amount", targetAmount: "5.00" });
    await setTarget(u, { targetType: "percentage", targetPercentage: "12.5" });
    const ev = (await ctx.pool.query("SELECT rule, percent_bps, target_cents FROM tax_reserve_target_events WHERE user_id = $1 ORDER BY id", [u.userId])).rows;
    expect(ev).toEqual([{ rule: "MANUAL_TARGET", percent_bps: null, target_cents: "500" }, { rule: "FIXED_PERCENT", percent_bps: 1250, target_cents: null }]);
    await expect(ctx.pool.query("UPDATE tax_reserve_target_events SET enabled = false WHERE user_id = $1", [u.userId])).rejects.toThrow();
    await expect(ctx.pool.query("DELETE FROM tax_reserve_target_events WHERE user_id = $1", [u.userId])).rejects.toThrow();
  });
  it("a disabled target is stored as disabled and yields no effective target or coverage", async () => {
    await boot();
    const u = await sale("rs-disabled", true);
    const r = TaxReserveResponse.parse((await setTarget(u, { targetType: "amount", targetAmount: "20.00", enabled: false })).json());
    expect(r.userTarget).toMatchObject({ enabled: false, resolvedCents: "2000", effectiveCents: null, label: "USER TARGET (DISABLED)" });
    expect(r.coverage.reason).toBe("Reserve balance is unavailable.");
    expect((await ctx.pool.query("SELECT enabled FROM tax_reserves WHERE user_id = $1", [u.userId])).rows[0].enabled).toBe(false);
  });
  it("the target source is always USER_SET from the API: a client cannot claim SYSTEM_RECOMMENDED", async () => {
    await boot();
    const u = await sale("rs-src", true);
    const r = await setTarget(u, { targetType: "amount", targetAmount: "1.00", source: "SYSTEM_RECOMMENDED" });
    expect(r.statusCode).toBe(400);
    expect((await ctx.pool.query("SELECT count(*) FROM tax_reserves WHERE user_id = $1", [u.userId])).rows[0].count).toBe("0");
  });
  it("an explicit confirmation is required to save", async () => {
    await boot();
    const u = await sale("rs-confirm", true);
    for (const body of [{ targetType: "amount", targetAmount: "1.00" }, { targetType: "amount", targetAmount: "1.00", confirmed: false }, { targetType: "amount", targetAmount: "1.00", confirmed: "yes" }]) {
      expect((await call(u, "POST", `/api/tax-reserve/${u.walletId}/target`, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await ctx.pool.query("SELECT count(*) FROM tax_reserves WHERE user_id = $1", [u.userId])).rows[0].count).toBe("0");
  });
  it("rejects malformed, negative, NaN, Infinity, exponent, oversized and unsupported-currency values without writing anything", async () => {
    await boot();
    const u = await sale("rs-bad", true);
    const bad = ["NaN", "Infinity", "-Infinity", "-5", "-0.01", "0", "0.00", "1e3", "1E10", "+5", "5.", ".5", "1.999", "1,000", " 5", "0x1F", "٣", "9999999999999", "abc", "", "5; DROP TABLE tax_reserves"];
    for (const a of bad) expect((await setTarget(u, { targetType: "amount", targetAmount: a })).statusCode, JSON.stringify(a)).toBe(400);
    for (const a of [5, null, true, [], {}]) expect((await setTarget(u, { targetType: "amount", targetAmount: a })).statusCode).toBe(400);
    for (const p of ["0", "-1", "100.01", "NaN", "Infinity", "1e2", "abc", "30.001"]) expect((await setTarget(u, { targetType: "percentage", targetPercentage: p })).statusCode, p).toBe(400);
    expect((await setTarget(u, { targetType: "amount", targetAmount: "5", currency: "ETH" })).statusCode).toBe(400);
    expect((await setTarget(u, { targetType: "amount", targetAmount: "5", currency: "usdc" })).statusCode).toBe(400);
    expect((await ctx.pool.query("SELECT (SELECT count(*) FROM tax_reserves WHERE user_id=$1) a, (SELECT count(*) FROM tax_reserve_target_events WHERE user_id=$1) b", [u.userId])).rows[0]).toEqual({ a: "0", b: "0" });
  });
  it("precision: the largest allowed amount round-trips exactly", async () => {
    await boot();
    const u = await sale("rs-big", true);
    const r = TaxReserveResponse.parse((await setTarget(u, { targetType: "amount", targetAmount: "999999999999.99" })).json());
    expect(r.userTarget.targetAmountCents).toBe("99999999999999");
    expect((await ctx.pool.query("SELECT target_cents FROM tax_reserves WHERE user_id = $1", [u.userId])).rows[0].target_cents).toBe("99999999999999");
  });
  it("database constraints refuse an inconsistent or unknown target", async () => {
    await boot();
    const u = await sale("rs-db", true);
    const ins = (rule: string, bps: number | null, cents: number | null, src = "USER_SET") =>
      ctx.pool.query("INSERT INTO tax_reserves (user_id, rule, percent_bps, target_cents, target_source) VALUES ($1,$2,$3,$4,$5)", [u.userId, rule, bps, cents, src]);
    await expect(ins("MANUAL_TARGET", null, 100, "GUESS")).rejects.toThrow(/target_source/);
    await expect(ins("MANUAL_TARGET", null, null)).rejects.toThrow(/tax_reserves_rule_fields/);
    await expect(ins("MANUAL_TARGET", null, -5)).rejects.toThrow();
    await ins("MANUAL_TARGET", null, 100, "SYSTEM_RECOMMENDED"); // the enum value exists for the future; the API cannot write it
  });
});

describe("authorization and exposure", () => {
  it("requires a session", async () => {
    await boot();
    const u = await sale("rs-401", true);
    for (const [m, url] of [["GET", `/api/tax-reserve/${u.walletId}`], ["POST", `/api/tax-reserve/${u.walletId}/calculate`], ["POST", `/api/tax-reserve/${u.walletId}/target`]] as const) {
      const r = await ctx.app.inject({ method: m, url, ...(m === "POST" ? { payload: { targetType: "amount", targetAmount: "1", confirmed: true } } : {}) });
      expect(r.statusCode, url).toBe(401);
    }
  });
  it("user B cannot read or change user A's reserve, and foreign and unknown wallets look the same", async () => {
    await boot();
    const a = await sale("rs-a", true);
    await setTarget(a, { targetType: "amount", targetAmount: "7.00" });
    const b = await user("rs-b");
    const foreign = await call(b, "GET", `/api/tax-reserve/${a.walletId}`);
    const unknown = await call(b, "GET", "/api/tax-reserve/00000000-0000-4000-8000-0000000fffff");
    expect([foreign.statusCode, unknown.statusCode]).toEqual([404, 404]);
    expect(foreign.json().error.code).toBe(unknown.json().error.code);
    expect(foreign.body).not.toContain("700");
    expect((await call(b, "POST", `/api/tax-reserve/${a.walletId}/calculate`, { taxYear: 2024, rates: RATES })).statusCode).toBe(404);
    const w = await setTarget(b, { targetType: "amount", targetAmount: "1.00" });
    expect(w.statusCode).toBe(200); // B sets B's own target through B's own wallet...
    const viaA = await call(b, "POST", `/api/tax-reserve/${a.walletId}/target`, { targetType: "amount", targetAmount: "9.99", confirmed: true });
    expect(viaA.statusCode).toBe(404); // ...but not through A's wallet id
    expect((await ctx.pool.query("SELECT target_cents FROM tax_reserves WHERE user_id = $1", [a.userId])).rows[0].target_cents).toBe("700");
    expect((await ctx.pool.query("SELECT target_cents FROM tax_reserves WHERE user_id = $1", [b.userId])).rows[0].target_cents).toBe("100");
    expect((await call(b, "GET", `/api/tax-reserve/${b.walletId}`)).json().userTarget.targetAmountCents).toBe("100");
  });
  it("a user with no target never sees another user's target (the stored configuration is user-scoped)", async () => {
    await boot();
    const a = await sale("rs-iso-a", true);
    await setTarget(a, { targetType: "amount", targetAmount: "123.00" });
    const c = await user("rs-iso-c"); // own wallet, never configured
    const r = TaxReserveResponse.parse((await call(c, "GET", `/api/tax-reserve/${c.walletId}`)).json());
    expect(r.userTarget).toMatchObject({ set: false, source: null, targetAmountCents: null, resolvedCents: null, label: "No reserve target set." });
    expect(JSON.stringify(r)).not.toContain("12300");
    expect(TaxReserveResponse.parse((await call(a, "GET", `/api/tax-reserve/${a.walletId}`)).json()).userTarget.targetAmountCents).toBe("12300");
  });
  it("the demo wallet is not readable or writable by another user", async () => {
    await boot();
    const o = await makeOtherUser(ctx.pool);
    expect((await call(o, "GET", `/api/tax-reserve/${W.trading}`)).statusCode).toBe(404);
    expect((await setTarget({ token: o.token, walletId: W.trading }, { targetType: "amount", targetAmount: "1.00" })).statusCode).toBe(404);
    expect((await ctx.pool.query("SELECT rule FROM tax_reserves WHERE user_id = $1", [DEMO_IDS.user])).rows[0].rule).toBe("FIXED_PERCENT");
  });
  it("tax rates are never accepted in a URL", async () => {
    await boot();
    const u = await sale("rs-url", true);
    for (const q of ["?shortTermRateBps=3000", "?rates=3000", "?longTermRateBps=1500&stateRateBps=0", "?rates[shortTermRateBps]=3000"]) {
      const r = await call(u, "GET", `/api/tax-reserve/${u.walletId}${q}`);
      expect(r.statusCode, q).toBe(400);
    }
    expect((await call(u, "GET", `/api/tax-reserve/${u.walletId}?taxYear=2024&method=FIFO`)).statusCode).toBe(200);
  });
  it("responses are not cacheable and carry no token, RPC URL or secret", async () => {
    await boot();
    const u = await sale("rs-hyg", true);
    for (const r of [await call(u, "GET", `/api/tax-reserve/${u.walletId}`), await call(u, "POST", `/api/tax-reserve/${u.walletId}/calculate`, { taxYear: 2024, rates: RATES }), await setTarget(u, { targetType: "amount", targetAmount: "1.00" })]) {
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.body).not.toContain(u.token);
      expect(r.body).not.toMatch(/https?:\/\/|rpc|secret|session|authorization/i);
    }
  });
});

describe("no money movement", () => {
  it("no route moves, deposits, withdraws, funds or escrows anything", async () => {
    await boot();
    const routes = ctx.app.printRoutes({ commonPrefix: false });
    expect(routes).toMatch(/tax-reserve/);
    expect(routes).not.toMatch(/deposit|withdraw|transfer|escrow|fund\b|\/fund|reserve-ledger|\/sign|\/send/i);
    const u = await sale("rs-routes", true);
    for (const p of ["deposit", "withdraw", "transfer", "fund", "escrow", "sign", "send", "balance"]) {
      for (const base of [`/api/tax-reserve/${u.walletId}`, "/api/tax-reserve"]) {
        for (const m of ["POST", "PUT", "PATCH", "DELETE"] as const) expect((await call(u, m, `${base}/${p}`, {})).statusCode, `${m} ${base}/${p}`).toBe(404);
      }
    }
  });
  it("the reserve ledger table cannot be written, and no reserve write creates a transaction or a donation", async () => {
    await boot();
    const u = await sale("rs-ledger", true);
    const count = async () => (await ctx.pool.query("SELECT (SELECT count(*) FROM raw_transactions) raw, (SELECT count(*) FROM tax_reserve_transactions) trt, (SELECT count(*) FROM donations) don, (SELECT count(*) FROM transactions) tx")).rows[0];
    const before = await count();
    await setTarget(u, { targetType: "amount", targetAmount: "50.00" });
    await reserve(u);
    expect(await count()).toEqual(before);
    const raw = (await ctx.pool.query("SELECT id FROM raw_transactions LIMIT 1")).rows[0].id;
    await expect(ctx.pool.query("INSERT INTO tax_reserve_transactions (tax_reserve_id, raw_transaction_id, direction, amount_cents) SELECT id, $2, 'deposit', 100 FROM tax_reserves WHERE user_id = $1", [u.userId, raw])).rejects.toThrow(/reserve funding is not enabled/);
    expect((await ctx.pool.query("SELECT count(*) FROM tax_reserve_transactions")).rows[0].count).toBe("0");
  });
  it("responses contain no signature or transaction fields", async () => {
    await boot();
    const u = await sale("rs-nosig", true);
    const text = JSON.stringify(await reserve(u));
    expect(text).not.toMatch(/signature|txid|transactionId|"verifiedOnChain":true|"authoritative":true/i);
  });
});

describe("tax language", () => {
  it("no reserve response contains a banned phrase, and nothing is called final, guaranteed or your liability", async () => {
    await boot();
    const scenarios = [await sale("rs-lang-1", true), await sale("rs-lang-2", false)];
    const bodies: string[] = [];
    for (const u of scenarios) bodies.push(JSON.stringify(await reserve(u)));
    bodies.push(JSON.stringify(await reserve(await user("rs-lang-3"))));
    bodies.push((await call({ token: ctx.demoToken }, "GET", `/api/tax-reserve/${W.trading}`)).body);
    for (const b of bodies.map((x) => x.toLowerCase())) {
      for (const p of BANNED_PHRASES) expect(b, p).not.toContain(p);
      expect(b).not.toMatch(/your tax liability|you owe|final tax|\bguarantee/);
      expect(b).toContain("not tax advice");
    }
  });
});
