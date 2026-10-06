import { describe, expect, it } from "vitest";
import { computeTax } from "./compute";
import { buildTaxReport, canonicalReport, csvCell, CSV_COLUMNS, exportFilename, reportToCsv, reportToJson, yearBoundary, type TaxReport } from "./report";
import type { ManualBasisInput, PriceAt, PriceQuote, TaxCalcInput, TaxTxInput } from "./types";
import { buildDemoTaxReport } from "../demo/builders";
import { DEMO_IDS } from "../demo/fixtures";

const DAY = 86_400, SOL = 1_000_000_000n;
const MINT = "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const W1 = "w1";
const utc = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, m - 1, d, h, mi, s) / 1000;
let n = 0;
const q = (asset: string, micro: bigint, at: number, c: "FIXTURE" | "OBSERVED" = "FIXTURE"): PriceQuote => ({ asset, priceMicroUsd: micro, observedAt: at, source: "fixture-test", confidence: c });
const prices = (m: Record<string, bigint>, at0 = 0): PriceAt => (a, t) => (m[a] !== undefined ? q(a, m[a]!, Math.max(at0, t - 60)) : null);
const PRICE = prices({ native: 100_000_000n, [MINT]: 10_000_000n });
const tx = (o: Partial<TaxTxInput> & Pick<TaxTxInput, "kind" | "deltas">): TaxTxInput => { n++; return { id: `id${n}`, signature: `sig${n}`, walletId: W1, occurredAt: utc(2024, 3, 1), status: "success", reason: "r", classifierVersion: "1", feeLamports: 5000n, ...o }; };
const sell = (qty: bigint, at: number, w = W1) => tx({ walletId: w, kind: "swap", occurredAt: at, deltas: [{ asset: MINT, decimals: 6, delta: -qty }, { asset: "native", decimals: 9, delta: SOL / 10n }] });
const lot = (o: Partial<ManualBasisInput> & { id: string }): ManualBasisInput => ({ walletId: W1, asset: MINT, decimals: 6, quantity: 10_000_000n, acquiredAt: utc(2022, 1, 1), costBasisCents: 5_000n, createdAt: 1, revision: 1, reason: "EXCHANGE_PURCHASE", ...o });
const FULL = { synced: true, historyComplete: true, hasGap: false, holdingsComplete: true };
const calc = (txs: TaxTxInput[], manual: ManualBasisInput[], o: Partial<TaxCalcInput> = {}) =>
  computeTax({ txs, openingLots: manual, method: "FIFO", taxYear: 2024, priceAt: PRICE, swapTreatment: "DISPOSAL_AND_ACQUISITION", rates: null, coverage: FULL, ...o });
const LIM = { transactionCap: 5000, transactionsTruncated: false, maxRows: 20_000 };
const report = (r: ReturnType<typeof calc>, o: Partial<{ limits: typeof LIM; generatedAt: string; w: string }> = {}) =>
  buildTaxReport({ result: r, walletId: o.w ?? W1, fingerprint: r.canonicalInput, generatedAt: o.generatedAt ?? "2025-01-01T00:00:00.000Z", limits: o.limits ?? LIM });

/** minimal RFC 4180 parser for assertions */
function parseCsv(s: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r" && s[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += c;
  }
  return rows;
}

