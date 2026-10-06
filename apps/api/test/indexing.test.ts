import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PortfolioResponse, StartSyncResponse, SyncStatusResponse, TransactionsResponse,
  fakeBase58, fakeMint, fakeProgram, fakeSignature, fakeTokenAccount, type TokenAccountObservation, type TxSpec,
  TOKEN_PROGRAM, SYSTEM_PROGRAM, KNOWN_DEX_PROGRAMS,
} from "@project-name/shared";
import { createSession } from "../src/auth/session";
import { IndexerService } from "../src/indexer/service";
import { FakePriceProvider, NullPriceProvider } from "../src/prices/provider";
import { FakeSolanaRpc } from "../src/solana/fake";
import { SolanaRpcError } from "../src/solana/types";
import { bearer, makeCtx, makeSigner, signIn, testConfig, W, type Ctx } from "./helpers";

const SOL = 1_000_000_000n;
const MINT_A = fakeMint("a");
const MINT_B = fakeMint("b");

interface Live { userId: string; walletId: string; address: string; token: string }
async function liveUser(ctx: Ctx, seed: string): Promise<Live> {
  const address = fakeBase58(`wallet:${seed}`, 44);
  const u = await ctx.pool.query("INSERT INTO users (display_name) VALUES ($1) RETURNING id", [seed]);
  const w = await ctx.pool.query("INSERT INTO wallets (user_id, chain, address, label, data_source, ownership_verified_at) VALUES ($1,'solana',$2,'Live','database', now()) RETURNING id", [u.rows[0].id, address]);
  const { token } = await createSession(ctx.pool, { userId: u.rows[0].id as string, walletId: w.rows[0].id as string, authMethod: "wallet_signature", ttlHours: 1 });
  return { userId: u.rows[0].id as string, walletId: w.rows[0].id as string, address, token };
}
const tokenAcct = (owner: string, mint: string, amount: bigint, decimals = 6, seed = mint): TokenAccountObservation => ({ tokenAccount: fakeTokenAccount(`${owner}:${seed}`), mint, owner, amount, decimals, programId: TOKEN_PROGRAM });

/** SOL transfer into `addr` of `lamports`, signed by someone else (so the wallet did not pay the fee). */
const solIn = (addr: string, n: number, lamports: bigint, slot = 100 + n): TxSpec => {
  const other = fakeBase58(`payer:${n}`, 44);
  return { signature: fakeSignature(`in${n}`), slot, blockTime: 1_700_000_000 + n, fee: 5000, accounts: [{ key: other, pre: 10n * SOL, post: 10n * SOL - lamports - 5000n }, { key: addr, pre: SOL, post: SOL + lamports }], programs: [SYSTEM_PROGRAM] };
};

let ctx: Ctx;
let rpc: FakeSolanaRpc;
let prices: FakePriceProvider;
const boot = async (over: Record<string, string> = {}, p: FakePriceProvider | null = null) => {
  rpc = new FakeSolanaRpc();
  prices = p ?? new FakePriceProvider();
  ctx = await makeCtx({ INDEXER_MIN_SYNC_INTERVAL_SECONDS: "0", INDEXER_SYNC_ON_LOGIN: "false", ...over }, undefined, { rpc, metadata: rpc, prices: p ? prices : new NullPriceProvider() });
  // prices are global (one SOL asset): isolate the latest-price logic per test
  await ctx.pool.query("DELETE FROM price_observations");
};
afterEach(async () => { await ctx?.close(); });

const syncNow = async (u: Live, id = u.walletId) => {
  const r = await ctx.app.inject({ method: "POST", url: `/api/wallets/${id}/sync`, headers: bearer(u.token) });
  await ctx.app.indexer.drain();
  return r;
};
const get = (u: Live, url: string) => ctx.app.inject({ method: "GET", url, headers: bearer(u.token) });
const status = async (u: Live) => SyncStatusResponse.parse((await get(u, `/api/wallets/${u.walletId}/sync`)).json());
const counts = async (table: string, where = "TRUE") => Number((await ctx.pool.query(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)).rows[0].n);

