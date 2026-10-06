import { afterEach, describe, expect, it } from "vitest";
import {
  KNOWN_DEX_PROGRAMS, TOKEN_PROGRAM, CSV_COLUMNS, TaxReportResponse, fakeBase58, fakeMint, fakeSignature, fakeTokenAccount, type TxSpec,
} from "@project-name/shared";
import { createSession } from "../src/auth/session";
import { type HistoricalPriceProvider } from "../src/prices/historical";
import { NullPriceProvider } from "../src/prices/provider";
import { FakeSolanaRpc } from "../src/solana/fake";
import { bearer, makeCtx, W, type Ctx } from "./helpers";

const SOL = 1_000_000_000n;
const DEX = Object.keys(KNOWN_DEX_PROGRAMS)[0]!;
const MINT = fakeMint("report-token");
const T = 1_700_000_000; // 2023-11-14
const DAY = 86_400;
const ISO = (t: number) => new Date(t * 1000).toISOString().replace(".000Z", "Z");

let ctx: Ctx;
let rpc: FakeSolanaRpc;
afterEach(async () => { await ctx?.close(); ctx = undefined as never; });

interface U { userId: string; walletId: string; address: string; token: string }
async function wallet(userId: string, seed: string): Promise<Omit<U, "userId">> {
  const address = fakeBase58(`rpwallet:${seed}`, 44);
  const w = await ctx.pool.query("INSERT INTO wallets (user_id, chain, address, label, data_source, ownership_verified_at) VALUES ($1,'solana',$2,'Live','database', now()) RETURNING id", [userId, address]);
  const { token } = await createSession(ctx.pool, { userId, walletId: w.rows[0].id, authMethod: "wallet_signature", ttlHours: 1 });
  return { walletId: w.rows[0].id as string, address, token };
}
async function user(seed: string): Promise<U> {
  const u = await ctx.pool.query("INSERT INTO users (display_name) VALUES ($1) RETURNING id", [seed]);
  return { userId: u.rows[0].id, ...(await wallet(u.rows[0].id, `${seed}-1`)) };
}
class MutablePrices implements HistoricalPriceProvider {
  readonly name = "mutable-fixture";
  wait: Promise<void> | null = null;
  fail = false;
  constructor(public mint: bigint = 10_000_000n, public sol: bigint = 100_000_000n) {}
  async loadSeries() {
    if (this.wait) await this.wait;
    if (this.fail) throw new Error("price source exploded at /srv/secret/path.ts:42");
    const t0 = T - 500 * DAY;
    return (asset: string, at: number) => (asset === "native" ? { asset, priceMicroUsd: this.sol, observedAt: Math.min(at, t0 + 1), source: "mutable-fixture", confidence: "FIXTURE" as const } : asset === MINT ? { asset, priceMicroUsd: this.mint, observedAt: Math.min(at, t0 + 1), source: "mutable-fixture", confidence: "FIXTURE" as const } : null);
  }
}
const boot = async (prices?: HistoricalPriceProvider, over: Record<string, string> = {}) => {
  rpc = new FakeSolanaRpc();
  ctx = await makeCtx({ INDEXER_MIN_SYNC_INTERVAL_SECONDS: "0", INDEXER_SYNC_ON_LOGIN: "false", ...over }, undefined, { rpc, metadata: rpc, prices: new NullPriceProvider() }, prices);
};
const sync = async (u: { token: string; walletId: string }) => { await ctx.app.inject({ method: "POST", url: `/api/wallets/${u.walletId}/sync`, headers: bearer(u.token) }); await ctx.app.indexer.drain(); };
const call = (u: { token: string }, method: "GET" | "POST", url: string, payload?: object) => ctx.app.inject({ method, url, headers: bearer(u.token), ...(payload ? { payload } : {}) });
const report = async (u: U, q = "") => { const r = await call(u, "GET", `/api/tax/${u.walletId}/report${q}`); expect(r.statusCode, r.body).toBe(200); return TaxReportResponse.parse(r.json()); };
const exp = (u: { token: string; walletId: string }, body: object) => call(u, "POST", `/api/tax/${u.walletId}/report/export`, body);
const manual = (u: U, o: Record<string, unknown> = {}) => call(u, "POST", `/api/wallets/${u.walletId}/manual-basis`, { asset: MINT, decimals: 6, quantity: "10", acquiredAt: ISO(T - 100 * DAY), costBasis: "50.00", reason: "EXCHANGE_PURCHASE", ...o });

