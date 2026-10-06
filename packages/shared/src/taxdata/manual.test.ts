import { describe, expect, it } from "vitest";
import { computeTax } from "./compute";
import { ManualBasisValidationError, centsToDecimal, decimalToRaw, normalizeManualBasis, parseAcquisitionTime, usdToCents } from "./manual";
import type { ManualBasisInput, PriceAt, PriceQuote, TaxCalcInput, TaxTxInput } from "./types";

const DAY = 86_400, T0 = 1_700_000_000, SOL = 1_000_000_000n;
const MINT = "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", MINT_B = "MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const W1 = "w1", W2 = "w2";
const NOW = T0 + 1000 * DAY;
const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UNbmiMeFbvk";

describe("strict parsing (no silent rounding)", () => {
  it("decimalToRaw is exact and rejects anything it would have to round", () => {
    expect(decimalToRaw("1.5", 9)).toBe(1_500_000_000n);
    expect(decimalToRaw("18446744073.709551615", 9)).toBe(18_446_744_073_709_551_615n); // u64 max
    expect(decimalToRaw("0", 6)).toBe(0n);
    for (const bad of ["", "-1", "+1", "1e5", "1,5", ".5", "1.", "01", "0x10", " 1", "NaN"]) expect(() => decimalToRaw(bad, 6), bad).toThrow();
    expect(() => decimalToRaw("0.0000001", 6)).toThrow(/rounded/);
    expect(() => decimalToRaw("1.5", 0)).toThrow(/rounded/);
  });
  it("usdToCents: at most 2 decimals, exact, big values", () => {
    expect(usdToCents("1234.56")).toBe(123_456n);
    expect(usdToCents("0.5")).toBe(50n);
    expect(usdToCents("999999999999999.99")).toBe(99_999_999_999_999_999n);
    expect(centsToDecimal(5n)).toBe("0.05");
    for (const bad of ["-1", "1.234", "1e3", "", ".5", "1,000", "0123", "1000000000000000"]) expect(() => usdToCents(bad), bad).toThrow();
  });
  it("timestamps: strict UTC, whole seconds, real, not before 2009 and not in the future", () => {
    expect(parseAcquisitionTime("2023-05-17T14:30:00Z", NOW)).toBe(Date.UTC(2023, 4, 17, 14, 30) / 1000);
    for (const bad of ["2023-05-17", "2023-05-17T14:30:00", "2023-05-17T14:30:00+02:00", "2023-02-30T00:00:00Z", "2023-13-01T00:00:00Z", "2023-05-17T14:30:00.500Z", "2008-12-31T23:59:59Z", "yesterday", "2023-05-17T24:00:00Z"]) {
      expect(() => parseAcquisitionTime(bad, NOW), bad).toThrow();
    }
    expect(() => parseAcquisitionTime("2099-01-01T00:00:00Z", NOW)).toThrow(/future/);
  });
  const ok = { asset: MINT, decimals: 6, quantity: "2.5", acquiredAt: "2023-01-02T03:04:05Z", costBasis: "100.25", reason: "EXCHANGE_PURCHASE", signature: SIG, notes: "bought on an exchange" };
  it("normalizes a valid record to exact raw values", () => {
    expect(normalizeManualBasis(ok, { knownDecimals: null, nowUnix: NOW })).toMatchObject({ asset: MINT, decimals: 6, quantityRaw: 2_500_000n, costBasisCents: 10_025n, currency: "USD", reason: "EXCHANGE_PURCHASE", signature: SIG });
  });
  it("native uses known decimals; mismatch with a supplied value is rejected; unknown decimals must be supplied", () => {
    expect(normalizeManualBasis({ ...ok, asset: "native", decimals: undefined, quantity: "1.000000001" }, { knownDecimals: 9, nowUnix: NOW }).quantityRaw).toBe(1_000_000_001n);
    expect(() => normalizeManualBasis({ ...ok, decimals: 6 }, { knownDecimals: 9, nowUnix: NOW })).toThrow(ManualBasisValidationError);
    try { normalizeManualBasis({ ...ok, decimals: undefined }, { knownDecimals: null, nowUnix: NOW }); throw new Error("should have thrown"); } catch (e) { expect((e as ManualBasisValidationError).fields.decimals![0]).toMatch(/not known yet/); }
  });
  const fieldsOf = (o: Record<string, unknown>) => { try { normalizeManualBasis({ ...ok, ...o } as never, { knownDecimals: null, nowUnix: NOW }); return {}; } catch (e) { return (e as ManualBasisValidationError).fields; } };
  it("rejects zero/negative quantity, negative or over-precise cost, bad mint, bad timestamp, bad currency, bad reason, bad signature, unsafe notes", () => {
    expect(fieldsOf({ quantity: "0" }).quantity).toBeDefined();
    expect(fieldsOf({ quantity: "-1" }).quantity).toBeDefined();
    expect(fieldsOf({ quantity: "0.0000001" }).quantity![0]).toMatch(/rounded/);
    expect(fieldsOf({ costBasis: "-5" }).costBasis).toBeDefined();
    expect(fieldsOf({ costBasis: "5.001" }).costBasis).toBeDefined();
    expect(fieldsOf({ asset: "not a mint" }).asset).toBeDefined();
    expect(fieldsOf({ asset: "DROP TABLE" }).asset).toBeDefined();
    expect(fieldsOf({ acquiredAt: "2099-01-01T00:00:00Z" }).acquiredAt).toBeDefined();
    expect(fieldsOf({ currency: "EUR" }).currency).toBeDefined();
    expect(fieldsOf({ reason: "BECAUSE" }).reason).toBeDefined();
    expect(fieldsOf({ signature: "short" }).signature).toBeDefined();
    expect(fieldsOf({ notes: "a\u0000b" }).notes).toBeDefined();
    expect(fieldsOf({ notes: "a‮b" }).notes).toBeDefined();
    expect(fieldsOf({ notes: "x".repeat(1001) }).notes).toBeDefined();
    expect(Object.keys(fieldsOf({ quantity: "0", costBasis: "-1", asset: "x" })).sort()).toEqual(["asset", "costBasis", "quantity"]);
  });
  it("markup in notes is accepted as inert text (it is escaped when rendered, never interpreted)", () => {
    expect(normalizeManualBasis({ ...ok, notes: "<img src=x onerror=alert(1)>\nline2" }, { knownDecimals: null, nowUnix: NOW }).notes).toBe("<img src=x onerror=alert(1)>\nline2");
  });
});