describe("before any sync", () => {
  beforeEach(() => boot());
  it("real wallet: 404 NO_LIVE_DATA everywhere, never demo rows", async () => {
    const u = await liveUser(ctx, "fresh");
    for (const url of [`/api/portfolio/${u.walletId}`, `/api/transactions/${u.walletId}`, `/api/tax/${u.walletId}`, `/api/tax-reserve/${u.walletId}`]) {
      const r = await get(u, url);
      expect(r.statusCode, url).toBe(404);
      expect(r.json().error.code).toBe("NO_LIVE_DATA");
    }
    const s = await status(u);
    expect(s).toMatchObject({ state: "never_synced", configured: true, lastRun: null, window: null });
  });
  it("demo wallets still serve labeled demo data and refuse sync", async () => {
    const demo = { userId: "", walletId: W.trading, address: "", token: ctx.demoToken };
    expect(PortfolioResponse.parse((await get(demo, `/api/portfolio/${W.trading}`)).json()).dataSource).toBe("demo");
    const r = await ctx.app.inject({ method: "POST", url: `/api/wallets/${W.trading}/sync`, headers: bearer(ctx.demoToken) });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("SYNC_UNSUPPORTED");
    expect((await status(demo)).state).toBe("unsupported_demo_wallet");
  });
});

describe("balances and portfolio", () => {
  beforeEach(() => boot());
  it("indexes SOL and SPL balances; no fabricated symbols; price and value unavailable (never zero)", async () => {
    const u = await liveUser(ctx, "bal");
    rpc.addWallet(u.address, { lamports: 5n * SOL + 1n, tokens: [tokenAcct(u.address, MINT_A, 1_234_567n), tokenAcct(u.address, MINT_B, 0n)] });
    const r = await syncNow(u);
    expect(r.statusCode).toBe(202);
    StartSyncResponse.parse(r.json());
    const p = PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json());
    expect(p.dataSource).toBe("chain");
    expect(p.verifiedOnChain).toBe(false);
    expect(p.source.kind).toBe("solana_rpc");
    expect(p.assets.map((a) => a.mint)).toEqual([null, MINT_A]); // zero-balance MINT_B hidden
    const [sol, tok] = p.assets;
    expect(sol).toMatchObject({ kind: "native", symbol: "SOL", balance: (5n * SOL + 1n).toString(), quantity: "5.000000001", valuation: "price_unavailable", priceMicroUsd: null, valueCents: null });
    expect(tok).toMatchObject({ kind: "spl", symbol: null, name: null, mint: MINT_A, balance: "1234567", quantity: "1.234567", valuation: "price_unavailable", valueCents: null });
    expect(tok!.metadata).toMatchObject({ status: "unavailable", name: null, symbol: null, verified: false });
    expect(p.totalValueCents).toBeNull();
    expect(p.partialValueCents).toBeNull();
    expect(p.valuation).toEqual({ status: "unavailable", pricedAssets: 0, unpricedAssets: 2 });
    expect(JSON.stringify(p)).not.toMatch(/DEMO|HRBR|BONK/);
  });
  it("handles lamport balances above 2^53 exactly", async () => {
    const u = await liveUser(ctx, "big");
    const big = 10_000_000n * SOL + 1n;
    rpc.addWallet(u.address, { lamports: big });
    await syncNow(u);
    const p = PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json());
    expect(p.assets[0]!.balance).toBe(big.toString());
    expect(p.assets[0]!.quantity).toBe("10000000.000000001");
  });
  it("empty wallet: synced, LIVE, zero assets (distinct from never synced)", async () => {
    const u = await liveUser(ctx, "empty");
    rpc.addWallet(u.address, { lamports: 0n });
    await syncNow(u);
    const p = PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json());
    expect(p.assets).toEqual([]);
    expect(p.dataSource).toBe("chain");
    expect(PortfolioResponse.shape.totalValueCents.parse(p.totalValueCents)).toBe("0");
    expect((await status(u)).state).toBe("synced");
  });
  it("token metadata is untrusted: stored as text, never verified, tokens without it show unavailable", async () => {
    const u = await liveUser(ctx, "meta");
    const MINT_A = fakeMint("meta-a"), MINT_B = fakeMint("meta-b");
    rpc.addWallet(u.address, { lamports: SOL, tokens: [tokenAcct(u.address, MINT_A, 5n), tokenAcct(u.address, MINT_B, 7n)] });
    rpc.metadata.set(MINT_A, { name: "<script>alert(1)</script>", symbol: "USDC", uri: "https://example.com/m.json", source: "metaplex_onchain" });
    await syncNow(u);
    const p = PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json());
    const a = p.assets.find((x) => x.mint === MINT_A)!;
    expect(a.symbol).toBeNull(); // a token calling itself USDC is not promoted to a symbol
    expect(a.metadata).toMatchObject({ status: "resolved", symbol: "USDC", name: "<script>alert(1)</script>", verified: false });
    expect(p.assets.find((x) => x.mint === MINT_B)!.metadata.status).toBe("unavailable");
  });
  it("metadata failure does not fail the sync", async () => {
    const u = await liveUser(ctx, "metafail");
    const MINT_A = fakeMint("metafail-a");
    rpc.addWallet(u.address, { lamports: SOL, tokens: [tokenAcct(u.address, MINT_A, 5n)] });
    rpc.metadata.set(MINT_A, "error");
    await syncNow(u);
    expect(PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json()).assets).toHaveLength(2);
  });
  it("rejects inconsistent decimals for one mint without corrupting data", async () => {
    const u = await liveUser(ctx, "dec");
    rpc.addWallet(u.address, { lamports: SOL, tokens: [tokenAcct(u.address, MINT_A, 5n, 6, "x"), tokenAcct(u.address, MINT_A, 5n, 9, "y")] });
    await syncNow(u);
    const s = await status(u);
    expect(s.lastRun?.status).toBe("partial");
    const p = PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json());
    expect(p.assets.find((x) => x.mint === MINT_A)).toMatchObject({ decimals: 6, balance: "5" });
  });
  it("token-account limit hit: holdings flagged incomplete and NO total is claimed even if everything shown is priced", async () => {
    await boot({ SOLANA_CLUSTER: "mainnet", INDEXER_MAX_TOKEN_ACCOUNTS: "1" }, new FakePriceProvider({ native: 100_000_000n }));
    const u = await liveUser(ctx, "limit");
    rpc.addWallet(u.address, { lamports: SOL, tokens: [tokenAcct(u.address, fakeMint("lim-a"), 5n), tokenAcct(u.address, fakeMint("lim-b"), 5n)] });
    await syncNow(u);
    const p = PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json());
    expect(p.source.holdingsComplete).toBe(false);
    expect(p.totalValueCents).toBeNull();
    expect(p.assets).toHaveLength(2); // SOL + 1 of 2 tokens
    expect((await status(u)).lastRun).toMatchObject({ status: "partial", error: { code: "TOKEN_ACCOUNT_LIMIT" } });
    // a later complete sync clears the flag
    rpc.setTokens(u.address, []);
    await syncNow(u);
    const q = PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json());
    expect(q.source.holdingsComplete).toBe(true);
    expect(q.totalValueCents).not.toBeNull();
  });
  it("holdings that disappear are removed on the next sync; observations are kept", async () => {
    const u = await liveUser(ctx, "gone");
    rpc.addWallet(u.address, { lamports: SOL, tokens: [tokenAcct(u.address, MINT_A, 5n)] });
    await syncNow(u);
    rpc.setTokens(u.address, []);
    rpc.slot = 2_000n;
    await syncNow(u);
    expect(PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json()).assets.map((a) => a.mint)).toEqual([null]);
    expect(await counts("balance_observations", `wallet_id = '${u.walletId}'`)).toBe(3);
  });
});