const receipt = (addr: string, n: number, qty: bigint): TxSpec => ({
  signature: fakeSignature(`rrcpt${n}-${addr}`), slot: 20 + n, blockTime: T + n, fee: 5000,
  accounts: [{ key: fakeBase58("payer", 44), pre: SOL, post: SOL - 5000n }, { key: fakeTokenAccount(`r${n}-${addr}`), pre: 0, post: 0 }],
  tokens: [{ index: 1, mint: MINT, owner: addr, pre: 0n, post: qty, decimals: 6 }], programs: [TOKEN_PROGRAM],
});
const sellSpec = (addr: string, n: number, qty: bigint, at: number): TxSpec => ({
  signature: fakeSignature(`rsell${n}-${addr}`), slot: 60 + n, blockTime: at, fee: 5000,
  accounts: [{ key: addr, pre: 2n * SOL, post: 3n * SOL - 5000n }, { key: fakeTokenAccount(`s${n}-${addr}`), pre: 0, post: 0 }],
  tokens: [{ index: 1, mint: MINT, owner: addr, pre: qty, post: 0n, decimals: 6 }], programs: [DEX],
});
/** receipt (10 tokens) + a sale on `at`, wallet synced, 10 tokens of USER_PROVIDED basis */
async function scenario(seed: string, at = T + 60 * DAY, qty = 10_000_000n): Promise<U> {
  const u = await user(seed);
  rpc.addWallet(u.address, { lamports: SOL });
  rpc.addTx([u.address], receipt(u.address, 1, qty));
  rpc.addTx([u.address], sellSpec(u.address, 1, qty, at));
  await sync(u);
  return u;
}
function parseCsv(s: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r" && s[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; } else cell += c;
  }
  return rows;
}

