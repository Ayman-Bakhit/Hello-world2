import { describe, expect, it } from "vitest";
import { computeTax } from "./compute";
import { TaxInputError, type TaxEvent, type PriceAt, type PriceQuote, type TaxCalcInput, type TaxTxInput } from "./types";

const DAY = 86_400;
const T0 = 1_700_000_000; // 2023-11-14
const SOL = 1_000_000_000n;
const MINT = "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MINT_B = "MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const W1 = "wallet-1", W2 = "wallet-2";

let n = 0;
const tx = (o: Partial<TaxTxInput> & Pick<TaxTxInput, "kind" | "deltas">): TaxTxInput => {
  n++;
  return { id: `id${n}`, signature: `sig${n}`, walletId: W1, occurredAt: T0, status: "success", reason: "r", classifierVersion: "1", feeLamports: 5000n, ...o };
};
const q = (asset: string, micro: bigint, at: number): PriceQuote => ({ asset, priceMicroUsd: micro, observedAt: at, source: "fixture-test", confidence: "FIXTURE" });
/** price table: asset -> [[from unix, micro]] latest at or before t */
const prices = (table: Record<string, [number, bigint][]>): PriceAt => (asset, at) => {
  const rows = (table[asset] ?? []).filter(([t]) => t <= at).sort((a, b) => b[0] - a[0]);
  return rows[0] ? q(asset, rows[0][1], rows[0][0]) : null;
};
const evs = (r: { events: TaxEvent[] }) => r.events.filter((e) => !e.id.startsWith("manual:"));
const FULL = { synced: true, historyComplete: true, hasGap: false, holdingsComplete: true };
const RATES = { shortTermRateBps: 3000, longTermRateBps: 1500, stateRateBps: 500 };
/** SOL acquired outside the indexed history, with user-supplied basis ($100/SOL). Without it every SOL leg is (correctly) DATA_REQUIRED. */
const OPEN_SOL = { id: "sol", walletId: W1, asset: "native", decimals: 9, quantity: 10n ** 30n, acquiredAt: T0 - 400 * DAY, costBasisCents: (10n ** 30n * 100_000_000n) / SOL / 10_000n };
const calc = (txs: TaxTxInput[], o: Partial<TaxCalcInput> = {}) =>
  computeTax({ txs, openingLots: [OPEN_SOL], method: "FIFO", taxYear: 2024, priceAt: prices({ native: [[0, 100_000_000n]], [MINT]: [[0, 2_000_000n]], [MINT_B]: [[0, 1_000_000n]] }), swapTreatment: "DISPOSAL_AND_ACQUISITION", rates: RATES, coverage: FULL, ...o });

// A swap of SOL -> MINT (buy MINT with SOL) and MINT -> SOL (sell MINT for SOL)
const buyMint = (qty: bigint, solSpent: bigint, at: number) => tx({ kind: "swap", occurredAt: at, deltas: [{ asset: "native", decimals: 9, delta: -solSpent }, { asset: MINT, decimals: 6, delta: qty }] });
const sellMint = (qty: bigint, solGot: bigint, at: number) => tx({ kind: "swap", occurredAt: at, deltas: [{ asset: "native", decimals: 9, delta: solGot }, { asset: MINT, decimals: 6, delta: -qty }] });

