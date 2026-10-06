import { describe, expect, it } from "vitest";
import { classifyTransaction, primaryDelta } from "./classify";
import { normalizeBalance, normalizeRpcTransaction, normalizeSignatures, normalizeSlot, normalizeTokenAccounts, parseMetaplexMetadata } from "./parse";
import { buildRpcTransaction, buildTokenAccountEntry, fakeBase58, fakeMint, fakeProgram, fakeSignature, rpcTransactionJson, type TxSpec } from "./testing";
import { ChainParseError, MEMO_PROGRAMS, SYSTEM_PROGRAM, TOKEN_PROGRAM } from "./types";
import { formatUnits, parseJsonLossless, stringifyLossless, valueCents } from "./units";

const W = fakeBase58("wallet", 44);
const OTHER = fakeBase58("other", 44);
const ATA = fakeBase58("ata-w", 44);
const MINT = fakeMint("usdc");
const MINT2 = fakeMint("bonk");
const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const SOL = 1_000_000_000n;
let n = 0;
const sig = () => fakeSignature(`t${n++}`);
const classify = (spec: Omit<TxSpec, "signature" | "slot" | "blockTime">, wallet = W) =>
  classifyTransaction(wallet, normalizeRpcTransaction(buildRpcTransaction({ signature: sig(), slot: 100, blockTime: 1_700_000_000, ...spec })));