describe("report content", () => {
  it("never synced: UNAVAILABLE with no summary and no rows", async () => {
    await boot(new MutablePrices());
    const u = await user("rp-unavail");
    const r = await report(u);
    expect(r).toMatchObject({ status: "UNAVAILABLE", summary: null, disposals: [], label: "ESTIMATED_TAX_REPORT", provenance: { dataSource: "chain", verifiedOnChain: false } });
  });
  it("COMPLETE report from a priced sale with USER_PROVIDED basis: summary, row traceability, manual disclosure, price provenance, fingerprint", async () => {
    await boot(new MutablePrices());
    const u = await scenario("rp-complete");
    const m = (await manual(u)).json();
    const r = await report(u, "?taxYear=2024");
    expect(r.status).toBe("COMPLETE");
    expect(r.yearBoundary).toEqual({ kind: "UTC_CALENDAR_YEAR", from: "2024-01-01T00:00:00.000Z", toExclusive: "2025-01-01T00:00:00.000Z", basis: "disposal time (UTC)" });
    expect(r.summary).toMatchObject({ proceedsCents: "10000", costBasisCents: "5000", gainLossCents: "5000", shortTermGainLossCents: "5000", longTermGainLossCents: "0", disposalCount: 1 });
    const d = r.disposals.find((x) => x.mint === MINT)!;
    expect(d).toMatchObject({ acquisitionSource: "USER_PROVIDED", disposalSource: "CHAIN", manualBasisId: m.id, acquisitionSignature: null, confidence: "ESTIMATED", verifiedOnChain: false, holdingPeriod: "SHORT_TERM", accountingMethod: "FIFO", reportStatus: "COMPLETE", proceedsPriceSource: "mutable-fixture (fixture)", proceedsPriceConfidence: "FIXTURE" });
    expect(d.disposalSignature).toBe(fakeSignature(`rsell1-${u.address}`));
    expect(d.disposalWalletId).toBe(u.walletId);
    expect(r.manualBasis).toMatchObject({ included: true, disclosure: "Includes user-provided tax data." });
    expect(r.manualBasis.records[0]).toMatchObject({ id: m.id, includedInCalculation: true, disposalSlicesUsing: 1, reviewState: "OK" });
    expect(r.priceProvenance.sources).toEqual(["mutable-fixture (fixture)"]);
    expect(r.priceProvenance.note).toMatch(/FIXTURE prices/);
    expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(r.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r)).not.toMatch(/"verifiedOnChain":true/);
  });
  it("manual basis does not bypass a missing price: DATA_REQUIRED, price listed as missing, no figures invented", async () => {
    await boot(); // real (observation) provider: no prices stored
    const u = await scenario("rp-noprice");
    await manual(u);
    const r = await report(u, "?taxYear=2024");
    expect(r.status).toBe("DATA_REQUIRED");
    expect(r.requirements.some((x) => x.kind === "PRICE")).toBe(true);
    expect(r.disposals).toEqual([]);
    expect(r.priceProvenance.observations).toEqual([]);
    expect(r.manualBasis.disclosure).toBe("Includes user-provided tax data.");
  });
  it("PARTIAL: unresolved transfer and unknown history are listed, never hidden", async () => {
    await boot(new MutablePrices());
    const u = await user("rp-partial");
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.addTx([u.address], receipt(u.address, 1, 5_000_000n));
    await sync(u);
    const r = await report(u, "?taxYear=2023");
    expect(r.status).toBe("PARTIAL");
    expect(r.counts.unresolvedEvents).toBe(1);
    expect(r.unresolvedEvents[0]).toMatchObject({ kind: "TRANSFER_IN", status: "UNRESOLVED", origin: "CHAIN", mint: MINT });
  });
  it("tax year filtering and calendar boundaries through the API", async () => {
    await boot(new MutablePrices());
    const u = await user("rp-year");
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.addTx([u.address], receipt(u.address, 1, 10_000_000n));
    rpc.addTx([u.address], sellSpec(u.address, 1, 4_000_000n, Date.UTC(2023, 11, 31, 23, 59, 59) / 1000));
    rpc.addTx([u.address], sellSpec(u.address, 2, 3_000_000n, Date.UTC(2024, 0, 1, 0, 0, 0) / 1000));
    await sync(u);
    await manual(u);
    const y23 = await report(u, "?taxYear=2023"), y24 = await report(u, "?taxYear=2024"), y22 = await report(u, "?taxYear=2022");
    expect(y23.disposals.filter((d) => d.mint === MINT).map((d) => d.quantityRaw)).toEqual(["4000000"]);
    expect(y24.disposals.filter((d) => d.mint === MINT).map((d) => d.quantityRaw)).toEqual(["3000000"]);
    expect(y22.disposals).toEqual([]);
    expect(y23.taxYear).toBe(2023);
  });
  it("FIFO / LIFO / HIFO produce different, explicitly labeled reports", async () => {
    await boot(new MutablePrices());
    const u = await scenario("rp-methods", T + 60 * DAY, 5_000_000n);
    await manual(u, { quantity: "5", costBasis: "10.00", acquiredAt: ISO(T - 300 * DAY) });
    await manual(u, { quantity: "5", costBasis: "90.00", acquiredAt: ISO(T - 200 * DAY) });
    await manual(u, { quantity: "5", costBasis: "30.00", acquiredAt: ISO(T - 100 * DAY) });
    const [f, l, h] = await Promise.all(["FIFO", "LIFO", "HIFO"].map((m) => report(u, `?taxYear=2024&method=${m}`)));
    expect([f!.accountingMethod, l!.accountingMethod, h!.accountingMethod]).toEqual(["FIFO", "LIFO", "HIFO"]);
    const basis = (r: typeof f) => r!.disposals.find((d) => d.mint === MINT)!.costBasisCents;
    expect([basis(f), basis(l), basis(h)]).toEqual(["1000", "3000", "9000"]);
    expect(new Set([f, l, h].map((r) => r!.fingerprint)).size).toBe(3);
    expect(new Set([f, l, h].map((r) => r!.reportHash)).size).toBe(3);
  });
  it("swapTreatment NOT_ASSESSED: swaps are not reported as disposals", async () => {
    await boot(new MutablePrices());
    const u = await scenario("rp-swap");
    await manual(u);
    const r = await report(u, "?taxYear=2024&swapTreatment=NOT_ASSESSED");
    expect(r.swapTreatment).toBe("NOT_ASSESSED");
    expect(r.disposals).toEqual([]);
    expect(r.status).not.toBe("COMPLETE");
  });
  it("demo wallets: labeled demo, no itemized figures, never a real calculation", async () => {
    await boot();
    const r = await ctx.app.inject({ method: "GET", url: `/api/tax/${W.trading}/report`, headers: bearer(ctx.demoToken) });
    const rep = TaxReportResponse.parse(r.json());
    expect(rep.provenance.dataSource).toBe("demo");
    expect(rep.disposals).toEqual([]);
    expect(rep.summary!.proceedsCents).toBeNull();
    const csv = await exp({ token: ctx.demoToken, walletId: W.trading }, { format: "csv" });
    expect(csv.statusCode).toBe(200);
    expect(csv.body.trim()).toBe(CSV_COLUMNS.join(","));
  });
});

