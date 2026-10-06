import { describe, expect, it } from "vitest";
import { ASSOCIATED_TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM, WRAPPED_SOL_MINT, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, buildRpcTransaction, buildTokenAccountEntry, fakeBase58, fakeMint, fakeSignature, stringifyLossless, SYSTEM_PROGRAM } from "@project-name/shared";
import { CoinGeckoPriceProvider, decimalToMicroUsd } from "../src/prices/provider";
import { JsonRpcSolanaProvider } from "../src/solana/rpc";
import { SolanaRpcError } from "../src/solana/types";

const URL_WITH_KEY = "https://rpc.example.com/v1/?api-key=SUPERSECRETKEY";
// real, valid base58 32-byte addresses (well-known program ids) so the provider's address validation passes
const ADDR = ASSOCIATED_TOKEN_PROGRAM;
const MINT_1 = WRAPPED_SOL_MINT;
const MINT_2 = COMPUTE_BUDGET_PROGRAM;

type Reply = { status?: number; body?: string; hang?: boolean; result?: unknown; error?: unknown };
type Handler = (method: string, params: unknown[], id: number) => Reply;
function provider(handler: Handler, opts: { maxRetries?: number; timeoutMs?: number } = {}) {
  const seen: { method: string; params: unknown[] }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const req = JSON.parse(String(init.body)) as { id: number; method: string; params: unknown[] };
    seen.push({ method: req.method, params: req.params });
    const h = handler(req.method, req.params, req.id);
    if (h.hang) return new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    if (h.status !== undefined) return new Response(h.body ?? "", { status: h.status });
    if (h.body !== undefined) return new Response(h.body, { status: 200 });
    const payload = h.error !== undefined ? { jsonrpc: "2.0", id: req.id, error: h.error } : { jsonrpc: "2.0", id: req.id, result: h.result };
    return new Response(stringifyLossless(payload), { status: 200 });
  }) as unknown as typeof fetch;
  return { p: new JsonRpcSolanaProvider({ url: URL_WITH_KEY, cluster: "devnet", commitment: "finalized", timeoutMs: opts.timeoutMs ?? 1000, maxRetries: opts.maxRetries ?? 0, fetchImpl }), seen };
}
const fail = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { return e as SolanaRpcError; } throw new Error("expected failure"); };