describe("classification: only labels what is unambiguous", () => {
  it("SOL sent (wallet pays the fee): transfer, fee excluded from the delta", () => {
    const c = classify({ accounts: [{ key: W, pre: 10n * SOL, post: 9n * SOL - 5000n }, { key: OTHER, pre: 0, post: SOL }], programs: [SYSTEM_PROGRAM] });
    expect(c).toMatchObject({ kind: "transfer", feeLamports: 5000n, walletPaidFee: true });
    expect(c.deltas).toEqual([{ asset: "native", delta: -SOL, decimals: 9 }]);
    expect(c.reason).toContain("Sent 1 SOL");
  });
  it("SOL received (someone else paid the fee)", () => {
    const c = classify({ accounts: [{ key: OTHER, pre: 5n * SOL, post: 4n * SOL - 5000n }, { key: W, pre: 0, post: SOL }], programs: [SYSTEM_PROGRAM] });
    expect(c).toMatchObject({ kind: "transfer", walletPaidFee: false });
    expect(c.deltas[0]).toMatchObject({ delta: SOL });
  });
  it("token receipt: single mint, token/system programs only", () => {
    const c = classify({
      accounts: [{ key: OTHER, pre: SOL, post: SOL - 2_044_280n }, { key: W, pre: 0, post: 0 }, { key: ATA, pre: 0, post: 2_039_280 }],
      tokens: [{ index: 2, mint: MINT, owner: W, pre: 0n, post: 100n, decimals: 6 }], programs: [TOKEN_PROGRAM],
    });
    expect(c.kind).toBe("token_receipt");
    expect(c.deltas).toEqual([{ asset: MINT, delta: 100n, decimals: 6 }]);
  });
  it("token send", () => {
    const c = classify({
      accounts: [{ key: W, pre: SOL, post: SOL - 5000n }, { key: ATA, pre: 2_039_280, post: 2_039_280 }],
      tokens: [{ index: 1, mint: MINT, owner: W, pre: 100n, post: 40n, decimals: 6 }], programs: [TOKEN_PROGRAM],
    });
    expect(c.kind).toBe("token_send");
    expect(c.deltas[0]!.delta).toBe(-60n);
  });
  it("balances across several token accounts of one mint are summed", () => {
    const A2 = fakeBase58("ata-w2", 44);
    const c = classify({
      accounts: [{ key: W, pre: SOL, post: SOL - 5000n }, { key: ATA, pre: 1, post: 1 }, { key: A2, pre: 1, post: 1 }],
      tokens: [{ index: 1, mint: MINT, owner: W, pre: 100n, post: 70n, decimals: 6 }, { index: 2, mint: MINT, owner: W, pre: 10n, post: 0n, decimals: 6 }], programs: [TOKEN_PROGRAM],
    });
    expect(c.deltas).toEqual([{ asset: MINT, delta: -40n, decimals: 6 }]);
  });
  it("swap only when a recognized DEX program is involved (outer or inner)", () => {
    const base = { accounts: [{ key: W, pre: 5n * SOL, post: 3n * SOL - 5000n }, { key: ATA, pre: 1, post: 1 }], tokens: [{ index: 1, mint: MINT, owner: W, pre: 0n, post: 300_000_000n, decimals: 6 }] };
    const viaJup = classify({ ...base, programs: [JUP] });
    expect(viaJup.kind).toBe("swap");
    expect(viaJup.reason).toContain("Jupiter v6");
    expect(classify({ ...base, programs: [fakeProgram("some-dex")], innerPrograms: [JUP] }).kind).toBe("swap");
    const unlisted = classify({ ...base, programs: [fakeProgram("unlisted-dex")] });
    expect(unlisted.kind).toBe("unknown");
    expect(unlisted.reason).toContain("no recognized DEX");
  });
  it("failed transaction: FEE if the wallet paid, otherwise unknown", () => {
    const failed = { err: { InstructionError: [0, "Custom"] }, accounts: [{ key: W, pre: SOL, post: SOL - 5000n }], programs: [JUP] };
    expect(classify(failed)).toMatchObject({ kind: "fee", walletPaidFee: true, deltas: [] });
    expect(classify({ ...failed, accounts: [{ key: OTHER, pre: SOL, post: SOL - 5000n }, { key: W, pre: 0, post: 0 }] }).kind).toBe("unknown");
  });
  it("no movement: FEE if payer, else unknown", () => {
    expect(classify({ accounts: [{ key: W, pre: SOL, post: SOL - 5000n }], programs: [MEMO_PROGRAMS[0]] }).kind).toBe("fee");
    expect(classify({ accounts: [{ key: OTHER, pre: SOL, post: SOL - 5000n }, { key: W, pre: 7, post: 7 }], programs: [MEMO_PROGRAMS[0]] }).kind).toBe("unknown");
  });
  it("UNKNOWN is the answer for anything else (staking, SOL+token same direction, unrelated wallet, unattributed tokens)", () => {
    expect(classify({ accounts: [{ key: W, pre: 10n * SOL, post: 9n * SOL - 5000n }, { key: OTHER, pre: 0, post: SOL }], programs: [fakeProgram("stake")] }).kind).toBe("unknown");
    expect(classify({
      accounts: [{ key: W, pre: SOL, post: 2n * SOL - 5000n }, { key: ATA, pre: 1, post: 1 }],
      tokens: [{ index: 1, mint: MINT, owner: W, pre: 0n, post: 5n, decimals: 6 }], programs: [TOKEN_PROGRAM],
    }).kind).toBe("unknown");
    expect(classify({ accounts: [{ key: OTHER, pre: SOL, post: SOL }], programs: [SYSTEM_PROGRAM] }).kind).toBe("unknown");
    // token balance without an owner cannot be attributed to the wallet
    expect(classify({
      accounts: [{ key: W, pre: SOL, post: SOL - 5000n }, { key: ATA, pre: 1, post: 1 }],
      tokens: [{ index: 1, mint: MINT, owner: null, pre: 0n, post: 5n, decimals: 6 }], programs: [TOKEN_PROGRAM],
    }).kind).toBe("fee");
    // two mints moving the same way is not labeled
    expect(classify({
      accounts: [{ key: W, pre: SOL, post: SOL - 5000n }, { key: ATA, pre: 1, post: 1 }, { key: fakeBase58("a3", 44), pre: 1, post: 1 }],
      tokens: [{ index: 1, mint: MINT, owner: W, pre: 0n, post: 5n, decimals: 6 }, { index: 2, mint: MINT2, owner: W, pre: 0n, post: 5n, decimals: 6 }], programs: [TOKEN_PROGRAM],
    }).kind).toBe("unknown");
  });
  it("every label carries a reason and the classifier version, and never says anything about tax", () => {
    const c = classify({ accounts: [{ key: W, pre: 10n * SOL, post: 9n * SOL - 5000n }, { key: OTHER, pre: 0, post: SOL }], programs: [SYSTEM_PROGRAM] });
    expect(c.reason.length).toBeGreaterThan(10);
    expect(c.version).toBe("1");
    expect(JSON.stringify(c, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).toLowerCase()).not.toMatch(/tax|disposal|income|gain/);
  });
  it("primaryDelta prefers the largest token movement, else SOL", () => {
    expect(primaryDelta({ deltas: [{ asset: "native", delta: -5n * SOL, decimals: 9 }, { asset: MINT, delta: 7n, decimals: 6 }, { asset: MINT2, delta: -9n, decimals: 6 }] })?.asset).toBe(MINT2);
    expect(primaryDelta({ deltas: [{ asset: "native", delta: SOL, decimals: 9 }] })?.asset).toBe("native");
    expect(primaryDelta({ deltas: [] })).toBeNull();
  });
});