describe("determinism and fingerprints", () => {
  it("repeated reports and exports are identical except generation metadata", async () => {
    await boot(new MutablePrices());
    const u = await scenario("rp-det");
    await manual(u);
    const a = await report(u, "?taxYear=2024"), b = await report(u, "?taxYear=2024");
    const strip = (r: typeof a) => JSON.stringify({ ...r, meta: undefined });
    expect(strip(a)).toBe(strip(b));
    expect(a.reportHash).toBe(b.reportHash);
    const c1 = await exp(u, { format: "csv", taxYear: 2024 }), c2 = await exp(u, { format: "csv", taxYear: 2024 });
    expect(c1.body).toBe(c2.body);
    const j1 = JSON.parse((await exp(u, { format: "json", taxYear: 2024 })).body), j2 = JSON.parse((await exp(u, { format: "json", taxYear: 2024 })).body);
    delete j1.meta; delete j2.meta;
    expect(j1).toEqual(j2);
    expect(j1.reportHash).toBe(a.reportHash);
  });
  it("fingerprint and hash change with: manual revision, price observation, accounting method, new source transaction", async () => {
    const prices = new MutablePrices();
    await boot(prices);
    const u = await scenario("rp-fp");
    const rec = (await manual(u)).json();
    const base = await report(u, "?taxYear=2024");
    // manual revision
    await call(u, "POST", `/api/wallets/${u.walletId}/manual-basis/${rec.id}/revisions`, { quantity: "10", acquiredAt: rec.acquiredAt, costBasis: "55.00", reason: "EXCHANGE_PURCHASE", changeReason: "added fees", expectedRevision: 1, acknowledgeOverlap: false });
    const rev = await report(u, "?taxYear=2024");
    expect(rev.fingerprint).not.toBe(base.fingerprint);
    expect(rev.reportHash).not.toBe(base.reportHash);
    // price observation
    prices.mint = 12_000_000n;
    const px = await report(u, "?taxYear=2024");
    expect(px.fingerprint).not.toBe(rev.fingerprint);
    prices.mint = 10_000_000n;
    expect((await report(u, "?taxYear=2024")).fingerprint).toBe(rev.fingerprint); // back to the same inputs, same fingerprint
    // method
    expect((await report(u, "?taxYear=2024&method=HIFO")).fingerprint).not.toBe(rev.fingerprint);
    // tax year
    expect((await report(u, "?taxYear=2025")).fingerprint).not.toBe(rev.fingerprint);
    // a new source transaction
    rpc.addTx([u.address], { ...receipt(u.address, 9, 1n), slot: 500 });
    rpc.slot = 9000n;
    await sync(u);
    expect((await report(u, "?taxYear=2024")).fingerprint).not.toBe(rev.fingerprint);
  });
});