describe("JsonRpcSolanaProvider", () => {
  it("getBalance: valid response, exact for lamports above 2^53", async () => {
    const big = 18_000_000_000_000_000_001n;
    const { p, seen } = provider(() => ({ result: { context: { slot: 77 }, value: big } }));
    expect(await p.getBalance(ADDR)).toEqual({ lamports: big, slot: 77n });
    expect(seen[0]).toMatchObject({ method: "getBalance", params: [ADDR, { commitment: "finalized" }] });
  });
  it("rejects malformed, hostile and wrong-shaped responses as 'malformed'", async () => {
    for (const body of ["not json", "[]", '{"jsonrpc":"2.0","id":999,"result":1}', '{"jsonrpc":"2.0","id":1}']) {
      const { p } = provider(() => ({ body }));
      expect((await fail(() => p.getSlot())).kind, body).toBe("malformed");
    }
    const { p } = provider(() => ({ result: { context: { slot: -1 }, value: "x" } }));
    expect((await fail(() => p.getBalance(ADDR))).kind).toBe("malformed");
  });
  it("invalid addresses never reach the network", async () => {
    const { p, seen } = provider(() => ({ result: 1 }));
    expect((await fail(() => p.getBalance("not an address; DROP TABLE"))).kind).toBe("malformed");
    expect((await fail(() => p.getSignaturesForAddress(ADDR, { limit: 5, before: "bad" }))).kind).toBe("malformed");
    expect((await fail(() => p.getSignaturesForAddress(ADDR, { limit: 5000 }))).kind).toBe("malformed");
    expect((await fail(() => p.getTransaction("short"))).kind).toBe("malformed");
    expect(seen).toHaveLength(0);
  });
  it("timeout -> kind timeout; retryable errors are retried a bounded number of times", async () => {
    const t = provider(() => ({ hang: true }), { timeoutMs: 30, maxRetries: 1 });
    expect((await fail(() => t.p.getSlot())).kind).toBe("timeout");
    expect(t.seen).toHaveLength(2);
    let n = 0;
    const r = provider(() => (++n === 1 ? { status: 503 } : { result: 5 }), { maxRetries: 1 });
    expect(await r.p.getSlot()).toBe(5n);
    const never = provider(() => ({ status: 500 }), { maxRetries: 2 });
    expect((await fail(() => never.p.getSlot())).kind).toBe("http");
    expect(never.seen).toHaveLength(3);
  });
  it("non-retryable HTTP errors and JSON-RPC errors are not retried; messages never expose the URL or key", async () => {
    const a = provider(() => ({ status: 403, body: `denied for ${URL_WITH_KEY}` }), { maxRetries: 3 });
    const e1 = await fail(() => a.p.getSlot());
    expect(a.seen).toHaveLength(1);
    const b = provider(() => ({ error: { code: -32602, message: `bad params at ${URL_WITH_KEY}` } }), { maxRetries: 3 });
    const e2 = await fail(() => b.p.getSlot());
    expect(e2.kind).toBe("rpc");
    for (const e of [e1, e2]) expect(`${e.message} ${e.stack ?? ""}`).not.toMatch(/SUPERSECRETKEY|rpc\.example/);
  });
  it("network failure is sanitized", async () => {
    const p = new JsonRpcSolanaProvider({ url: URL_WITH_KEY, cluster: "devnet", commitment: "finalized", timeoutMs: 100, fetchImpl: (async () => { throw new TypeError(`fetch failed ${URL_WITH_KEY}`); }) as unknown as typeof fetch });
    const e = await fail(() => p.getSlot());
    expect(e.kind).toBe("network");
    expect(e.message).not.toMatch(/SUPERSECRETKEY/);
  });
  it("getTokenAccountsByOwner queries Token and Token-2022 and validates entries", async () => {
    const owner = ADDR, mintA = MINT_1, mintB = MINT_2;
    const { p, seen } = provider((_m, params) => {
      const program = (params[1] as { programId: string }).programId;
      return { result: { context: { slot: 9 }, value: program === TOKEN_PROGRAM
        ? [buildTokenAccountEntry({ tokenAccount: fakeBase58("t1", 44), mint: mintA, owner, amount: 5n, decimals: 6 })]
        : [buildTokenAccountEntry({ tokenAccount: fakeBase58("t2", 44), mint: mintB, owner, amount: 7n, decimals: 9, program: "spl-token-2022" })] } };
    });
    const r = await p.getTokenAccountsByOwner(owner);
    expect(seen.map((s) => (s.params[1] as { programId: string }).programId)).toEqual([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);
    expect(r.accounts.map((a) => [a.mint, a.amount, a.programId])).toEqual([[mintA, 5n, TOKEN_PROGRAM], [mintB, 7n, TOKEN_2022_PROGRAM]]);
    const bad = provider(() => ({ result: { context: { slot: 9 }, value: [{ pubkey: "x", account: { data: { parsed: { info: {} } } } }] } }));
    expect((await fail(() => bad.p.getTokenAccountsByOwner(owner))).kind).toBe("malformed");
  });
  it("getTransaction: validates, keeps the original payload, and refuses a different signature", async () => {
    const sig = fakeSignature("t");
    const raw = buildRpcTransaction({ signature: sig, slot: 5, blockTime: 1, accounts: [{ key: ADDR, pre: 1_000_000_000, post: 999_995_000 }], programs: [SYSTEM_PROGRAM] });
    const { p } = provider(() => ({ result: raw }));
    const t = await p.getTransaction(sig);
    expect(t!.normalized.signature).toBe(sig);
    expect(JSON.parse(t!.payloadJson).slot).toBe(5);
    expect((await fail(() => p.getTransaction(fakeSignature("other")))).kind).toBe("malformed");
    expect(await provider(() => ({ result: null })).p.getTransaction(sig)).toBeNull();
  });
  it("getSignaturesForAddress passes limit/before/until and rejects an over-long answer", async () => {
    const s = (i: number) => ({ signature: fakeSignature(`s${i}`), slot: i, err: null, blockTime: 1 });
    const { p, seen } = provider(() => ({ result: [s(1), s(2)] }));
    expect(await p.getSignaturesForAddress(ADDR, { limit: 5, before: fakeSignature("b"), until: fakeSignature("u") })).toHaveLength(2);
    expect(seen[0]!.params[1]).toMatchObject({ limit: 5, before: fakeSignature("b"), until: fakeSignature("u") });
    expect((await fail(() => p.getSignaturesForAddress(ADDR, { limit: 1 }))).kind).toBe("malformed");
  });
  it("metadata lookup: no account is a definitive null; foreign-owned data is ignored", async () => {
    const mint = MINT_1;
    expect(await provider(() => ({ result: { context: { slot: 1 }, value: null } })).p.getTokenMetadata(mint)).toBeNull();
    const foreign = provider(() => ({ result: { context: { slot: 1 }, value: { data: ["AAAA", "base64"], owner: SYSTEM_PROGRAM } } }));
    expect(await foreign.p.getTokenMetadata(mint)).toBeNull();
    expect((await fail(() => provider(() => ({ result: "oops" })).p.getTokenMetadata(mint))).kind).toBe("malformed");
  });
});

describe("commitment", () => {
  it.each(["finalized", "confirmed"] as const)("every read sends commitment=%s and never 'processed'", async (commitment) => {
    const seen: { method: string; params: unknown[] }[] = [];
    const sig = fakeSignature("c");
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const r = JSON.parse(String(init.body)) as { id: number; method: string; params: unknown[] };
      seen.push(r);
      const result = r.method === "getSlot" ? 1 : r.method === "getSignaturesForAddress" || r.method === "getTokenAccountsByOwner" ? (r.method === "getSignaturesForAddress" ? [] : { context: { slot: 1 }, value: [] }) : r.method === "getTransaction" ? null : { context: { slot: 1 }, value: r.method === "getBalance" ? 1 : null };
      return new Response(stringifyLossless({ jsonrpc: "2.0", id: r.id, result }));
    }) as unknown as typeof fetch;
    const p = new JsonRpcSolanaProvider({ url: "https://x.example", cluster: "devnet", commitment, timeoutMs: 500, fetchImpl });
    await p.getSlot(); await p.getBalance(ADDR); await p.getTokenAccountsByOwner(ADDR); await p.getSignaturesForAddress(ADDR, { limit: 1 }); await p.getTransaction(sig); await p.getTokenMetadata(MINT_1);
    expect(seen.map((s) => s.method)).toEqual(["getSlot", "getBalance", "getTokenAccountsByOwner", "getTokenAccountsByOwner", "getSignaturesForAddress", "getTransaction", "getAccountInfo"]);
    for (const s of seen) expect(JSON.stringify(s.params), s.method).toContain(`"commitment":"${commitment}"`);
    expect(JSON.stringify(seen)).not.toContain("processed");
  });
});