describe("tax year boundary (UTC calendar year, by disposal time)", () => {
  it("documents the boundary explicitly", () => {
    expect(yearBoundary(2024)).toEqual({ kind: "UTC_CALENDAR_YEAR", from: "2024-01-01T00:00:00.000Z", toExclusive: "2025-01-01T00:00:00.000Z", basis: "disposal time (UTC)" });
  });
  it("last second of 2023 belongs to 2023, first second of 2024 belongs to 2024; acquisition year is irrelevant", () => {
    const txs = () => [sell(2_000_000n, utc(2023, 12, 31, 23, 59, 59)), sell(3_000_000n, utc(2024, 1, 1, 0, 0, 0))];
    const y23 = report(calc(txs(), [lot({ id: "A" })], { taxYear: 2023 })), y24 = report(calc(txs(), [lot({ id: "A" })], { taxYear: 2024 }));
    expect(y23.disposals.map((d) => d.quantityRaw)).toEqual(["2000000"]);
    expect(y24.disposals.map((d) => d.quantityRaw)).toEqual(["3000000"]);
    expect(y23.summary!.disposalCount + y24.summary!.disposalCount).toBe(2);
    expect(y23.disposals[0]!.disposedAt).toBe("2023-12-31T23:59:59.000Z");
    expect(y24.disposals[0]!.disposedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(report(calc(txs(), [lot({ id: "A" })], { taxYear: 2022 })).disposals).toEqual([]);
  });
  it("a different year changes the content and the hash input; it does not depend on any timezone", () => {
    const a = report(calc([sell(1_000_000n, utc(2024, 6, 1))], [lot({ id: "A" })], { taxYear: 2024 })), b = report(calc([sell(1_000_000n, utc(2024, 6, 1))], [lot({ id: "A" })], { taxYear: 2025 }));
    expect(canonicalReport(a)).not.toBe(canonicalReport(b));
    expect(b.disposals).toEqual([]);
  });
});

describe("summary, methods, holding periods", () => {
  const lots = () => [lot({ id: "old", quantity: 5_000_000n, acquiredAt: utc(2022, 1, 1), costBasisCents: 1_000n, createdAt: 1 }), lot({ id: "mid", quantity: 5_000_000n, acquiredAt: utc(2023, 6, 1), costBasisCents: 9_000n, createdAt: 2 }), lot({ id: "new", quantity: 5_000_000n, acquiredAt: utc(2024, 1, 15), costBasisCents: 3_000n, createdAt: 3 })];
  const sale = () => [sell(5_000_000n, utc(2024, 6, 1))];
  it("FIFO, LIFO, HIFO reports pick different lots and differ in gain; totals are sums of the listed rows", () => {
    const [f, l, h] = (["FIFO", "LIFO", "HIFO"] as const).map((method) => report(calc(sale(), lots(), { method })));
    expect([f!.accountingMethod, l!.accountingMethod, h!.accountingMethod]).toEqual(["FIFO", "LIFO", "HIFO"]);
    expect(f!.disposals.map((d) => d.manualBasisId)).toEqual(["old"]);
    expect(l!.disposals.map((d) => d.manualBasisId)).toEqual(["new"]);
    expect(h!.disposals.map((d) => d.manualBasisId)).toEqual(["mid"]);
    expect(new Set([f, l, h].map((r) => r!.summary!.gainLossCents)).size).toBe(3);
    for (const r of [f!, l!, h!]) {
      const rows = r.disposals;
      expect(BigInt(r.summary!.proceedsCents!) - BigInt(r.summary!.costBasisCents!)).toBe(BigInt(r.summary!.gainLossCents));
      expect(rows.reduce((s, d) => s + BigInt(d.gainLossCents), 0n).toString()).toBe(r.summary!.gainLossCents);
      expect(rows.every((d) => d.accountingMethod === r.accountingMethod)).toBe(true);
    }
    expect(new Set([f, l, h].map((r) => canonicalReport(r!))).size).toBe(3);
  });
  it("short-term and long-term are separated and sum to the net", () => {
    const r = report(calc([sell(5_000_000n, utc(2024, 6, 1)), sell(5_000_000n, utc(2024, 7, 1))], [lot({ id: "LT", quantity: 5_000_000n, acquiredAt: utc(2022, 1, 1), costBasisCents: 1_000n, createdAt: 1 }), lot({ id: "ST", quantity: 5_000_000n, acquiredAt: utc(2024, 2, 1), costBasisCents: 2_000n, createdAt: 2 })]));
    const s = r.summary!;
    expect(r.disposals.map((d) => [d.manualBasisId, d.holdingPeriod])).toEqual([["LT", "LONG_TERM"], ["ST", "SHORT_TERM"]]);
    expect(BigInt(s.shortTermGainLossCents) + BigInt(s.longTermGainLossCents)).toBe(BigInt(s.gainLossCents));
    expect(BigInt(s.shortTermProceedsCents!) + BigInt(s.longTermProceedsCents!)).toBe(BigInt(s.proceedsCents!));
    expect(s.longTermGainLossCents).toBe("4000"); // 5M @ $10 = 5000 proceeds - 1000
    expect(s.shortTermGainLossCents).toBe("3000");
  });
});

describe("status is inherited and never improved", () => {
  const good = () => calc([sell(10_000_000n, utc(2024, 6, 1))], [lot({ id: "A" })]);
  it("COMPLETE only when the calculation is COMPLETE", () => {
    expect(good().status).toBe("COMPLETE");
    expect(report(good()).status).toBe("COMPLETE");
  });
  it("PARTIAL: incomplete history, unresolved events, unknown transactions (still listed, not hidden)", () => {
    expect(report(calc([sell(10_000_000n, utc(2024, 6, 1))], [lot({ id: "A" })], { coverage: { ...FULL, historyComplete: false } })).status).toBe("PARTIAL");
    const u = report(calc([tx({ kind: "unknown", deltas: [{ asset: "native", decimals: 9, delta: -1n }] }), tx({ kind: "token_receipt", deltas: [{ asset: MINT, decimals: 6, delta: 5n }] })], []));
    expect(u.status).toBe("PARTIAL");
    expect(u.unresolvedEvents.map((e) => e.kind).sort()).toEqual(["TRANSFER_IN", "UNKNOWN"]);
    expect(u.counts.unresolvedEvents).toBe(2);
    expect(u.requirements.map((x) => x.kind)).toEqual(expect.arrayContaining(["CLASSIFICATION", "TRANSFER_MATCH"]));
  });
  it("DATA_REQUIRED: missing price (manual basis does NOT bypass it) and missing cost basis", () => {
    const np = report(calc([sell(10_000_000n, utc(2024, 6, 1))], [lot({ id: "A" })], { priceAt: () => null }));
    expect(np.status).toBe("DATA_REQUIRED");
    expect(np.requirements.some((x) => x.kind === "PRICE")).toBe(true);
    expect(np.disposals).toEqual([]);
    expect(np.unresolvedEvents.some((e) => e.status === "DATA_REQUIRED" && e.missing.includes("PRICE"))).toBe(true);
    expect(report(calc([sell(10_000_000n, utc(2024, 6, 1))], [])).status).toBe("DATA_REQUIRED");
  });
  it("UNAVAILABLE: nothing synced, no summary, no rows", () => {
    const r = report(calc([], [], { coverage: { ...FULL, synced: false } }));
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.summary).toBeNull();
    expect(r.disposals).toEqual([]);
  });
  it("property: report status is never better than the calculation status", () => {
    const rank = { COMPLETE: 0, PARTIAL: 1, DATA_REQUIRED: 2, UNAVAILABLE: 3 } as const;
    for (const price of [true, false]) for (const hist of [true, false]) for (const manual of [true, false]) for (const trunc of [true, false]) {
      const c = calc([sell(10_000_000n, utc(2024, 6, 1))], manual ? [lot({ id: "A" })] : [], { priceAt: price ? PRICE : () => null, coverage: { ...FULL, historyComplete: hist } });
      const r = report(c, { limits: { ...LIM, transactionsTruncated: trunc } });
      expect(rank[r.status]).toBeGreaterThanOrEqual(rank[c.status]);
      if (r.status === "COMPLETE") expect(c.status).toBe("COMPLETE");
      if (trunc && c.status !== "UNAVAILABLE") expect(r.status).not.toBe("COMPLETE");
    }
  });
  it("transaction cap exceeded: explicit DATA_REQUIRED with a LIMIT requirement (never a silently truncated COMPLETE)", () => {
    const r = report(good(), { limits: { ...LIM, transactionsTruncated: true } });
    expect(r.status).toBe("DATA_REQUIRED");
    expect(r.limits.transactionsTruncated).toBe(true);
    expect(r.requirements.find((x) => x.kind === "LIMIT")!.message).toMatch(/must not be relied on/);
  });
  it("too many rows: listing is capped, totals still cover EVERY disposal, status DATA_REQUIRED", () => {
    const txs = Array.from({ length: 5 }, (_, i) => sell(1_000_000n, utc(2024, 6, 1 + i)));
    const r = report(calc(txs, [lot({ id: "A" })]), { limits: { ...LIM, maxRows: 3 } });
    expect(r.limits.rowsExceeded).toBe(true);
    expect(r.disposals).toHaveLength(3);
    expect(r.summary!.disposalCount).toBe(5);
    expect(r.status).toBe("DATA_REQUIRED");
  });
});