// ---------- engine integration ----------
let n = 0;
const q = (asset: string, micro: bigint, at: number): PriceQuote => ({ asset, priceMicroUsd: micro, observedAt: at, source: "fixture-test", confidence: "FIXTURE" });
const px = (table: Record<string, [number, bigint][]>): PriceAt => (a, t) => { const r = (table[a] ?? []).filter(([x]) => x <= t).sort((x, y) => y[0] - x[0])[0]; return r ? q(a, r[1], r[0]) : null; };
const PRICES = px({ native: [[0, 100_000_000n]], [MINT]: [[0, 10_000_000n]], [MINT_B]: [[0, 1_000_000n]] });
const tx = (o: Partial<TaxTxInput> & Pick<TaxTxInput, "kind" | "deltas">): TaxTxInput => { n++; return { id: `id${n}`, signature: `sig${n}`, walletId: W1, occurredAt: T0, status: "success", reason: "r", classifierVersion: "1", feeLamports: 5000n, ...o }; };
const FULL = { synced: true, historyComplete: true, hasGap: false, holdingsComplete: true };
const calc = (txs: TaxTxInput[], manual: ManualBasisInput[], o: Partial<TaxCalcInput> = {}) =>
  computeTax({ txs, openingLots: manual, method: "FIFO", taxYear: 2024, priceAt: PRICES, swapTreatment: "DISPOSAL_AND_ACQUISITION", rates: null, coverage: FULL, ...o });