describe("prices", () => {
  it("devnet: no price is requested even if a provider exists", async () => {
    await boot({}, new FakePriceProvider({ native: 150_000_000n }));
    const u = await liveUser(ctx, "dev");
    rpc.addWallet(u.address, { lamports: SOL });
    await syncNow(u);
    expect(PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json()).assets[0]!.valuation).toBe("price_unavailable");
  });
  it("mainnet SOL priced: value from integer math; partial sum labeled while a token is unpriced", async () => {
    await boot({ SOLANA_CLUSTER: "mainnet" }, new FakePriceProvider({ native: 150_000_000n }));
    const u = await liveUser(ctx, "main");
    rpc.addWallet(u.address, { lamports: 2n * SOL, tokens: [tokenAcct(u.address, MINT_A, 9n)] });
    await syncNow(u);
    const p = PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json());
    expect(p.assets[0]).toMatchObject({ valuation: "priced", priceMicroUsd: "150000000", valueCents: "30000", price: { source: "fake" } });
    expect(p.assets[1]).toMatchObject({ valuation: "price_unavailable", valueCents: null });
    expect(p.totalValueCents).toBeNull(); // a partial sum is never the total
    expect(p.partialValueCents).toBe("30000");
    expect(p.valuation).toMatchObject({ status: "partial", pricedAssets: 1, unpricedAssets: 1 });
  });
  it("all assets priced: total and allocation; old price is stale, not hidden", async () => {
    await boot({ SOLANA_CLUSTER: "mainnet", PRICE_MAX_AGE_SECONDS: "60" }, new FakePriceProvider({ native: 100_000_000n }, () => new Date(Date.now() - 3_600_000)));
    const u = await liveUser(ctx, "stale");
    rpc.addWallet(u.address, { lamports: SOL });
    await syncNow(u);
    const p = PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json());
    expect(p.assets[0]).toMatchObject({ valuation: "stale_price", valueCents: "10000", allocationBps: 10000 });
    expect(p.totalValueCents).toBe("10000");
    expect(p.valuation.status).toBe("stale");
  });
});