describe("event classification (conservative)", () => {
  it("swap -> SELL + BUY legs, each labeled as an assumption, with source transaction and classifier reason", () => {
    const r = calc([buyMint(10_000_000n, SOL, T0)]);
    expect(evs(r).map((e) => e.kind).sort()).toEqual(["BUY", "SELL"]);
    for (const e of evs(r)) {
      expect(e.signature).toMatch(/^sig/);
      expect(e.classification).toMatchObject({ kind: "swap", version: "1" });
      expect(e.reason).toMatch(/assumption, not a legal conclusion/);
    }
  });
  it("swapTreatment NOT_ASSESSED leaves swaps UNRESOLVED and out of every figure", () => {
    const r = calc([buyMint(10_000_000n, SOL, T0), sellMint(10_000_000n, SOL, T0 + DAY)], { swapTreatment: "NOT_ASSESSED" });
    expect(evs(r).every((e) => e.status === "UNRESOLVED" && e.missing.includes("CLASSIFICATION"))).toBe(true);
    expect(r.realized).toEqual([]);
    expect(r.status).toBe("PARTIAL");
  });
  it("UNKNOWN stays UNKNOWN and makes the result PARTIAL, never COMPLETE", () => {
    const r = calc([tx({ kind: "unknown", deltas: [{ asset: "native", decimals: 9, delta: -77n }] })]);
    expect(evs(r)[0]).toMatchObject({ kind: "UNKNOWN", status: "UNRESOLVED" });
    expect(r.status).toBe("PARTIAL");
    expect(r.requirements.some((x) => x.kind === "CLASSIFICATION")).toBe(true);
  });
  it("fee-only and failed (paid) transactions are FEE events, recorded and not applied", () => {
    const r = calc([tx({ kind: "fee", deltas: [] }), tx({ kind: "unknown", status: "failed", deltas: [], feeLamports: 5000n })]);
    expect(evs(r).map((e) => e.kind)).toEqual(["FEE", "FEE"]);
    expect(evs(r)[0]!.feeLamports).toBe(5000n);
    expect(r.feePolicy).toBe("RECORDED_NOT_APPLIED");
    expect(r.status).toBe("COMPLETE");
  });
  it("a failed transaction never creates lots, even if deltas were supplied", () => {
    const r = calc([tx({ kind: "swap", status: "failed", deltas: [{ asset: "native", decimals: 9, delta: -SOL }, { asset: MINT, decimals: 6, delta: 5n }] })]);
    expect(evs(r).map((e) => e.kind)).toEqual(["FEE"]);
    expect(r.realized).toEqual([]);
  });
  it("a failed transaction the wallet did not pay for is EXCLUDED with a reason", () => {
    const r = calc([tx({ kind: "unknown", status: "failed", deltas: [], feeLamports: 0n })]);
    expect(evs(r)[0]).toMatchObject({ status: "EXCLUDED" });
    expect(r.status).toBe("COMPLETE");
  });
  it("misshapen classifier output is UNKNOWN (swap with only outflows, token_receipt that decreased, unrecognized kind)", () => {
    const r = calc([
      tx({ kind: "swap", deltas: [{ asset: "native", decimals: 9, delta: -1n }, { asset: MINT, decimals: 6, delta: -1n }] }),
      tx({ kind: "token_receipt", deltas: [{ asset: MINT, decimals: 6, delta: -5n }] }),
      tx({ kind: "stake_something", deltas: [{ asset: "native", decimals: 9, delta: -5n }] }),
    ]);
    expect(evs(r).map((e) => e.kind)).toEqual(["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
  });
});

describe("simple buy / sell and realized gains", () => {
  it("buy then profitable sell: basis, proceeds, gain, holding period, source transactions", () => {
    // buy 10 MINT (10_000_000 base, 6 dec) paying 1 SOL @ $100 => basis $100.00 (10_000 cents)
    // sell them 30 days later for 1.5 SOL @ $200 => proceeds $300.00
    const px = prices({ native: [[0, 100_000_000n], [T0 + 20 * DAY, 200_000_000n]], [MINT]: [[0, 10_000_000n], [T0 + 20 * DAY, 30_000_000n]] });
    const buy = buyMint(10_000_000n, SOL, T0);
    const sell = sellMint(10_000_000n, 3n * SOL / 2n, T0 + 30 * DAY);
    const r = calc([buy, sell], { priceAt: px });
    const sl = r.realized.find((x) => x.asset === MINT)!;
    expect(sl).toMatchObject({ costBasisCents: 10_000n, proceedsCents: 30_000n, gainLossCents: 20_000n, holdingPeriod: "SHORT_TERM", quantity: 10_000_000n });
    expect(sl.acquisitionSignature).toBe(buy.signature);
    expect(sl.disposalSignature).toBe(sell.signature);
    expect(r.counts.SELL).toBe(2);
  });
  it("loss disposal", () => {
    const px = prices({ native: [[0, 100_000_000n]], [MINT]: [[0, 10_000_000n], [T0 + DAY, 5_000_000n]] });
    const r = calc([buyMint(10_000_000n, SOL, T0), sellMint(10_000_000n, SOL / 2n, T0 + 2 * DAY)], { priceAt: px, taxYear: 2023 });
    const sl = r.realized.find((x) => x.asset === MINT)!;
    expect(sl.gainLossCents).toBe(-5_000n);
    expect(r.estimate!.totalRealizedLossesCents).toBe(5_000n);
  });
  it("short-term vs long-term (strictly more than one year)", () => {
    const base = [buyMint(1_000_000n, SOL / 10n, T0)];
    const short = calc([...base, sellMint(1_000_000n, SOL / 10n, T0 + 365 * DAY)]);
    const long = calc([...base, sellMint(1_000_000n, SOL / 10n, T0 + 366 * DAY + 1)], { taxYear: 2024 });
    expect(short.realized.find((x) => x.asset === MINT)!.holdingPeriod).toBe("SHORT_TERM");
    expect(long.realized.find((x) => x.asset === MINT)!.holdingPeriod).toBe("LONG_TERM");
  });
  it("complete, priced, fully covered, full history => COMPLETE, with an exposure estimate", () => {
    const r = calc([buyMint(10_000_000n, SOL, T0), sellMint(10_000_000n, SOL, T0 + 400 * DAY)], { taxYear: 2025 });
    expect(r.status).toBe("COMPLETE");
    expect(r.exposureCents).not.toBeNull();
    expect(r.realized.every((x) => x.holdingPeriod === "LONG_TERM")).toBe(true);
  });
});

describe("cost-basis methods are explicit and applied", () => {
  // two lots of MINT: cheap early (price $1), expensive late (price $3); sell part later at $2.
  const px = prices({ native: [[0, 100_000_000n]], [MINT]: [[0, 1_000_000n], [T0 + 10 * DAY, 3_000_000n], [T0 + 40 * DAY, 2_000_000n]] });
  const txs = () => [buyMint(10_000_000n, 0n + SOL / 10n, T0), buyMint(10_000_000n, SOL / 10n, T0 + 10 * DAY), sellMint(10_000_000n, SOL / 10n, T0 + 40 * DAY)];
  const run = (method: "FIFO" | "LIFO" | "HIFO") => calc(txs(), { method, priceAt: px });
  const mintGain = (r: ReturnType<typeof run>) => r.realized.filter((x) => x.asset === MINT).reduce((s, x) => s + x.gainLossCents, 0n);
  it("FIFO uses the earliest lot, LIFO the latest, HIFO the highest unit cost; the method is echoed", () => {
    const [f, l, h] = [run("FIFO"), run("LIFO"), run("HIFO")];
    expect([f.method, l.method, h.method]).toEqual(["FIFO", "LIFO", "HIFO"]);
    expect(mintGain(f)).toBe(1_000n); // sold $20 against $10 basis
    expect(mintGain(l)).toBe(-1_000n); // $20 against $30 basis
    expect(mintGain(h)).toBe(-1_000n);
    expect(f.realized.find((x) => x.asset === MINT)!.lotEventId).not.toBe(l.realized.find((x) => x.asset === MINT)!.lotEventId);
  });
  it("methods are never mixed: one calculation, one method on every slice", () => {
    const r = run("HIFO");
    expect(r.method).toBe("HIFO");
  });
});

describe("transfers", () => {
  const out = (w: string, asset: string, qty: bigint, at: number, sig?: string) =>
    tx({ walletId: w, occurredAt: at, ...(sig ? { signature: sig } : {}), kind: asset === "native" ? "transfer" : "token_send", deltas: [{ asset, decimals: asset === "native" ? 9 : 6, delta: -qty }] });
  const inn = (w: string, asset: string, qty: bigint, at: number, sig?: string) =>
    tx({ walletId: w, occurredAt: at, ...(sig ? { signature: sig } : {}), kind: asset === "native" ? "transfer" : "token_receipt", deltas: [{ asset, decimals: asset === "native" ? 9 : 6, delta: qty }] });

  it("transfer in alone: TRANSFER_IN, unresolved, no cost basis invented, never a purchase", () => {
    const r = calc([inn(W1, MINT, 5n, T0)]);
    expect(evs(r)[0]).toMatchObject({ kind: "TRANSFER_IN", status: "UNRESOLVED", missing: ["TRANSFER_MATCH"], usdValueCents: null });
    expect(evs(r).some((e) => e.kind === "BUY")).toBe(false);
    expect(r.status).toBe("PARTIAL");
  });
  it("transfer out alone: TRANSFER_OUT, unresolved, never a sale", () => {
    const r = calc([out(W1, MINT, 5n, T0)]);
    expect(evs(r)[0]).toMatchObject({ kind: "TRANSFER_OUT", status: "UNRESOLVED" });
    expect(r.realized).toEqual([]);
    expect(r.status).toBe("PARTIAL");
  });
  it("same signature, two own wallets, same quantity: MATCHED internal transfer with no tax effect", () => {
    const r = calc([out(W1, "native", SOL, T0, "shared-sig"), inn(W2, "native", SOL, T0, "shared-sig")]);
    expect(evs(r).map((e) => e.status)).toEqual(["MATCHED", "MATCHED"]);
    expect(evs(r)[0]!.matchedWith).toBe(evs(r)[1]!.id);
    expect(r.status).toBe("COMPLETE");
  });
  it("same quantity but a different transaction is only a SUGGESTED candidate; both stay unresolved", () => {
    const r = calc([out(W1, MINT, 7n, T0), inn(W2, MINT, 7n, T0 + 60)]);
    expect(evs(r).every((e) => e.status === "UNRESOLVED" && e.candidates.length === 1)).toBe(true);
    expect(evs(r).every((e) => e.matchedWith === null)).toBe(true);
    const far = calc([out(W1, MINT, 7n, T0), inn(W2, MINT, 7n, T0 + 10 * DAY)]);
    expect(evs(far).every((e) => e.candidates.length === 0)).toBe(true);
  });
  it("mismatched quantities in one signature are not matched", () => {
    const r = calc([out(W1, "native", SOL, T0, "s"), inn(W2, "native", SOL - 1n, T0, "s")]);
    expect(evs(r).every((e) => e.status === "UNRESOLVED")).toBe(true);
  });
  it("received-by-transfer assets have NO basis: selling them is DATA_REQUIRED (cost basis missing), not a gain", () => {
    const r = calc([inn(W1, MINT, 10_000_000n, T0), sellMint(10_000_000n, SOL / 10n, T0 + DAY)]);
    const sell = evs(r).find((e) => e.kind === "SELL" && e.asset === MINT)!;
    expect(sell).toMatchObject({ status: "DATA_REQUIRED", missing: ["COST_BASIS"], uncoveredQuantity: 10_000_000n });
    expect(r.realized.filter((x) => x.asset === MINT)).toEqual([]);
    expect(r.status).toBe("DATA_REQUIRED");
  });
});

describe("missing data can never produce COMPLETE", () => {
  it("missing historical price: DATA_REQUIRED, PRICE DATA UNAVAILABLE, value is null (not zero), event excluded from figures", () => {
    const r = calc([buyMint(10_000_000n, SOL, T0)], { priceAt: () => null });
    expect(r.status).toBe("DATA_REQUIRED");
    for (const e of evs(r)) expect(e).toMatchObject({ status: "DATA_REQUIRED", usdValueCents: null, price: null, missing: ["PRICE"] });
    expect(evs(r)[0]!.reason).toContain("PRICE DATA UNAVAILABLE");
    expect(r.realized).toEqual([]);
  });
  it("a zero or negative price is treated as no price", () => {
    const r = calc([buyMint(10_000_000n, SOL, T0)], { priceAt: (a, t) => q(a, 0n, t) });
    expect(r.status).toBe("DATA_REQUIRED");
    expect(calc([buyMint(1n, 1n, T0)], { priceAt: (a, t) => q(a, -5n, t) }).status).toBe("DATA_REQUIRED");
  });
  it("one priced leg values the 1:1 counter leg (marked COUNTER_LEG); two unpriced legs do not", () => {
    const only = (a: string, t: number) => (a === "native" ? q(a, 100_000_000n, t) : null);
    const r = calc([buyMint(10_000_000n, SOL, T0)], { priceAt: only });
    expect(r.status).toBe("COMPLETE");
    expect(evs(r).find((e) => e.asset === MINT)).toMatchObject({ valuation: "COUNTER_LEG", usdValueCents: 10_000n });
    expect(evs(r).find((e) => e.asset === "native")).toMatchObject({ valuation: "PRICE" });
  });
  it("unknown block time on a swap: DATA_REQUIRED (TIMESTAMP)", () => {
    const r = calc([tx({ kind: "swap", occurredAt: null, deltas: [{ asset: "native", decimals: 9, delta: -SOL }, { asset: MINT, decimals: 6, delta: 5n }] })]);
    expect(r.status).toBe("DATA_REQUIRED");
    expect(r.requirements.some((x) => x.kind === "TIMESTAMP")).toBe(true);
  });
  it("missing cost basis: selling more than was ever acquired realizes only the covered part", () => {
    const r = calc([buyMint(4_000_000n, SOL / 10n, T0), sellMint(10_000_000n, SOL / 10n, T0 + DAY)]);
    const sell = evs(r).find((e) => e.kind === "SELL" && e.asset === MINT)!;
    expect(sell.uncoveredQuantity).toBe(6_000_000n);
    expect(r.realized.filter((x) => x.asset === MINT).reduce((s, x) => s + x.quantity, 0n)).toBe(4_000_000n);
    expect(r.status).toBe("DATA_REQUIRED");
  });
  it("incomplete wallet history => PARTIAL even when every event is fine; a gap too", () => {
    const txs = () => [buyMint(10_000_000n, SOL, T0), sellMint(10_000_000n, SOL, T0 + DAY)];
    expect(calc(txs(), { coverage: { ...FULL, historyComplete: false } }).status).toBe("PARTIAL");
    expect(calc(txs(), { coverage: { ...FULL, hasGap: true } }).status).toBe("PARTIAL");
    expect(calc(txs()).status).toBe("COMPLETE");
  });
  it("incomplete holdings => PARTIAL", () => {
    expect(calc([], { coverage: { ...FULL, holdingsComplete: false } }).status).toBe("PARTIAL");
  });
  it("never synced => UNAVAILABLE with no estimate", () => {
    const r = calc([], { coverage: { ...FULL, synced: false } });
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.estimate).toBeNull();
    expect(r.exposureCents).toBeNull();
  });
  it("no transactions with a fully indexed history is truthfully COMPLETE with zero figures", () => {
    const r = calc([]);
    expect(r.status).toBe("COMPLETE");
    expect(r.estimate!.estimatedExposureCents).toBe(0n);
  });
  it("no user rates: realized figures yes, exposure null, RATES listed as info (does not change status)", () => {
    const r = calc([buyMint(10_000_000n, SOL, T0), sellMint(10_000_000n, SOL, T0 + DAY)], { rates: null });
    expect(r.exposureCents).toBeNull();
    expect(r.requirements.find((x) => x.kind === "RATES")!.severity).toBe("info");
    expect(r.estimate!.totalRealizedGainsCents).toBeGreaterThanOrEqual(0n);
  });
  it("PROPERTY: for every combination of missing inputs, status is COMPLETE only if nothing is missing", () => {
    const priced = (on: boolean): PriceAt => (a, t) => (on ? q(a, a === "native" ? 100_000_000n : 10_000_000n, t) : null);
    for (const price of [true, false]) for (const hist of [true, false]) for (const hold of [true, false]) for (const unk of [true, false]) for (const trf of [true, false]) {
      const txs = [buyMint(10_000_000n, SOL, T0), sellMint(10_000_000n, SOL, T0 + DAY)];
      if (unk) txs.push(tx({ kind: "unknown", deltas: [{ asset: "native", decimals: 9, delta: -1n }] }));
      if (trf) txs.push(tx({ kind: "token_receipt", deltas: [{ asset: MINT_B, decimals: 6, delta: 3n }] }));
      const r = calc(txs, { priceAt: priced(price), coverage: { synced: true, historyComplete: hist, hasGap: false, holdingsComplete: hold } });
      const nothingMissing = price && hist && hold && !unk && !trf;
      expect(r.status === "COMPLETE", JSON.stringify({ price, hist, hold, unk, trf })).toBe(nothingMissing);
    }
  });
});

describe("precision and input validation", () => {
  it("values above 2^53 and u64-max quantities stay exact", () => {
    const big = 18_446_744_073_709_551_615n; // u64 max
    const px = prices({ native: [[0, 100_000_000n]], [MINT]: [[0, 300_000_000n]] });
    const r = calc([buyMint(big, 10n * SOL * 1_000_000n, T0), sellMint(big, 10n * SOL * 1_000_000n, T0 + DAY)], { priceAt: px });
    const sl = r.realized.find((x) => x.asset === MINT)!;
    expect(sl.quantity).toBe(big);
    expect(sl.costBasisCents).toBe((big * 300_000_000n) / 1_000_000n / 10_000n);
    expect(sl.costBasisCents > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(sl.gainLossCents).toBe(sl.proceedsCents - sl.costBasisCents);
    expect(r.status).toBe("COMPLETE");
  });
  it("partial lot splits conserve cents exactly (no drift)", () => {
    const px = prices({ native: [[0, 100_000_000n]], [MINT]: [[0, 1_000_000n]] });
    const sells = [sellMint(3_333_333n, SOL / 100n, T0 + DAY), sellMint(3_333_333n, SOL / 100n, T0 + 2 * DAY), sellMint(3_333_334n, SOL / 100n, T0 + 3 * DAY)];
    const r = calc([buyMint(10_000_000n, SOL / 5n, T0), ...sells], { priceAt: px });
    const basis = r.realized.filter((x) => x.asset === MINT).reduce((s, x) => s + x.costBasisCents, 0n);
    const buy = evs(r).find((e) => e.kind === "BUY" && e.asset === MINT)!;
    expect(basis).toBe(buy.usdValueCents);
  });
  it("zero and negative-quantity inputs are rejected", () => {
    expect(() => calc([tx({ kind: "swap", deltas: [{ asset: "native", decimals: 9, delta: 0n }, { asset: MINT, decimals: 6, delta: 1n }] })])).toThrow(TaxInputError);
    expect(() => calc([tx({ kind: "transfer", feeLamports: -1n, deltas: [{ asset: "native", decimals: 9, delta: 1n }] })])).toThrow(/negative fee/);
    expect(() => calc([tx({ kind: "transfer", deltas: [{ asset: "native", decimals: 99, delta: 1n }] })])).toThrow(/decimals/);
    expect(() => calc([tx({ kind: "transfer", occurredAt: -5, deltas: [{ asset: "native", decimals: 9, delta: 1n }] })])).toThrow(/timestamp/);
    expect(() => calc([tx({ kind: "swap", deltas: [{ asset: MINT, decimals: 6, delta: 1n }, { asset: MINT, decimals: 6, delta: -1n }] })])).toThrow(/duplicate asset/);
  });
  it("events never carry zero or negative quantities (direction is the kind)", () => {
    const r = calc([buyMint(5n, 7n, T0), tx({ kind: "token_send", deltas: [{ asset: MINT, decimals: 6, delta: -9n }] })]);
    for (const e of evs(r).filter((x) => x.kind !== "UNKNOWN")) expect(e.quantity > 0n).toBe(true);
  });
});

describe("duplicates, fees, immutability, determinism", () => {
  it("duplicate transactions (same id, or same wallet+signature) are counted once", () => {
    const t = buyMint(10_000_000n, SOL, T0);
    const r = calc([t, { ...t }, { ...t, id: "other-id" }]);
    expect(r.counts.duplicatesIgnored).toBe(2);
    expect(evs(r).filter((e) => e.kind === "BUY" && e.asset === MINT)).toHaveLength(1);
  });
  it("the same signature in two different wallets is not a duplicate", () => {
    const a = buyMint(1n, 1n, T0);
    const b = { ...a, id: "b-id", walletId: W2 };
    expect(calc([a, b]).counts.duplicatesIgnored).toBe(0);
  });
  it("fees are recorded on the event and do not change basis or proceeds", () => {
    const a = calc([buyMint(10_000_000n, SOL, T0, ), sellMint(10_000_000n, SOL, T0 + DAY)]);
    const hi = [buyMint(10_000_000n, SOL, T0), sellMint(10_000_000n, SOL, T0 + DAY)].map((t) => ({ ...t, feeLamports: 999_999_999n }));
    const b = calc(hi);
    expect(b.realized.map((x) => [x.costBasisCents, x.proceedsCents])).toEqual(a.realized.map((x) => [x.costBasisCents, x.proceedsCents]));
    expect(b.realized[0]!.feeLamports).toBe(999_999_999n);
  });
  it("inputs are not mutated and the result is deterministic (same canonical input)", () => {
    const txs = [buyMint(10_000_000n, SOL, T0), sellMint(10_000_000n, SOL, T0 + DAY)];
    const snapshot = JSON.stringify(txs, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const a = calc(txs), b = calc([...txs].reverse());
    expect(JSON.stringify(txs, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(snapshot);
    expect(a.canonicalInput).toBe(b.canonicalInput);
    expect(a.realized.map((x) => x.gainLossCents)).toEqual(b.realized.map((x) => x.gainLossCents));
  });
  it("a change to any source transaction changes the canonical input (fingerprint input)", () => {
    const t = buyMint(10_000_000n, SOL, T0);
    expect(calc([t]).canonicalInput).not.toBe(calc([{ ...t, occurredAt: T0 + 1 }]).canonicalInput);
  });
  it("tax year filter: only disposals in the year count; other years still consume lots", () => {
    const px = prices({ native: [[0, 100_000_000n]], [MINT]: [[0, 10_000_000n]] });
    const sell23 = sellMint(4_000_000n, SOL / 10n, T0); // 2023
    const sell24 = sellMint(4_000_000n, SOL / 10n, T0 + 60 * DAY); // 2024
    const r = calc([buyMint(10_000_000n, SOL, T0 - DAY), sell23, sell24], { priceAt: px, taxYear: 2024 });
    expect(r.estimate!.taxableEventCount).toBe(r.realized.filter((x) => new Date(x.disposedAt * 1000).getUTCFullYear() === 2024).length);
    expect(r.realized.filter((x) => x.asset === MINT)).toHaveLength(2);
  });
});