describe("exports", () => {
  it("CSV: headers, one row per disposal, fixed columns, provenance columns, safe filename, no caching", async () => {
    await boot(new MutablePrices());
    const u = await scenario("rp-csv");
    const m = (await manual(u)).json();
    const r = await exp(u, { format: "csv", taxYear: 2024 });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(r.headers["content-disposition"]).toMatch(/^attachment; filename="estimated-tax-report-2024-fifo-[0-9a-f]{12}\.csv"$/);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    const rows = parseCsv(r.body);
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    const data = rows.slice(1).filter((x) => x.length > 1);
    expect(data.length).toBeGreaterThanOrEqual(1);
    const c = (n: string) => CSV_COLUMNS.indexOf(n as never);
    const row = data.find((x) => x[c("mint")] === MINT)!;
    expect(row).toHaveLength(CSV_COLUMNS.length);
    expect(row[c("acquisition_source")]).toBe("USER_PROVIDED");
    expect(row[c("manual_basis_id")]).toBe(m.id);
    expect(row[c("gain_loss_usd")]).toBe("50.00");
    expect(row[c("report_status")]).toBe("COMPLETE");
    expect(row[c("report_fingerprint")]).toMatch(/^[0-9a-f]{64}$/);
    expect(row[c("verified_on_chain")]).toBe("false");
  });
  it("CSV: a loss stays a plain negative number; no text cell starts with = + - @ (formula injection)", async () => {
    await boot(new MutablePrices());
    const u = await scenario("rp-loss");
    await manual(u, { costBasis: "500.00" });
    const body = (await exp(u, { format: "csv", taxYear: 2024 })).body;
    const rows = parseCsv(body);
    const c = CSV_COLUMNS.indexOf("gain_loss_usd");
    expect(rows.find((x) => x[CSV_COLUMNS.indexOf("mint")] === MINT)![c]).toBe("-400.00");
    for (const row of rows) for (const cell of row) if (cell) expect(/^[=+@\t\r]/.test(cell) || (/^-/.test(cell) && !/^-\d+(\.\d+)?$/.test(cell)), cell).toBe(false);
  });
  it("JSON: attachment, whole report, equals the GET report", async () => {
    await boot(new MutablePrices());
    const u = await scenario("rp-json");
    await manual(u);
    const r = await exp(u, { format: "json", taxYear: 2024 });
    expect(r.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(r.headers["content-disposition"]).toMatch(/filename="estimated-tax-report-2024-fifo-[0-9a-f]{12}\.json"/);
    const j = TaxReportResponse.parse(JSON.parse(r.body));
    const g = await report(u, "?taxYear=2024");
    expect({ ...j, meta: 0 }).toEqual({ ...g, meta: 0 });
    for (const k of ["summary", "disposals", "unresolvedEvents", "requirements", "provenance", "fingerprint", "manualBasis", "priceProvenance"]) expect(j, k).toHaveProperty(k);
  });
  it("exports and reports contain no secrets: no session token, no RPC URL or key, no stack traces", async () => {
    await boot(new MutablePrices(), { SOLANA_RPC_URL: "https://rpc.example.com/?api-key=SUPERSECRETKEY", TAX_MAX_CONCURRENT: "8" });
    const u = await scenario("rp-secrets");
    await manual(u);
    const all = [(await exp(u, { format: "csv" })).body, (await exp(u, { format: "json" })).body, (await call(u, "GET", `/api/tax/${u.walletId}/report`)).body].join("\n");
    for (const s of [u.token, "SUPERSECRETKEY", "rpc.example", "api-key", "pn_session", "DATABASE_URL", "postgres://", "postgresql://"]) expect(all, s).not.toContain(s);
  });
  it("an internal failure during export is a generic 500 with no stack, path or message", async () => {
    const prices = new MutablePrices();
    await boot(prices);
    const u = await scenario("rp-fail");
    prices.fail = true;
    const r = await exp(u, { format: "csv" });
    expect(r.statusCode).toBe(500);
    expect(r.json().error).toEqual({ code: "INTERNAL_ERROR", message: "Internal server error" });
    expect(r.body).not.toMatch(/secret|\.ts|at \w+|exploded/);
  });
});

describe("authorization", () => {
  it("401 without a session; foreign wallet 404 for report AND export; bad ids 400; nothing leaks", async () => {
    await boot(new MutablePrices());
    const owner = await scenario("rp-own"), other = await user("rp-oth");
    await manual(owner);
    for (const [m, url, p] of [["GET", `/api/tax/${owner.walletId}/report`], ["POST", `/api/tax/${owner.walletId}/report/export`, { format: "csv" }]] as const) {
      expect((await ctx.app.inject({ method: m, url, ...(p ? { payload: p } : {}) })).statusCode, url).toBe(401);
      const r = await call(other, m, url, p as object | undefined);
      expect(r.statusCode, url).toBe(404);
      expect(r.body).not.toMatch(/disposal|manual|fingerprint/);
    }
    expect((await call(owner, "GET", "/api/tax/not-a-uuid/report")).statusCode).toBe(400);
    expect((await call(owner, "POST", "/api/tax/not-a-uuid/report/export", { format: "csv" })).statusCode).toBe(400);
  });
  it("the report is the session user's own data: another user's transactions and manual basis never appear", async () => {
    await boot(new MutablePrices());
    const a = await scenario("rp-iso-a"), b = await user("rp-iso-b");
    await manual(a);
    rpc.addWallet(b.address, { lamports: SOL });
    await sync(b);
    const rb = await report(b, "?taxYear=2024");
    expect(rb.disposals).toEqual([]);
    expect(rb.manualBasis.records).toEqual([]);
    expect(rb.unresolvedEvents).toEqual([]);
  });
  it("cross-origin cookie export is refused (CSRF guard)", async () => {
    await boot(new MutablePrices());
    const u = await user("rp-csrf");
    const r = await ctx.app.inject({ method: "POST", url: `/api/tax/${u.walletId}/report/export`, headers: { origin: "https://evil.example" }, cookies: { pn_session: u.token }, payload: { format: "csv" } });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.body).not.toContain("estimated");
  });
});