describe("transactions", () => {
  beforeEach(() => boot());
  it("indexes and classifies conservatively; raw is preserved and immutable; every record is traceable", async () => {
    const u = await liveUser(ctx, "tx");
    const dex = Object.keys(KNOWN_DEX_PROGRAMS)[0]!;
    const sigFail = fakeSignature("fail");
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.addTx([u.address], solIn(u.address, 1, 2n * SOL));
    rpc.addTx([u.address], { signature: sigFail, slot: 120, blockTime: 1_700_000_120, fee: 5000, err: { InstructionError: [0, "Custom"] }, accounts: [{ key: u.address, pre: SOL, post: SOL - 5000n }], programs: [SYSTEM_PROGRAM] });
    rpc.addTx([u.address], { signature: fakeSignature("tok"), slot: 130, blockTime: 1_700_000_130, fee: 5000, accounts: [{ key: fakeBase58("p", 44), pre: SOL, post: SOL - 5000n }, { key: fakeTokenAccount("t"), pre: 0, post: 0 }], tokens: [{ index: 1, mint: MINT_A, owner: u.address, pre: 0n, post: 50n, decimals: 6 }], programs: [TOKEN_PROGRAM] });
    rpc.addTx([u.address], { signature: fakeSignature("unk"), slot: 140, blockTime: 1_700_000_140, fee: 5000, accounts: [{ key: u.address, pre: SOL, post: SOL - 5000n - 77n }], programs: [fakeProgram("mystery")] });
    rpc.addTx([u.address], { signature: fakeSignature("swap"), slot: 150, blockTime: null, fee: 5000, accounts: [{ key: u.address, pre: 3n * SOL, post: 2n * SOL - 5000n }, { key: fakeTokenAccount("s"), pre: 0, post: 0 }], tokens: [{ index: 1, mint: MINT_B, owner: u.address, pre: 0n, post: 900n, decimals: 6 }], programs: [dex] });
    await syncNow(u);
    const t = TransactionsResponse.parse((await get(u, `/api/transactions/${u.walletId}`)).json());
    expect(t.dataSource).toBe("chain");
    expect(t.window).toMatchObject({ newestSlot: 150, oldestSlot: 101, historyComplete: true, hasGap: false, indexedCount: 5 });
    const by = (n: string) => t.transactions.find((x) => x.signature === fakeSignature(n))!;
    expect(by("in1")).toMatchObject({ type: "transfer", amount: (2n * SOL).toString(), status: "success", source: "chain", taxTreatment: "not_assessed", usdValueCents: null, slot: 101 });
    expect(by("in1").feeLamports).toBe("0"); // the wallet did not pay it
    expect(by("fail")).toMatchObject({ type: "fee", status: "failed", feeLamports: "5000" });
    expect(by("tok")).toMatchObject({ type: "token_receipt", asset: MINT_A, amount: "50" });
    expect(by("unk")).toMatchObject({ type: "unknown", feeLamports: "5000" });
    expect(by("unk").classification!.reason.length).toBeGreaterThan(10);
    expect(by("swap")).toMatchObject({ type: "swap", timestamp: null });
    expect(by("in1").explorerUrl).toBe(`https://explorer.solana.com/tx/${fakeSignature("in1")}?cluster=devnet`);
    expect(new Set(t.transactions.map((x) => x.id)).size).toBe(5);
    expect(JSON.stringify(t)).not.toMatch(/DEMO-SIG/);
    // raw payload is the original RPC JSON and cannot be mutated
    const raw = await ctx.pool.query("SELECT payload FROM raw_transactions WHERE signature = $1", [fakeSignature("in1")]);
    expect(raw.rows[0].payload.transaction.signatures[0]).toBe(fakeSignature("in1"));
    await expect(ctx.pool.query("UPDATE raw_transactions SET slot = 1 WHERE signature = $1", [fakeSignature("in1")])).rejects.toThrow();
    await expect(ctx.pool.query("DELETE FROM raw_transactions WHERE signature = $1", [fakeSignature("in1")])).rejects.toThrow();
  });
  it("paginates newest first", async () => {
    const u = await liveUser(ctx, "page");
    rpc.addWallet(u.address, { lamports: SOL });
    for (let i = 1; i <= 5; i++) rpc.addTx([u.address], solIn(u.address, i, SOL));
    await syncNow(u);
    const a = TransactionsResponse.parse((await get(u, `/api/transactions/${u.walletId}?limit=2&offset=0`)).json());
    const b = TransactionsResponse.parse((await get(u, `/api/transactions/${u.walletId}?limit=2&offset=4`)).json());
    expect(a.transactions.map((x) => x.slot)).toEqual([105, 104]);
    expect(a.pagination).toMatchObject({ total: 5, nextOffset: 2 });
    expect(b.transactions.map((x) => x.slot)).toEqual([101]);
    expect(b.pagination.nextOffset).toBeNull();
  });
  it("a transaction shared by two wallets is stored once raw and once per wallet", async () => {
    const u1 = await liveUser(ctx, "s1");
    const u2 = await liveUser(ctx, "s2");
    rpc.addWallet(u1.address, { lamports: SOL }).addWallet(u2.address, { lamports: SOL });
    const spec = solIn(u2.address, 1, SOL);
    spec.accounts.push({ key: u1.address, pre: SOL, post: SOL });
    rpc.addTx([u1.address, u2.address], spec);
    await syncNow(u1);
    await syncNow(u2);
    expect(await counts("raw_transactions", `signature = '${spec.signature}'`)).toBe(1);
    expect(await counts("transactions", `wallet_id IN ('${u1.walletId}','${u2.walletId}')`)).toBe(2);
  });
});