describe("provenance and manual-basis disclosure", () => {
  it("states 'Includes user-provided tax data.' and lists records; rows carry USER_PROVIDED source and the manual id; nothing says verified", () => {
    const r = report(calc([sell(4_000_000n, utc(2024, 6, 1))], [lot({ id: "M1" })]));
    expect(r.manualBasis).toMatchObject({ included: true, disclosure: "Includes user-provided tax data." });
    expect(r.manualBasis.records[0]).toMatchObject({ id: "M1", includedInCalculation: true, reviewState: "OK", disposalSlicesUsing: 1 });
    expect(r.disposals[0]).toMatchObject({ acquisitionSource: "USER_PROVIDED", disposalSource: "CHAIN", manualBasisId: "M1", acquisitionSignature: null, confidence: "ESTIMATED", verifiedOnChain: false });
    expect(r.provenance.verifiedOnChain).toBe(false);
    expect(r.provenance.userProvidedNote).toMatch(/not read from, or verified against/);
    expect(JSON.stringify(r)).not.toMatch(/"verifiedOnChain":true/);
  });
  it("no manual basis => no disclosure; a record under review is listed as excluded and counted", () => {
    expect(report(calc([sell(4_000_000n, utc(2024, 6, 1))], [])).manualBasis).toMatchObject({ included: false, disclosure: null, records: [] });
    const dup = report(calc([], [lot({ id: "A", createdAt: 1 }), lot({ id: "B", createdAt: 2 })]));
    expect(dup.manualBasis.recordsUnderReview).toBe(1);
    expect(dup.manualBasis.records.find((x) => x.id === "B")).toMatchObject({ includedInCalculation: false, reviewState: "POTENTIAL_DUPLICATE" });
    expect(dup.status).toBe("PARTIAL");
  });
  it("price provenance: sources and observations with time and confidence; fixture prices are labeled and never verified", () => {
    const r = report(calc([sell(4_000_000n, utc(2024, 6, 1))], [lot({ id: "A" })]));
    expect(r.priceProvenance.sources).toEqual(["fixture-test (fixture)"]);
    expect(r.priceProvenance.observations[0]).toMatchObject({ confidence: "FIXTURE", source: "fixture-test (fixture)" });
    expect(r.priceProvenance.note).toMatch(/FIXTURE prices .* not verified/);
    expect(r.disposals[0]).toMatchObject({ proceedsPriceSource: "fixture-test (fixture)", proceedsPriceConfidence: "FIXTURE", proceedsValuation: "PRICE" });
    expect(r.disposals[0]!.proceedsPriceObservedAt).toBeTruthy();
  });
  it("every row traces to a source transaction, a lot (acquisition) and the wallets", () => {
    const t = sell(4_000_000n, utc(2024, 6, 1));
    const buy = tx({ kind: "swap", occurredAt: utc(2023, 5, 1), deltas: [{ asset: "native", decimals: 9, delta: -SOL }, { asset: MINT, decimals: 6, delta: 4_000_000n }] });
    const r = report(calc([buy, t], [{ id: "sol", walletId: W1, asset: "native", decimals: 9, quantity: 10n ** 30n, acquiredAt: utc(2020, 1, 1), costBasisCents: 10n ** 30n / SOL * 10_000n, createdAt: 0 }]));
    const row = r.disposals.find((d) => d.mint === MINT)!;
    expect(row).toMatchObject({ disposalSignature: t.signature, acquisitionSignature: buy.signature, acquisitionSource: "CHAIN", disposalWalletId: W1, acquisitionWalletId: W1, manualBasisId: null, holdingPeriod: "LONG_TERM" });
  });
});