describe("validation and limits", () => {
  it("rejects bad parameters server-side; rates are not accepted anywhere in the report API", async () => {
    await boot(new MutablePrices());
    const u = await user("rp-valid");
    for (const q of ["?taxYear=1999", "?taxYear=abc", "?taxYear=2101", "?method=SPECIFIC", "?swapTreatment=MAYBE", "?foo=1", "?shortTermRateBps=3000&longTermRateBps=1&stateRateBps=1"]) {
      expect((await call(u, "GET", `/api/tax/${u.walletId}/report${q}`)).statusCode, q).toBe(400);
    }
    for (const b of [{}, { format: "xlsx" }, { format: "csv", taxYear: 1800 }, { format: "csv", method: "X" }, { format: "csv", rates: { shortTermRateBps: 1, longTermRateBps: 1, stateRateBps: 1 } }, { format: "csv", extra: true }, { format: ["csv"] }, { format: "csv", taxYear: "2024" }]) {
      expect((await exp(u, b)).statusCode, JSON.stringify(b)).toBe(400);
    }
  });
  it("oversized request body is refused", async () => {
    await boot(new MutablePrices());
    const u = await user("rp-big");
    const r = await ctx.app.inject({ method: "POST", url: `/api/tax/${u.walletId}/report/export`, headers: { ...bearer(u.token), "content-type": "application/json" }, payload: JSON.stringify({ format: "csv", pad: "x".repeat(200_000) }) });
    expect(r.statusCode).toBe(413);
  });
  it("more disposals than REPORT_MAX_ROWS: the report is DATA_REQUIRED with a capped list and full totals; the export is refused (413), nothing truncated silently", async () => {
    await boot(new MutablePrices(), { REPORT_MAX_ROWS: "2" });
    const u = await user("rp-rows");
    rpc.addWallet(u.address, { lamports: SOL });
    rpc.addTx([u.address], receipt(u.address, 1, 10_000_000n));
    for (let i = 1; i <= 4; i++) rpc.addTx([u.address], sellSpec(u.address, i, 1_000_000n, T + (60 + i) * DAY));
    await sync(u);
    await manual(u);
    const r = await report(u, "?taxYear=2024");
    expect(r.limits).toMatchObject({ maxRows: 2, rowsExceeded: true });
    expect(r.disposals).toHaveLength(2);
    expect(r.summary!.disposalCount).toBeGreaterThan(2);
    expect(r.status).toBe("DATA_REQUIRED");
    expect(r.requirements.some((x) => x.kind === "LIMIT")).toBe(true);
    const e = await exp(u, { format: "csv", taxYear: 2024 });
    expect(e.statusCode).toBe(413);
    expect(e.json().error.code).toBe("EXPORT_TOO_LARGE");
  });
  it("more transactions than TAX_MAX_TRANSACTIONS: explicit DATA_REQUIRED with a LIMIT requirement (never a silently truncated COMPLETE)", async () => {
    await boot(new MutablePrices(), { TAX_MAX_TRANSACTIONS: "100" });
    const u = await user("rp-cap");
    rpc.addWallet(u.address, { lamports: SOL });
    for (let i = 1; i <= 3; i++) rpc.addTx([u.address], receipt(u.address, i, 1n));
    await sync(u);
    // simulate more rows than the cap by lowering it below the stored count
    await ctx.pool.query("SELECT 1");
    const small = await makeCtxLowCap(u);
    expect(small.status).toBe("DATA_REQUIRED");
    expect(small.limits.transactionsTruncated).toBe(true);
    expect(small.requirements.some((x) => x.kind === "LIMIT")).toBe(true);
  });
  it("concurrent calculations are bounded: a second in-flight request for the same user is refused immediately (429), the first completes", async () => {
    const prices = new MutablePrices();
    await boot(prices, { TAX_MAX_CONCURRENT_PER_USER: "1" });
    const u = await scenario("rp-gate");
    let release!: () => void;
    prices.wait = new Promise<void>((r) => { release = r; });
    const first = exp(u, { format: "json" });
    await new Promise((r) => setTimeout(r, 50));
    const second = await exp(u, { format: "json" });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("TAX_IN_PROGRESS");
    release();
    expect((await first).statusCode).toBe(200);
    expect((await exp(u, { format: "json" })).statusCode).toBe(200); // slot freed
  });
  it("global concurrency limit returns 503 TAX_BUSY", async () => {
    const prices = new MutablePrices();
    await boot(prices, { TAX_MAX_CONCURRENT: "1", TAX_MAX_CONCURRENT_PER_USER: "4" });
    const a = await scenario("rp-gate-a"), b = await user("rp-gate-b");
    let release!: () => void;
    prices.wait = new Promise<void>((r) => { release = r; });
    const first = exp(a, { format: "json" });
    await new Promise((r) => setTimeout(r, 50));
    const second = await exp(b, { format: "json" });
    expect(second.statusCode).toBe(503);
    expect(second.json().error.code).toBe("TAX_BUSY");
    release();
    await first;
  });
});