describe("idempotency, incremental sync, bounds", () => {
  it("repeat sync changes nothing and refetches no known transaction", async () => {
    await boot();
    const u = await liveUser(ctx, "idem");
    rpc.addWallet(u.address, { lamports: SOL, tokens: [tokenAcct(u.address, MINT_A, 5n)] });
    for (let i = 1; i <= 4; i++) rpc.addTx([u.address], solIn(u.address, i, SOL));
    await syncNow(u);
    const before = { raw: await counts("raw_transactions"), tx: await counts("transactions"), d: await counts("transaction_asset_deltas"), a: await counts("assets"), h: await counts("token_holdings", `wallet_id = '${u.walletId}'`), bo: await counts("balance_observations") };
    const fetches = rpc.count("getTransaction");
    await syncNow(u);
    await syncNow(u);
    expect(rpc.count("getTransaction")).toBe(fetches);
    expect({ raw: await counts("raw_transactions"), tx: await counts("transactions"), d: await counts("transaction_asset_deltas"), a: await counts("assets"), h: await counts("token_holdings", `wallet_id = '${u.walletId}'`), bo: await counts("balance_observations") }).toEqual(before);
    expect((await status(u)).lastRun).toMatchObject({ status: "succeeded", counts: { transactionsStored: 0 } });
  });
  it("later syncs fetch only transactions newer than the anchor", async () => {
    await boot();
    const u = await liveUser(ctx, "incr");
    rpc.addWallet(u.address, { lamports: SOL });
    for (let i = 1; i <= 3; i++) rpc.addTx([u.address], solIn(u.address, i, SOL));
    await syncNow(u);
    rpc.addTx([u.address], solIn(u.address, 4, SOL));
    rpc.slot = 5000n;
    const before = rpc.count("getTransaction");
    await syncNow(u);
    expect(rpc.count("getTransaction") - before).toBe(1);
    expect((await status(u)).window).toMatchObject({ indexedCount: 4, newestSlot: 104, hasGap: false });
  });
  it("initial sync is bounded by INDEXER_INITIAL_TRANSACTION_LIMIT and is not history-complete", async () => {
    await boot({ INDEXER_INITIAL_TRANSACTION_LIMIT: "3" });
    const u = await liveUser(ctx, "bound");
    rpc.addWallet(u.address, { lamports: SOL });
    for (let i = 1; i <= 10; i++) rpc.addTx([u.address], solIn(u.address, i, SOL));
    await syncNow(u);
    const s = await status(u);
    expect(s.window).toMatchObject({ indexedCount: 3, newestSlot: 110, oldestSlot: 108, historyComplete: false });
    expect(rpc.count("getTransaction")).toBe(3);
  });
  it("a burst larger than INDEXER_MAX_TRANSACTIONS_PER_SYNC is flagged as a possible gap", async () => {
    await boot({ INDEXER_MAX_TRANSACTIONS_PER_SYNC: "2" });
    const u = await liveUser(ctx, "gap");
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.addTx([u.address], solIn(u.address, 1, SOL));
    await syncNow(u);
    for (let i = 2; i <= 6; i++) rpc.addTx([u.address], solIn(u.address, i, SOL));
    await syncNow(u);
    const s = await status(u);
    expect(s.window).toMatchObject({ indexedCount: 3, hasGap: true });
    expect(s.lastRun).toMatchObject({ status: "partial", error: { code: "SYNC_WINDOW_FULL" } });
  });
  it("the RPC call budget stops a sync (no unbounded loops)", async () => {
    await boot({ INDEXER_MAX_RPC_CALLS_PER_SYNC: "10", INDEXER_INITIAL_TRANSACTION_LIMIT: "30" });
    const u = await liveUser(ctx, "budget");
    rpc.addWallet(u.address, { lamports: SOL });
    for (let i = 1; i <= 30; i++) rpc.addTx([u.address], solIn(u.address, i, SOL));
    await syncNow(u);
    expect(rpc.calls.length).toBeLessThanOrEqual(10);
    const s = await status(u);
    expect(s.lastRun?.status).toBe("partial");
    expect(s.lastRun?.error?.code).toBe("RPC_BUDGET_EXCEEDED");
    // restartable: the next run completes the rest without refetching what is stored
    const stored = await counts("transactions", `wallet_id = '${u.walletId}'`);
    expect(stored).toBeGreaterThan(0);
    rpc.calls.length = 0;
    await syncNow(u);
    expect(await counts("transactions", `wallet_id = '${u.walletId}'`)).toBeGreaterThan(stored);
  });
  it("a malformed transaction is skipped, others are stored, and a later sync repairs it", async () => {
    await boot();
    const u = await liveUser(ctx, "mal");
    rpc.addWallet(u.address, { lamports: SOL });
    for (let i = 1; i <= 3; i++) rpc.addTx([u.address], solIn(u.address, i, SOL));
    rpc.overrideTx(fakeSignature("in2"), { garbage: true });
    await syncNow(u);
    let s = await status(u);
    expect(s.lastRun).toMatchObject({ status: "partial", error: { code: "RPC_MALFORMED" } });
    expect(s.window?.indexedCount).toBe(2);
    rpc.addTx([u.address], solIn(u.address, 2, SOL)); // node is fixed (re-adding replaces the payload; the list gets a duplicate we must tolerate)
    await syncNow(u);
    s = await status(u);
    expect(await counts("transactions", `wallet_id = '${u.walletId}'`)).toBe(3);
    expect(s.lastRun?.status).toBe("succeeded");
  });
  it("a transaction the node cannot return is reported, not invented", async () => {
    await boot();
    const u = await liveUser(ctx, "miss");
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.addTx([u.address], solIn(u.address, 1, SOL));
    rpc.addTx([u.address], solIn(u.address, 2, SOL));
    rpc.removeTx(fakeSignature("in1"));
    await syncNow(u);
    expect(await counts("transactions", `wallet_id = '${u.walletId}'`)).toBe(1);
    expect((await status(u)).lastRun).toMatchObject({ status: "partial", error: { code: "TX_UNAVAILABLE" } });
  });
});