/** sell `qty` MINT for SOL at time `at` in wallet `w`: SELL MINT leg + BUY SOL leg (SOL leg needs no basis) */
const sellMint = (qty: bigint, at: number, w = W1) => tx({ walletId: w, kind: "swap", occurredAt: at, deltas: [{ asset: MINT, decimals: 6, delta: -qty }, { asset: "native", decimals: 9, delta: (qty * 10n * SOL) / (100n * 1_000_000n) || 1n }] });
const lot = (o: Partial<ManualBasisInput> & { id: string }): ManualBasisInput => ({ walletId: W1, asset: MINT, decimals: 6, quantity: 10_000_000n, acquiredAt: T0 - 100 * DAY, costBasisCents: 5_000n, createdAt: 1, revision: 1, reason: "EXCHANGE_PURCHASE", ...o });
const mint = (r: ReturnType<typeof calc>) => r.realized.filter((x) => x.asset === MINT);
const evs = (r: ReturnType<typeof calc>) => r.events;

describe("manual lots in the calculation", () => {
  it("one manual lot -> one disposal: realized from USER_PROVIDED basis, provenance on the slice and the event", () => {
    const r = calc([sellMint(10_000_000n, T0)], [lot({ id: "L1" })]);
    expect(mint(r)).toHaveLength(1);
    expect(mint(r)[0]).toMatchObject({ costBasisCents: 5_000n, proceedsCents: 10_000n, gainLossCents: 5_000n, acquisitionOrigin: "USER_PROVIDED", manualBasisId: "L1", holdingPeriod: "SHORT_TERM" });
    const e = evs(r).find((x) => x.kind === "MANUAL_BASIS")!;
    expect(e).toMatchObject({ origin: "USER_PROVIDED", manualBasisId: "L1", status: "READY", confidence: "ESTIMATED" });
    expect(e.reason).toMatch(/USER_PROVIDED/);
    expect(e.reason).toMatch(/not derived from, or verified/);
    expect(evs(r).filter((x) => x.origin === "USER_PROVIDED")).toHaveLength(1);
    expect(r.counts.MANUAL_BASIS).toBe(1);
    expect(r.status).toBe("COMPLETE");
  });
  it("one lot -> multiple disposals with partial consumption; never more than the lot; no double consumption", () => {
    const r = calc([sellMint(4_000_000n, T0), sellMint(4_000_000n, T0 + DAY), sellMint(4_000_000n, T0 + 2 * DAY)], [lot({ id: "L1" })]);
    expect(mint(r).map((x) => x.quantity)).toEqual([4_000_000n, 4_000_000n, 2_000_000n]);
    expect(mint(r).reduce((s, x) => s + x.quantity, 0n)).toBe(10_000_000n);
    expect(mint(r).reduce((s, x) => s + x.costBasisCents, 0n)).toBe(5_000n); // basis fully used, no drift
    const third = evs(r).filter((x) => x.kind === "SELL" && x.asset === MINT).sort((a, b) => a.timestamp! - b.timestamp!)[2]!;
    expect(third).toMatchObject({ status: "DATA_REQUIRED", uncoveredQuantity: 2_000_000n, missing: ["COST_BASIS"] });
    expect(r.status).toBe("DATA_REQUIRED");
  });
  it("multiple lots -> one disposal; FIFO / LIFO / HIFO pick different lots", () => {
    const lots = [lot({ id: "old", quantity: 5_000_000n, acquiredAt: T0 - 300 * DAY, costBasisCents: 1_000n, createdAt: 1 }), lot({ id: "mid", quantity: 5_000_000n, acquiredAt: T0 - 200 * DAY, costBasisCents: 9_000n, createdAt: 2 }), lot({ id: "new", quantity: 5_000_000n, acquiredAt: T0 - 100 * DAY, costBasisCents: 3_000n, createdAt: 3 })];
    const sale = () => [sellMint(5_000_000n, T0)];
    expect(mint(calc(sale(), lots, { method: "FIFO" })).map((x) => x.manualBasisId)).toEqual(["old"]);
    expect(mint(calc(sale(), lots, { method: "LIFO" })).map((x) => x.manualBasisId)).toEqual(["new"]);
    expect(mint(calc(sale(), lots, { method: "HIFO" })).map((x) => x.manualBasisId)).toEqual(["mid"]);
    const two = mint(calc([sellMint(8_000_000n, T0)], lots, { method: "FIFO" }));
    expect(two.map((x) => [x.manualBasisId, x.quantity])).toEqual([["old", 5_000_000n], ["mid", 3_000_000n]]);
    expect(two[1]!.costBasisCents).toBe(5_400n); // 3/5 of 9000, exact
  });
  it("multiple assets: each asset consumes only its own lots", () => {
    const selB = tx({ kind: "swap", occurredAt: T0, deltas: [{ asset: MINT_B, decimals: 6, delta: -2_000_000n }, { asset: "native", decimals: 9, delta: SOL / 50n }] });
    const r = calc([sellMint(1_000_000n, T0), selB], [lot({ id: "A" }), lot({ id: "B", asset: MINT_B, quantity: 2_000_000n, costBasisCents: 700n })]);
    expect(r.realized.filter((x) => x.asset === MINT_B).map((x) => x.manualBasisId)).toEqual(["B"]);
    expect(mint(r).map((x) => x.manualBasisId)).toEqual(["A"]);
    expect(r.status).toBe("COMPLETE");
  });
  it("multiple wallets: a manual lot never covers a disposal in another wallet (no cross-wallet matching)", () => {
    const r = calc([sellMint(5_000_000n, T0, W2)], [lot({ id: "L1", walletId: W1 })]);
    expect(mint(r)).toEqual([]);
    expect(evs(r).find((x) => x.kind === "SELL")!).toMatchObject({ status: "DATA_REQUIRED", uncoveredQuantity: 5_000_000n });
    const ok = calc([sellMint(5_000_000n, T0, W2)], [lot({ id: "L2", walletId: W2 })]);
    expect(mint(ok)).toHaveLength(1);
  });
  it("mixed on-chain and manual lots in one disposal (FIFO order across origins)", () => {
    // on-chain acquisition of MINT: swap native -> MINT at T0-50d (priced $10) ; manual lot older (T0-100d)
    const buy = tx({ kind: "swap", occurredAt: T0 - 50 * DAY, deltas: [{ asset: "native", decimals: 9, delta: -SOL }, { asset: MINT, decimals: 6, delta: 10_000_000n }] });
    const OPEN: ManualBasisInput = { id: "sol", walletId: W1, asset: "native", decimals: 9, quantity: 10n ** 30n, acquiredAt: T0 - 400 * DAY, costBasisCents: 10n ** 30n / SOL * 10_000n, createdAt: 0 };
    const sale = sellMint(15_000_000n, T0);
    const r = calc([buy, sale], [OPEN, lot({ id: "M", quantity: 10_000_000n, costBasisCents: 4_000n })], { method: "FIFO" });
    expect(mint(r).map((x) => [x.acquisitionOrigin, x.quantity])).toEqual([["USER_PROVIDED", 10_000_000n], ["CHAIN", 5_000_000n]]);
    const hifo = calc([buy, sellMint(15_000_000n, T0)], [OPEN, lot({ id: "M", quantity: 10_000_000n, costBasisCents: 4_000n })], { method: "HIFO" });
    expect(mint(hifo)[0]!.acquisitionOrigin).toBe("CHAIN"); // $10/token chain lot beats $4/token manual lot
  });
  it("u64-max quantities and values above 2^53 stay exact", () => {
    const big = 18_446_744_073_709_551_615n;
    const r = calc([tx({ kind: "swap", occurredAt: T0, deltas: [{ asset: MINT, decimals: 0, delta: -big }, { asset: "native", decimals: 9, delta: SOL }] })], [lot({ id: "BIG", decimals: 0, quantity: big, costBasisCents: 99_999_999_999_999_999n })], { priceAt: px({ native: [[0, 100_000_000n]], [MINT]: [[0, 3_000_000n]] }) });
    expect(mint(r)[0]).toMatchObject({ quantity: big, costBasisCents: 99_999_999_999_999_999n });
    expect(mint(r)[0]!.costBasisCents > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});

describe("linking a manual record to an unmatched transfer-in", () => {
  const recv = (qty: bigint, o: Partial<TaxTxInput> = {}) => tx({ kind: "token_receipt", occurredAt: T0, deltas: [{ asset: MINT, decimals: 6, delta: qty }], ...o });
  it("exact quantity (same wallet, acquired before): the transfer-in is resolved and names the manual record; the result is COMPLETE", () => {
    const r = calc([recv(10_000_000n)], [lot({ id: "L1" })]);
    const t = evs(r).find((x) => x.kind === "TRANSFER_IN")!;
    expect(t).toMatchObject({ status: "READY", manualBasisId: "L1", origin: "CHAIN", missing: [] });
    expect(t.reason).toMatch(/USER_PROVIDED/);
    expect(t.reason).toMatch(/not proof of origin/);
    expect(r.manualBasisReview[0]).toMatchObject({ manualBasisId: "L1", state: "OK", linkedEventId: t.id });
    expect(r.status).toBe("COMPLETE");
  });
  it("the transfer-in stays CHAIN-origin (it is a blockchain transaction) while the basis stays USER_PROVIDED", () => {
    const r = calc([recv(10_000_000n)], [lot({ id: "L1" })]);
    expect(evs(r).map((e) => [e.kind, e.origin]).sort()).toEqual([["MANUAL_BASIS", "USER_PROVIDED"], ["TRANSFER_IN", "CHAIN"]]);
  });
  it("explicit signature links even when dates differ", () => {
    const t = recv(10_000_000n, { signature: SIG });
    const r = calc([t], [lot({ id: "L1", signature: SIG, acquiredAt: T0 + 5 * DAY })]);
    expect(evs(r).find((x) => x.kind === "TRANSFER_IN")!.status).toBe("READY");
  });
  it("basis covering only part of the transfer does not resolve it (PARTIAL) and says so", () => {
    const r = calc([recv(10_000_000n, { signature: SIG })], [lot({ id: "L1", signature: SIG, quantity: 4_000_000n })]);
    const t = evs(r).find((x) => x.kind === "TRANSFER_IN")!;
    expect(t.status).toBe("UNRESOLVED");
    expect(t.reason).toMatch(/covers 4000000 of 10000000/);
    expect(r.status).toBe("PARTIAL");
  });
  it("two records that together equal the transfer resolve it", () => {
    const r = calc([recv(10_000_000n, { signature: SIG })], [lot({ id: "A", signature: SIG, quantity: 6_000_000n, costBasisCents: 3_000n, createdAt: 1, acquiredAt: T0 - 9 * DAY }), lot({ id: "B", signature: SIG, quantity: 4_000_000n, costBasisCents: 2_000n, createdAt: 2, acquiredAt: T0 - 8 * DAY })]);
    expect(evs(r).find((x) => x.kind === "TRANSFER_IN")!.status).toBe("READY");
  });
  it("records for a different wallet or asset do not link", () => {
    expect(evs(calc([recv(10_000_000n)], [lot({ id: "L1", walletId: W2 })])).find((x) => x.kind === "TRANSFER_IN")!.status).toBe("UNRESOLVED");
    expect(evs(calc([recv(10_000_000n)], [lot({ id: "L1", asset: MINT_B })])).find((x) => x.kind === "TRANSFER_IN")!.status).toBe("UNRESOLVED");
  });
  it("manual basis does NOT bypass a missing price or an unknown transaction", () => {
    const sell = sellMint(10_000_000n, T0);
    const noPrice = calc([sell], [lot({ id: "L1" })], { priceAt: () => null });
    expect(noPrice.status).toBe("DATA_REQUIRED");
    expect(noPrice.realized).toEqual([]);
    const unk = calc([tx({ kind: "unknown", deltas: [{ asset: "native", decimals: 9, delta: -1n }] })], [lot({ id: "L1" })]);
    expect(unk.status).toBe("PARTIAL");
  });
  it("status transitions as records are added: DATA_REQUIRED -> PARTIAL (history incomplete) -> COMPLETE", () => {
    const txs = () => [sellMint(10_000_000n, T0)];
    expect(calc(txs(), []).status).toBe("DATA_REQUIRED");
    expect(calc(txs(), [lot({ id: "L1" })], { coverage: { ...FULL, historyComplete: false } }).status).toBe("PARTIAL");
    expect(calc(txs(), [lot({ id: "L1" })]).status).toBe("COMPLETE");
    expect(calc(txs(), [lot({ id: "L1", quantity: 1_000_000n })]).status).toBe("DATA_REQUIRED"); // not enough basis
  });
});

describe("duplicate and overlap protection (excluded, never silently counted, never silently deleted)", () => {
  it("two identical manual records: the earlier counts, the later is POTENTIAL_DUPLICATE and EXCLUDED; no double counting", () => {
    const r = calc([sellMint(20_000_000n, T0)], [lot({ id: "A", createdAt: 1 }), lot({ id: "B", createdAt: 2 })]);
    const rb = r.manualBasisReview.find((x) => x.manualBasisId === "B")!;
    expect(rb).toMatchObject({ state: "POTENTIAL_DUPLICATE", included: false, acknowledged: false });
    expect(rb.conflicts).toEqual([expect.objectContaining({ source: "USER_PROVIDED", id: "A", quantity: 10_000_000n })]);
    expect(rb.explanation).toMatch(/counted twice/);
    expect(mint(r).reduce((s, x) => s + x.quantity, 0n)).toBe(10_000_000n); // only A; the other 10M is uncovered
    expect(evs(r).find((e) => e.manualBasisId === "B")).toMatchObject({ status: "UNRESOLVED", missing: ["BASIS_REVIEW"] });
    expect(r.status).toBe("DATA_REQUIRED");
    expect(r.requirements.some((x) => x.kind === "BASIS_REVIEW")).toBe(true);
  });
  it("without a disposal the duplicate still makes the result PARTIAL until reviewed", () => {
    expect(calc([], [lot({ id: "A", createdAt: 1 }), lot({ id: "B", createdAt: 2 })]).status).toBe("PARTIAL");
  });
  it("acknowledging the overlap includes the record (the user's explicit decision), and the review still lists the conflict", () => {
    const r = calc([sellMint(20_000_000n, T0)], [lot({ id: "A", createdAt: 1 }), lot({ id: "B", createdAt: 2, acknowledgedOverlap: true })]);
    const rb = r.manualBasisReview.find((x) => x.manualBasisId === "B")!;
    expect(rb).toMatchObject({ included: true, acknowledged: true, state: "POTENTIAL_DUPLICATE" });
    expect(mint(r).reduce((s, x) => s + x.quantity, 0n)).toBe(20_000_000n);
    expect(r.status).toBe("COMPLETE");
  });
  it("same signature and quantity is a duplicate; same signature with a different quantity is a piece; different asset or wallet is not", () => {
    expect(calc([], [lot({ id: "A", signature: SIG, createdAt: 1 }), lot({ id: "B", signature: SIG, acquiredAt: T0 - 300 * DAY, createdAt: 2 })]).manualBasisReview.find((x) => x.manualBasisId === "B")!.state).toBe("POTENTIAL_DUPLICATE");
    expect(calc([], [lot({ id: "A", signature: SIG, createdAt: 1 }), lot({ id: "B", signature: SIG, quantity: 1_000_000n, createdAt: 2 })]).manualBasisReview.every((x) => x.state === "OK")).toBe(true);
    expect(calc([], [lot({ id: "A", createdAt: 1 }), lot({ id: "B", asset: MINT_B, createdAt: 2 })]).manualBasisReview.every((x) => x.state === "OK")).toBe(true);
    expect(calc([], [lot({ id: "A", createdAt: 1 }), lot({ id: "B", walletId: W2, createdAt: 2 })]).manualBasisReview.every((x) => x.state === "OK")).toBe(true);
    expect(calc([], [lot({ id: "A", createdAt: 1 }), lot({ id: "B", acquiredAt: T0 - 100 * DAY + 2 * DAY, createdAt: 2 })]).manualBasisReview.every((x) => x.state === "OK")).toBe(true); // 2 days apart
  });
  it("a manual record that duplicates an on-chain acquisition is flagged against the CHAIN source and excluded", () => {
    const buy = tx({ kind: "swap", occurredAt: T0 - 10 * DAY, deltas: [{ asset: "native", decimals: 9, delta: -SOL }, { asset: MINT, decimals: 6, delta: 10_000_000n }] });
    const r = calc([buy], [lot({ id: "M", acquiredAt: T0 - 10 * DAY + 3600 })]);
    const rv = r.manualBasisReview[0]!;
    expect(rv).toMatchObject({ state: "POTENTIAL_DUPLICATE", included: false });
    expect(rv.conflicts[0]).toMatchObject({ source: "CHAIN", asset: MINT, quantity: 10_000_000n, signature: buy.signature });
  });
  it("records tied to one transfer that together exceed what it received are OVERLAPPING_BASIS and excluded", () => {
    const t = tx({ kind: "token_receipt", occurredAt: T0, signature: SIG, deltas: [{ asset: MINT, decimals: 6, delta: 10_000_000n }] });
    const r = calc([t], [lot({ id: "A", signature: SIG, quantity: 7_000_000n, createdAt: 1, acquiredAt: T0 - 9 * DAY }), lot({ id: "B", signature: SIG, quantity: 6_000_000n, createdAt: 2, acquiredAt: T0 - 5 * DAY })]);
    expect(r.manualBasisReview.every((x) => x.state === "OVERLAPPING_BASIS" && !x.included)).toBe(true);
    expect(r.manualBasisReview[0]!.conflicts.some((c) => c.source === "CHAIN")).toBe(true);
    expect(r.status).toBe("PARTIAL");
  });
  it("decimals that contradict the asset's on-chain decimals are excluded and cannot be acknowledged", () => {
    const r = calc([tx({ kind: "token_receipt", occurredAt: T0, deltas: [{ asset: MINT, decimals: 6, delta: 5n }] })], [lot({ id: "X", decimals: 9, acknowledgedOverlap: true })]);
    expect(r.manualBasisReview[0]).toMatchObject({ state: "DECIMALS_MISMATCH", included: false });
  });
  it("invalid records are rejected by the engine (zero/negative quantity, negative cost, bad time)", () => {
    for (const bad of [{ quantity: 0n }, { quantity: -1n }, { costBasisCents: -1n }, { acquiredAt: -5 }, { decimals: 99 }]) expect(() => calc([], [lot({ id: "Z", ...bad })])).toThrow();
  });
  it("the fingerprint input changes when a record is revised, acknowledged or added", () => {
    const base = calc([], [lot({ id: "A" })]).canonicalInput;
    expect(calc([], [lot({ id: "A", revision: 2, costBasisCents: 5_001n })]).canonicalInput).not.toBe(base);
    expect(calc([], [lot({ id: "A", acknowledgedOverlap: true })]).canonicalInput).not.toBe(base);
    expect(calc([], [lot({ id: "A" }), lot({ id: "B", asset: MINT_B })]).canonicalInput).not.toBe(base);
  });
});