describe("normalizeRpcTransaction: RPC data is untrusted", () => {
  const good = () => buildRpcTransaction({ signature: fakeSignature("g"), slot: 5, blockTime: 1_700_000_000, accounts: [{ key: W, pre: SOL, post: SOL - 5000n }] });
  const clone = () => JSON.parse(JSON.stringify(good(), (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
  it("accepts a valid transaction and exposes bigint money", () => {
    const t = normalizeRpcTransaction(good());
    expect(t).toMatchObject({ slot: 5n, fee: 5000n, failed: false, blockTime: 1_700_000_000 });
    expect(t.preBalances[0]).toBe(SOL);
    expect(t.programIds).toEqual([SYSTEM_PROGRAM]);
  });
  it("null block time is preserved (not invented)", () => {
    expect(normalizeRpcTransaction(buildRpcTransaction({ signature: fakeSignature("nb"), slot: 5, blockTime: null, accounts: [{ key: W, pre: 1, post: 1 }] })).blockTime).toBeNull();
  });
  it("rejects every kind of malformed input with ChainParseError", () => {
    const mutate = (f: (x: Record<string, any>) => void) => { const x = clone(); f(x); return x; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const bad: unknown[] = [
      null, "x", 42, [], {},
      mutate((x) => { delete x.meta; }),
      mutate((x) => { x.meta.fee = -1; }),
      mutate((x) => { x.meta.fee = "5000"; }),
      mutate((x) => { x.meta.fee = 1.5; }),
      mutate((x) => { x.slot = "100"; }),
      mutate((x) => { x.transaction.signatures = []; }),
      mutate((x) => { x.transaction.signatures = ["not a signature"]; }),
      mutate((x) => { x.transaction.message.accountKeys = [{ pubkey: "short" }]; }),
      mutate((x) => { x.meta.postBalances.push(1); }),
      mutate((x) => { x.meta.preBalances = [-1]; }),
      mutate((x) => { x.meta.postTokenBalances = [{ accountIndex: 9, mint: fakeMint("m"), owner: W, uiTokenAmount: { amount: "1", decimals: 6 } }]; }),
      mutate((x) => { x.meta.postTokenBalances = [{ accountIndex: 0, mint: fakeMint("m"), owner: W, uiTokenAmount: { amount: "-1", decimals: 6 } }]; }),
      mutate((x) => { x.meta.postTokenBalances = [{ accountIndex: 0, mint: fakeMint("m"), owner: W, uiTokenAmount: { amount: "1", decimals: 99 } }]; }),
      mutate((x) => { x.meta.postTokenBalances = [{ accountIndex: 0, mint: "<script>", owner: W, uiTokenAmount: { amount: "1", decimals: 6 } }]; }),
    ];
    for (const b of bad) expect(() => normalizeRpcTransaction(b), JSON.stringify(b)?.slice(0, 60)).toThrow(ChainParseError);
  });
  it("versioned transactions: loaded lookup-table addresses extend the key list", () => {
    const x = clone();
    const extra = fakeBase58("lut", 44);
    x.meta.preBalances.push(1); x.meta.postBalances.push(1);
    x.meta.loadedAddresses = { writable: [extra], readonly: [] };
    expect(normalizeRpcTransaction(x).accountKeys).toHaveLength(2);
  });
  it("string-array account keys (non-parsed encoding) are accepted", () => {
    const x = clone();
    x.transaction.message.accountKeys = [W];
    expect(normalizeRpcTransaction(x).accountKeys).toEqual([W]);
  });
});

describe("lossless integers (balances above 2^53 lamports)", () => {
  it("a 10,000,000 SOL balance survives the round trip exactly", () => {
    const whale = 10_000_000n * SOL + 1n; // > 2^53 and odd: not representable as a double
    const json = rpcTransactionJson({ signature: fakeSignature("whale"), slot: 1, blockTime: 1, accounts: [{ key: W, pre: whale, post: whale - 5000n }] });
    expect(BigInt(JSON.parse(json).meta.preBalances[0])).not.toBe(whale); // a plain JSON.parse rounds it
    const t = normalizeRpcTransaction(parseJsonLossless(json));
    expect(t.preBalances[0]).toBe(whale);
    expect(t.postBalances[0]).toBe(whale - 5000n);
    expect(stringifyLossless(parseJsonLossless(json))).toContain(whale.toString());
    expect(normalizeBalance(parseJsonLossless(`{"context":{"slot":9},"value":${whale}}`))).toEqual({ lamports: whale, slot: 9n });
  });
});

describe("other response normalizers", () => {
  it("signatures, balance, slot", () => {
    const s = fakeSignature("s1");
    expect(normalizeSignatures([{ signature: s, slot: 9, err: null, blockTime: 5 }, { signature: fakeSignature("s2"), slot: 8, err: { x: 1 }, blockTime: null }]).map((x) => [x.slot, x.failed, x.blockTime])).toEqual([[9n, false, 5], [8n, true, null]]);
    expect(() => normalizeSignatures([{ signature: "nope", slot: 1 }])).toThrow(ChainParseError);
    expect(() => normalizeSignatures({})).toThrow(ChainParseError);
    expect(normalizeBalance({ context: { slot: 3 }, value: 42 })).toEqual({ lamports: 42n, slot: 3n });
    for (const b of [null, { value: 1 }, { context: { slot: 1 }, value: "1" }, { context: { slot: 1 }, value: -1 }]) expect(() => normalizeBalance(b)).toThrow(ChainParseError);
    expect(normalizeSlot(77)).toBe(77n);
    expect(() => normalizeSlot("77")).toThrow(ChainParseError);
  });
  it("token accounts, including zero balances and bad entries", () => {
    const ok = buildTokenAccountEntry({ tokenAccount: ATA, mint: MINT, owner: W, amount: 5n, decimals: 6 });
    const zero = buildTokenAccountEntry({ tokenAccount: fakeTokenAcct("z"), mint: MINT2, owner: W, amount: 0n, decimals: 9 });
    const r = normalizeTokenAccounts({ context: { slot: 12 }, value: [ok, zero] }, TOKEN_PROGRAM);
    expect(r.slot).toBe(12n);
    expect(r.accounts.map((a) => [a.mint === MINT, a.amount, a.decimals])).toEqual([[true, 5n, 6], [false, 0n, 9]]);
    expect(() => normalizeTokenAccounts({ context: { slot: 1 }, value: [{ pubkey: ATA }] }, TOKEN_PROGRAM)).toThrow(ChainParseError);
    expect(() => normalizeTokenAccounts({ context: { slot: 1 }, value: "x" }, TOKEN_PROGRAM)).toThrow(ChainParseError);
    const evil = buildTokenAccountEntry({ tokenAccount: ATA, mint: MINT, owner: W, amount: 1n, decimals: 6 }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    evil.account.data.parsed.info.tokenAmount.amount = "1e30";
    expect(() => normalizeTokenAccounts({ context: { slot: 1 }, value: [evil] }, TOKEN_PROGRAM)).toThrow(ChainParseError);
  });
});
function fakeTokenAcct(s: string) { return fakeBase58(`acct${s}`, 44); }

describe("Metaplex metadata is untrusted text", () => {
  const build = (name: string, symbol: string, uri: string, pad = true) => {
    const enc = new TextEncoder();
    const field = (s: string, size: number) => { const b = new Uint8Array(4 + (pad ? size : enc.encode(s).length)); new DataView(b.buffer).setUint32(0, pad ? size : enc.encode(s).length, true); b.set(enc.encode(s).subarray(0, size), 4); return b; };
    const parts = [new Uint8Array([4]), new Uint8Array(32), new Uint8Array(32), field(name, 32), field(symbol, 10), field(uri, 200)];
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  it("parses padded fields and strips NUL padding", () => {
    expect(parseMetaplexMetadata(build("Example Coin", "EXMP", "https://example.com/meta.json"))).toEqual({ name: "Example Coin", symbol: "EXMP", uri: "https://example.com/meta.json", source: "metaplex_onchain" });
  });
  it("drops non-https/ipfs/arweave URIs and strips control and bidi characters; markup stays inert text", () => {
    const m = parseMetaplexMetadata(build("Evil\u202e\u0007<b onclick=x()>", "S\u0000YM", "javascript:alert(1)"))!;
    expect(m.uri).toBeNull();
    expect(m.name).toBe("Evil<b onclick=x()>");
    expect(m.symbol).toBe("SYM");
    expect(parseMetaplexMetadata(build("A", "B", "http://plain-http.example/x"))!.uri).toBeNull();
    expect(parseMetaplexMetadata(build("A", "B", "ipfs://bafy123"))!.uri).toBe("ipfs://bafy123");
  });
  it("rejects wrong key, truncated data, and absurd length fields", () => {
    const ok = build("A", "B", "https://x.example");
    const wrong = ok.slice(); wrong[0] = 9;
    expect(parseMetaplexMetadata(wrong)).toBeNull();
    expect(parseMetaplexMetadata(ok.slice(0, 40))).toBeNull();
    const huge = ok.slice(); new DataView(huge.buffer).setUint32(65, 0xffffffff, true);
    expect(parseMetaplexMetadata(huge)).toBeNull();
    expect(parseMetaplexMetadata(new Uint8Array(0))).toBeNull();
  });
  it("empty strings become null, not fabricated placeholders", () => {
    expect(parseMetaplexMetadata(build("", "", ""))).toMatchObject({ name: null, symbol: null, uri: null });
  });
});

describe("units", () => {
  it("formatUnits is exact", () => {
    expect(formatUnits(1_500_000n, 6)).toBe("1.5");
    expect(formatUnits(-1n, 9)).toBe("-0.000000001");
    expect(formatUnits(10_000_000n * SOL, 9)).toBe("10000000");
    expect(formatUnits(5n, 0)).toBe("5");
    expect(() => formatUnits(1n, -1)).toThrow();
  });
  it("valueCents floors and never touches floats", () => {
    expect(valueCents(2n * SOL, 9, 142_500_000n)).toBe(28_500n); // 2 SOL @ $142.50 = $285.00
    expect(valueCents(1n, 9, 142_500_000n)).toBe(0n);
  });
});