describe("price providers", () => {
  it("decimalToMicroUsd is exact and strict", () => {
    expect(decimalToMicroUsd("150.123456")).toBe(150_123_456n);
    expect(decimalToMicroUsd("0.5")).toBe(500_000n);
    expect(decimalToMicroUsd("1.2345678")).toBe(1_234_567n);
    for (const bad of ["", "-1", "1e5", "NaN", "abc", "1.", ".5"]) expect(decimalToMicroUsd(bad), bad).toBeNull();
  });
  const cg = (f: () => Response | Promise<Response>) => new CoinGeckoPriceProvider({ baseUrl: "https://prices.example", timeoutMs: 100, fetchImpl: (async () => f()) as unknown as typeof fetch });
  it("CoinGecko: SOL only, from raw text without floats", async () => {
    const q = (await cg(() => new Response('{"solana":{"usd":151.23456789}}')).getPrices(["native", fakeMint("spl")])).get("native")!;
    expect(q.priceMicroUsd).toBe(151_234_567n);
    expect(q.source).toBe("coingecko");
    expect((await cg(() => new Response('{"solana":{"usd":1}}')).getPrices([fakeMint("spl")])).size).toBe(0);
  });
  it("CoinGecko: any failure or odd payload means no price, never zero", async () => {
    for (const make of [() => new Response("x", { status: 500 }), () => new Response("{}"), () => new Response('{"solana":{"usd":0}}'), () => new Response('{"solana":{"usd":"1"}}'), () => { throw new Error("down"); }]) {
      expect((await cg(make).getPrices(["native"])).size).toBe(0);
    }
  });
});

describe("indexing config", () => {
  const base = { DATABASE_URL: "postgresql://x/y", NODE_ENV: "production", CORS_ORIGINS: "https://app.example.com" };
  it("blank values mean defaults; no RPC URL means indexing disabled", async () => {
    const { loadConfig } = await import("../src/config");
    const c = loadConfig({ DATABASE_URL: "postgresql://x/y", SOLANA_RPC_URL: "", INDEXER_INITIAL_TRANSACTION_LIMIT: "", PRICE_PROVIDER: "" });
    expect(c.SOLANA_RPC_URL).toBeUndefined();
    expect(c.INDEXER_INITIAL_TRANSACTION_LIMIT).toBe(50);
    expect(c.PRICE_PROVIDER).toBe("none");
  });
  it("production refuses a non-https RPC URL; bounds are enforced", async () => {
    const { loadConfig } = await import("../src/config");
    expect(() => loadConfig({ ...base, SOLANA_RPC_URL: "http://rpc.example.com" })).toThrow(/https/);
    expect(loadConfig({ ...base, SOLANA_RPC_URL: "https://rpc.example.com/?k=1" }).SOLANA_RPC_URL).toBeDefined();
    expect(() => loadConfig({ DATABASE_URL: "postgresql://x/y", INDEXER_INITIAL_TRANSACTION_LIMIT: "100000" })).toThrow();
    expect(() => loadConfig({ DATABASE_URL: "postgresql://x/y", SOLANA_RPC_URL: "ftp://x" })).toThrow();
  });
});