describe("RPC failures", () => {
  beforeEach(() => boot());
  it("balance timeout: failed run with a safe message; no live data appears", async () => {
    const u = await liveUser(ctx, "to");
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.fail("getBalance", new SolanaRpcError("timeout", "RPC request timed out", true));
    await syncNow(u);
    const s = await status(u);
    expect(s.state).toBe("failed");
    expect(s.lastRun).toMatchObject({ status: "failed", error: { code: "RPC_TIMEOUT" } });
    expect((await get(u, `/api/portfolio/${u.walletId}`)).statusCode).toBe(404);
    // and the wallet can be retried
    await syncNow(u);
    expect((await status(u)).state).toBe("synced");
  });
  it("transient failure while fetching transactions stops early instead of hammering the node", async () => {
    const u = await liveUser(ctx, "down");
    rpc.addWallet(u.address, { lamports: SOL });
    for (let i = 1; i <= 5; i++) rpc.addTx([u.address], solIn(u.address, i, SOL));
    rpc.fail("getTransaction", new SolanaRpcError("network", "Could not reach the RPC node", true), 100);
    await syncNow(u);
    expect(rpc.count("getTransaction")).toBe(1);
    expect((await status(u)).lastRun?.status).toBe("partial");
  });
  it("an unexpected internal error is stored generically", async () => {
    const u = await liveUser(ctx, "boom");
    rpc.addWallet(u.address, {});
    rpc.fail("getBalance", new Error("db password=hunter2") as unknown as SolanaRpcError);
    await syncNow(u);
    const run = (await status(u)).lastRun!;
    expect(run.error).toEqual({ code: "INTERNAL_ERROR", message: "Unexpected indexing error" });
  });
});