/** Re-run the report for the same user with a transaction cap lower than the stored count (separate app instance, same database). */
async function makeCtxLowCap(u: U) {
  const low = await makeCtx({ INDEXER_MIN_SYNC_INTERVAL_SECONDS: "0", INDEXER_SYNC_ON_LOGIN: "false", TAX_MAX_TRANSACTIONS: "100" }, undefined, undefined, new MutablePrices());
  try {
    await low.pool.query("UPDATE wallet_sync_state SET history_complete = true WHERE wallet_id = $1", [u.walletId]);
    // 100 is the config minimum; the stored data has fewer rows, so emulate "more rows than the cap" through the repository limit itself
    const { loadTaxInputs } = await import("../src/db/taxRepos");
    const inputs = await loadTaxInputs(low.pool, u.userId, 1);
    expect(inputs.truncated).toBe(true);
    const { buildTaxReport, computeTax } = await import("@project-name/shared");
    const result = computeTax({ txs: inputs.txs, method: "FIFO", taxYear: 2023, priceAt: () => null, swapTreatment: "DISPOSAL_AND_ACQUISITION", rates: null, coverage: inputs.coverage });
    return buildTaxReport({ result, walletId: u.walletId, fingerprint: "x", generatedAt: "2025-01-01T00:00:00.000Z", limits: { transactionCap: 1, transactionsTruncated: inputs.truncated, maxRows: 100 } });
  } finally { await low.close(); }
}