describe("determinism and fingerprint sensitivity", () => {
  const T1 = sell(4_000_000n, utc(2024, 6, 1)), T2 = sell(2_000_000n, utc(2024, 7, 1));
  const mk = (o: Partial<TaxCalcInput> = {}, manual: ManualBasisInput[] = [lot({ id: "A" })]) => calc([T1, T2], manual, o);
  it("same inputs => identical report content, hash input, JSON and CSV (only generation metadata differs)", () => {
    const a = report(mk(), { generatedAt: "2025-01-01T00:00:00.000Z" }), b = report(mk(), { generatedAt: "2031-09-09T09:09:09.000Z" });
    expect(canonicalReport(a)).toBe(canonicalReport(b));
    expect(reportToCsv(a)).toBe(reportToCsv(b));
    expect(JSON.parse(reportToJson(a)).meta.generatedAt).not.toBe(JSON.parse(reportToJson(b)).meta.generatedAt);
    const strip = (r: TaxReport) => { const j = JSON.parse(reportToJson(r)); delete j.meta; return JSON.stringify(j); };
    expect(strip(a)).toBe(strip(b));
  });
  it("input ORDER does not matter", () => {
    const txs = [sell(4_000_000n, utc(2024, 6, 1)), sell(2_000_000n, utc(2024, 7, 1))];
    const a = report(calc(txs, [lot({ id: "A" })])), b = report(calc([...txs].reverse(), [lot({ id: "A" })]));
    expect(reportToCsv(a)).toBe(reportToCsv(b));
    expect(canonicalReport(a)).toBe(canonicalReport(b));
  });
  it("hash input changes with: manual revision, price observation, accounting method, tax year, source transaction", () => {
    const base = canonicalReport(report(mk()));
    expect(canonicalReport(report(mk({}, [lot({ id: "A", revision: 2, costBasisCents: 5_001n })])))).not.toBe(base);
    expect(canonicalReport(report(mk({ priceAt: prices({ native: 100_000_000n, [MINT]: 11_000_000n }) })))).not.toBe(base);
    expect(canonicalReport(report(mk({ method: "HIFO" })))).not.toBe(base);
    expect(canonicalReport(report(mk({ taxYear: 2025 })))).not.toBe(base);
    expect(canonicalReport(report(calc([T1, { ...T2, occurredAt: utc(2024, 7, 2) }], [lot({ id: "A" })])))).not.toBe(base);
  });
});