describe("authorization, limits, concurrency", () => {
  it("another user's wallet is 404 for status and sync; no run is created", async () => {
    await boot();
    const owner = await liveUser(ctx, "own");
    const intruder = await liveUser(ctx, "intr");
    for (const method of ["GET", "POST"] as const) {
      const r = await ctx.app.inject({ method, url: `/api/wallets/${owner.walletId}/sync`, headers: bearer(intruder.token) });
      expect(r.statusCode).toBe(404);
    }
    expect(await counts("wallet_sync_runs", `wallet_id = '${owner.walletId}'`)).toBe(0);
  });
  it("requires a session; validates the id", async () => {
    await boot();
    const u = await liveUser(ctx, "auth");
    expect((await ctx.app.inject({ method: "POST", url: `/api/wallets/${u.walletId}/sync` })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "GET", url: `/api/wallets/${u.walletId}/sync` })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "POST", url: "/api/wallets/not-a-uuid/sync", headers: bearer(u.token) })).statusCode).toBe(400);
  });
  it("cross-origin cookie POST is refused (CSRF guard also covers sync)", async () => {
    await boot();
    const u = await liveUser(ctx, "csrf");
    const r = await ctx.app.inject({ method: "POST", url: `/api/wallets/${u.walletId}/sync`, headers: { origin: "https://evil.example" }, cookies: { pn_session: u.token } });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(await counts("wallet_sync_runs", `wallet_id = '${u.walletId}'`)).toBe(0);
  });
  it("per-wallet cooldown returns 429 with Retry-After", async () => {
    await boot({ INDEXER_MIN_SYNC_INTERVAL_SECONDS: "60" });
    const u = await liveUser(ctx, "cool");
    rpc.addWallet(u.address, { lamports: SOL });
    expect((await syncNow(u)).statusCode).toBe(202);
    const r = await syncNow(u);
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe("SYNC_COOLDOWN");
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect((await status(u)).nextAllowedAt).not.toBeNull();
  });
  it("per-IP rate limit on the sync endpoint", async () => {
    await boot({ INDEXER_SYNC_RATE_LIMIT_MAX: "2" });
    const u = await liveUser(ctx, "rl");
    rpc.addWallet(u.address, {});
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await syncNow(u)).statusCode);
    expect(codes.slice(0, 2)).toEqual([202, 202]);
    expect(codes.slice(2)).toEqual([429, 429]);
  });
  it("a second start while one is running does not start another run", async () => {
    await boot();
    const u = await liveUser(ctx, "conc");
    rpc.addWallet(u.address, { lamports: SOL });
    let open!: () => void;
    rpc.gate = new Promise<void>((r) => { open = r; });
    const a = await ctx.app.inject({ method: "POST", url: `/api/wallets/${u.walletId}/sync`, headers: bearer(u.token) });
    const b = await ctx.app.inject({ method: "POST", url: `/api/wallets/${u.walletId}/sync`, headers: bearer(u.token) });
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(200);
    expect(StartSyncResponse.parse(b.json()).alreadyRunning).toBe(true);
    expect((await status(u)).state).toBe("syncing");
    open();
    await ctx.app.indexer.drain();
    expect(await counts("wallet_sync_runs", `wallet_id = '${u.walletId}'`)).toBe(1);
  });
  it("the database refuses two running syncs for one wallet", async () => {
    await boot();
    const u = await liveUser(ctx, "uniq");
    await ctx.pool.query("INSERT INTO wallet_sync_runs (wallet_id, trigger, status, limits) VALUES ($1,'manual','running','{}')", [u.walletId]);
    await expect(ctx.pool.query("INSERT INTO wallet_sync_runs (wallet_id, trigger, status, limits) VALUES ($1,'manual','running','{}')", [u.walletId])).rejects.toThrow();
  });
  it("startup closes orphaned running syncs", async () => {
    await boot();
    const u = await liveUser(ctx, "orph");
    await ctx.pool.query("INSERT INTO wallet_sync_runs (wallet_id, trigger, status, limits, started_at) VALUES ($1,'manual','running','{}', now() - interval '1 hour')", [u.walletId]);
    await new IndexerService(ctx.pool, testConfig(), { rpc, metadata: rpc, prices: new NullPriceProvider() }).sweepStale();
    expect((await status(u)).lastRun).toMatchObject({ status: "failed", error: { code: "SYNC_INTERRUPTED" } });
  });
  it("no RPC configured: status says so, sync is 503, nothing demo is substituted", async () => {
    rpc = new FakeSolanaRpc();
    ctx = await makeCtx({ INDEXER_SYNC_ON_LOGIN: "false" }, undefined, { rpc: null, metadata: null, prices: new NullPriceProvider() });
    const u = await liveUser(ctx, "norpc");
    expect((await status(u)).state).toBe("indexing_unavailable");
    const r = await ctx.app.inject({ method: "POST", url: `/api/wallets/${u.walletId}/sync`, headers: bearer(u.token) });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe("INDEXING_UNAVAILABLE");
    expect((await get(u, `/api/portfolio/${u.walletId}`)).statusCode).toBe(404);
  });
  it("responses never contain the RPC URL or secrets", async () => {
    await boot({ SOLANA_RPC_URL: "https://rpc.example.com/?api-key=SUPERSECRETKEY" });
    const u = await liveUser(ctx, "leak");
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.addTx([u.address], solIn(u.address, 1, SOL));
    await syncNow(u);
    for (const url of [`/api/wallets/${u.walletId}/sync`, `/api/portfolio/${u.walletId}`, `/api/transactions/${u.walletId}`, "/api/auth/status", "/api/health"]) {
      expect((await get(u, url)).body, url).not.toMatch(/SUPERSECRETKEY|rpc\.example/);
    }
  });
  it("other users' data never appears in my portfolio", async () => {
    await boot();
    const a = await liveUser(ctx, "iso-a");
    const b = await liveUser(ctx, "iso-b");
    rpc.addWallet(a.address, { lamports: 7n * SOL, tokens: [tokenAcct(a.address, MINT_A, 5n)] }).addWallet(b.address, { lamports: SOL });
    await syncNow(a);
    await syncNow(b);
    const pb = PortfolioResponse.parse((await get(b, `/api/portfolio/${b.walletId}`)).json());
    expect(pb.assets.map((x) => x.balance)).toEqual([SOL.toString()]);
    expect((await get(b, `/api/portfolio/${a.walletId}`)).statusCode).toBe(404);
  });
});

describe("audit regressions", () => {
  beforeEach(() => boot());
  it("drain() waits for a start() that has not registered its run yet", async () => {
    const u = await liveUser(ctx, "drain");
    rpc.addWallet(u.address, { lamports: SOL });
    void ctx.app.indexer.start({ id: u.walletId, address: u.address }, "login"); // not awaited, like the login hook
    await ctx.app.indexer.drain();
    expect((await status(u)).lastRun?.status).toBe("succeeded");
  });
  it("u64-max token amounts and Token-2022 accounts survive end to end without precision loss", async () => {
    const u = await liveUser(ctx, "u64");
    const max = 18_446_744_073_709_551_615n;
    const t22 = { ...tokenAcct(u.address, fakeMint("t22"), max, 9), programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" };
    rpc.addWallet(u.address, { lamports: max, tokens: [t22] });
    await syncNow(u);
    const p = PortfolioResponse.parse((await get(u, `/api/portfolio/${u.walletId}`)).json());
    expect(p.assets.map((a) => a.balance)).toEqual([max.toString(), max.toString()]);
    expect(p.assets[1]!.quantity).toBe("18446744073.709551615");
  });
  it("a soft-deleted wallet cannot be synced or read", async () => {
    const u = await liveUser(ctx, "removed");
    await ctx.pool.query("UPDATE wallets SET removed_at = now() WHERE id = $1", [u.walletId]);
    expect((await ctx.app.inject({ method: "POST", url: `/api/wallets/${u.walletId}/sync`, headers: bearer(u.token) })).statusCode).toBe(404);
    expect((await get(u, `/api/portfolio/${u.walletId}`)).statusCode).toBe(404);
  });
  it("demo assets/transactions never leak into a real wallet even when demo rows share the database", async () => {
    const u = await liveUser(ctx, "leak2");
    rpc.addWallet(u.address, { lamports: SOL });
    await syncNow(u);
    const body = (await get(u, `/api/portfolio/${u.walletId}`)).body + (await get(u, `/api/transactions/${u.walletId}`)).body;
    expect(body).not.toMatch(/DEMO|BONK|JUP|HRBR|USDC \(demo\)/);
  });
});

describe("login-triggered sync", () => {
  it("only for non-demo wallets, and only when enabled", async () => {
    await boot({ INDEXER_SYNC_ON_LOGIN: "true" });
    const signer = await makeSigner();
    rpc.addWallet(signer.address, { lamports: 3n * SOL });
    const res = (await signIn(ctx.app, signer)).res;
    expect(res.statusCode).toBe(200);
    await ctx.app.indexer.drain();
    const runs = await ctx.pool.query("SELECT w.id AS wid, r.trigger, r.status FROM wallet_sync_runs r JOIN wallets w ON w.id = r.wallet_id WHERE w.address = $1", [signer.address]);
    expect(runs.rows).toEqual([expect.objectContaining({ trigger: "login", status: "succeeded" })]);
  });
});