describe("CSV export", () => {
  const r = () => report(calc([sell(4_000_000n, utc(2024, 6, 1)), sell(3_000_000n, utc(2024, 7, 1))], [lot({ id: "M1" })]));
  it("one row per realized disposal, fixed columns, CRLF, header present", () => {
    const rows = parseCsv(reportToCsv(r()));
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveLength(CSV_COLUMNS.length);
    expect(reportToCsv(r()).endsWith("\r\n")).toBe(true);
    const c = (name: string) => CSV_COLUMNS.indexOf(name as never);
    expect(rows[1]![c("tax_year")]).toBe("2024");
    expect(rows[1]![c("acquisition_source")]).toBe("USER_PROVIDED");
    expect(rows[1]![c("disposal_source")]).toBe("CHAIN");
    expect(rows[1]![c("manual_basis_id")]).toBe("M1");
    expect(rows[1]![c("report_status")]).toBe("COMPLETE");
    expect(rows[1]![c("verified_on_chain")]).toBe("false");
    expect(rows[1]![c("accounting_method")]).toBe("FIFO");
    expect(rows[1]![c("proceeds_price_source")]).toBe("fixture-test (fixture)");
    expect(rows[1]![c("proceeds_price_observed_at")]).toMatch(/Z$/);
  });
  it("exact money in dollars, negative gains stay numeric, quantity is exact", () => {
    const loss = report(calc([sell(10_000_000n, utc(2024, 6, 1))], [lot({ id: "L", costBasisCents: 50_000n })]));
    const row = parseCsv(reportToCsv(loss))[1]!;
    expect(row[CSV_COLUMNS.indexOf("cost_basis_usd")]).toBe("500.00");
    expect(row[CSV_COLUMNS.indexOf("proceeds_usd")]).toBe("100.00");
    expect(row[CSV_COLUMNS.indexOf("gain_loss_usd")]).toBe("-400.00");
    expect(row[CSV_COLUMNS.indexOf("quantity")]).toBe("10");
    expect(row[CSV_COLUMNS.indexOf("quantity_raw")]).toBe("10000000");
  });
  it("no rows => header only", () => {
    expect(reportToCsv(report(calc([], []))).trim()).toBe(CSV_COLUMNS.join(","));
  });
  it("formula injection: = + - @ tab CR prefixed so spreadsheets read text; numbers stay numbers", () => {
    for (const bad of ["=1+1", "+SUM(A1)", "-1+1", "@SUM(1)", "\t=1", "\r=1", "=HYPERLINK(\"http://evil\",\"x\")", "-2+3", "+1", "=cmd|' /C calc'!A0"]) {
      const out = csvCell(bad);
      expect(out.replace(/^"/, "").startsWith("'"), bad).toBe(true);
      expect(/^[=+\-@\t\r]/.test(out.replace(/^"/, "")), bad).toBe(false);
    }
    expect(csvCell("-50.00", { numeric: true })).toBe("-50.00");
    expect(csvCell("12.5", { numeric: true })).toBe("12.5");
    expect(csvCell("-1+1", { numeric: true })).toBe("'-1+1"); // "numeric" does not exempt anything that is not a plain number
    expect(csvCell("-50.00")).toBe("'-50.00"); // text cells are always escaped
    expect(csvCell("a=1+1")).toBe("a=1+1"); // only the FIRST character matters
  });
  it("RFC 4180 quoting and control-character removal", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("a\u0000b‮c")).toBe("abc");
    expect(csvCell(null)).toBe("");
    expect(csvCell(0n)).toBe("0");
  });
  it("hostile text anywhere in a row cannot start a formula (end to end)", () => {
    const rep = r();
    const hostile = { ...rep, disposals: rep.disposals.map((d) => ({ ...d, asset: "=HYPERLINK(\"x\")", mint: "@evil", disposalSignature: "+1+1", manualBasisId: "-1", proceedsPriceSource: "\t=1" })) };
    const rows = parseCsv(reportToCsv(hostile));
    for (const row of rows.slice(1)) for (const cell of row) if (cell.length) expect(/^[=+@\t\r]/.test(cell) || (/^-/.test(cell) && !/^-?\d+(\.\d+)?$/.test(cell))).toBe(false);
  });
});

describe("JSON export and safety", () => {
  it("includes metadata, status, summary, disposals, unresolved events, requirements, provenance, fingerprint", () => {
    const j = JSON.parse(reportToJson(report(calc([sell(4_000_000n, utc(2024, 6, 1)), tx({ kind: "unknown", deltas: [{ asset: "native", decimals: 9, delta: -1n }] })], [lot({ id: "M" })]))));
    for (const k of ["reportVersion", "meta", "walletId", "taxYear", "yearBoundary", "accountingMethod", "swapTreatment", "status", "summary", "disposals", "unresolvedEvents", "requirements", "manualBasis", "priceProvenance", "provenance", "limits", "fingerprint", "reportHash", "disclaimer"]) expect(j, k).toHaveProperty(k);
    expect(j.label).toBe("ESTIMATED_TAX_REPORT");
    expect(j.unresolvedEvents).toHaveLength(1);
  });
  it("contains no secret-like fields or values", () => {
    const text = reportToJson(report(calc([sell(4_000_000n, utc(2024, 6, 1))], [lot({ id: "M" })])));
    expect(text).not.toMatch(/https?:\/\/|secret|password|cookie|session|api[-_]?key|private key|bearer|authorization/i); // the word "RPC node" appears in a provenance note; no URL or credential does
  });
  it("filename is built only from validated parts", () => {
    const f = exportFilename({ taxYear: 2024, accountingMethod: "FIFO", fingerprint: "../../etc/passwd;rm -rf abc123def456789" }, "csv");
    expect(f).toMatch(/^[a-z0-9.-]+$/);
    expect(f.endsWith(".csv")).toBe(true);
    expect(exportFilename({ taxYear: 2024, accountingMethod: "H\"IFO\r\n", fingerprint: "a".repeat(64) }, "json")).toMatch(/^[a-z0-9.-]+$/);
  });
  it("demo report is labeled demo, has no itemized figures and never claims verification", () => {
    const d = buildDemoTaxReport(DEMO_IDS.wallets.trading, "2025-01-01T00:00:00.000Z")!;
    expect(d.provenance.dataSource).toBe("demo");
    expect(d.summary!.proceedsCents).toBeNull();
    expect(d.disposals).toEqual([]);
    expect(buildDemoTaxReport("not-demo", "x")).toBeNull();
  });
});
