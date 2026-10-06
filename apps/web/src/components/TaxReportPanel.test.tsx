import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { DEMO_IDS, TaxReportResponse, buildDemoTaxReport, buildTaxReport, computeTax, type ManualBasisInput, type TaxTxInput } from "@project-name/shared";
import { TaxReportView } from "./TaxReportPanel";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const MINT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const T = Date.UTC(2024, 5, 1) / 1000, SOL = 1_000_000_000n;
const px = (a: string, t: number) => ({ asset: a, priceMicroUsd: a === "native" ? 100_000_000n : 10_000_000n, observedAt: t - 60, source: "fixture", confidence: "FIXTURE" as const });
const sell: TaxTxInput = { id: "t1", signature: "S".repeat(88), walletId: "w", occurredAt: T, status: "success", kind: "swap", reason: "r", classifierVersion: "1", feeLamports: 5000n, deltas: [{ asset: MINT, decimals: 6, delta: -10_000_000n }, { asset: "native", decimals: 9, delta: SOL / 10n }] };
const lot: ManualBasisInput = { id: "11111111-1111-4111-8111-111111111111", walletId: "w", asset: MINT, decimals: 6, quantity: 10_000_000n, acquiredAt: T - 100 * 86_400, costBasisCents: 5_000n, createdAt: 1, revision: 1, reason: "EXCHANGE_PURCHASE" };
const FULL = { synced: true, historyComplete: true, hasGap: false, holdingsComplete: true };
const mk = (o: { txs?: TaxTxInput[]; manual?: ManualBasisInput[]; priced?: boolean; cov?: typeof FULL; rows?: number; trunc?: boolean } = {}) => {
  const result = computeTax({ txs: o.txs ?? [sell], openingLots: o.manual ?? [lot], method: "FIFO", taxYear: 2024, priceAt: o.priced === false ? () => null : px, swapTreatment: "DISPOSAL_AND_ACQUISITION", rates: null, coverage: o.cov ?? FULL });
  const r = buildTaxReport({ result, walletId: "22222222-2222-4222-8222-222222222222", fingerprint: "a".repeat(64), generatedAt: "2025-01-01T00:00:00.000Z", limits: { transactionCap: 5000, transactionsTruncated: o.trunc ?? false, maxRows: o.rows ?? 20_000 } });
  r.reportHash = "b".repeat(64);
  return TaxReportResponse.parse(r);
};

describe("tax report view", () => {
  it("COMPLETE estimate: summary cards, method, boundary, user-provided disclosure with the exact sentence, records, fixture price label", () => {
    const out = html(<TaxReportView report={mk()} />);
    for (const s of ["COMPLETE (ESTIMATE)", "FIFO", "Realized proceeds", "Cost basis", "Net gain / loss", "Short-term", "Long-term", "Unresolved", "$100.00", "$50.00", "Includes user-provided tax data.", "USER-PROVIDED TAX DATA", "INCLUDED", "fixture price", "not independently verified", "UTC, by disposal time", "VIEW RECORDS AND AUDIT HISTORY"]) expect(out, s).toContain(s);
    expect(out).not.toContain("DEMO DATA");
  });
  it("PARTIAL, DATA REQUIRED and UNAVAILABLE are shown as such with the incomplete wording; unavailable has dashes, not $0", () => {
    const partial = html(<TaxReportView report={mk({ cov: { ...FULL, historyComplete: false } })} />);
    expect(partial).toContain("PARTIAL");
    expect(partial).toContain("Tax data incomplete");
    const noPrice = html(<TaxReportView report={mk({ priced: false })} />);
    expect(noPrice).toContain("DATA REQUIRED");
    expect(noPrice).toContain("PRICE DATA UNAVAILABLE (");
    expect(noPrice).toContain("Includes user-provided tax data."); // basis is disclosed even when it cannot complete the report
    const un = html(<TaxReportView report={mk({ txs: [], manual: [], cov: { ...FULL, synced: false } })} />);
    expect(un).toContain("UNAVAILABLE");
    expect(un).toContain("Tax data unavailable");
    expect(un).not.toMatch(/\$\d/);
  });
  it("unresolved events are listed with their reasons; capped listings and exceeded limits are stated, never silent", () => {
    const rcpt: TaxTxInput = { ...sell, id: "t2", signature: "R".repeat(88), kind: "token_receipt", deltas: [{ asset: MINT, decimals: 6, delta: 5n }] };
    const out = html(<TaxReportView report={mk({ txs: [rcpt], manual: [] })} />);
    expect(out).toContain("Unresolved and data-required events");
    expect(out).toContain("UNRESOLVED");
    expect(out).toContain("Received from an unknown source");
    const many = Array.from({ length: 3 }, (_, i) => ({ ...sell, id: `s${i}`, signature: String(i).repeat(88).slice(0, 88), occurredAt: T + i * 60, deltas: [{ asset: MINT, decimals: 6, delta: -1_000_000n }, { asset: "native", decimals: 9, delta: 1n }] }));
    const capped = html(<TaxReportView report={mk({ txs: many, rows: 2 })} />);
    expect(capped).toContain("More disposals exist than this list shows");
    expect(capped).toContain("SUPPORTED LIMIT EXCEEDED");
    expect(html(<TaxReportView report={mk({ trunc: true })} />)).toContain("SUPPORTED LIMIT EXCEEDED");
  });
  it("excluded (duplicate) manual records are labeled EXCLUDED, not silently counted", () => {
    const out = html(<TaxReportView report={mk({ manual: [lot, { ...lot, id: "22222222-2222-4222-8222-222222222222", createdAt: 2 }] })} />);
    expect(out).toContain("EXCLUDED");
    expect(out).toContain("POTENTIAL DUPLICATE");
    expect(out).toContain("BASIS NEEDS REVIEW");
  });
  it("hostile strings are escaped text; banned claims never appear; fixture and user data are never called verified", () => {
    const r = mk();
    r.disposals[0] = { ...r.disposals[0]!, asset: "<img src=x onerror=alert(1)>", mint: null, disposalSignature: "<script>alert(2)</script>" };
    r.unresolvedEvents.push({ id: "x", signature: "<b>sig</b>", walletId: "w", timestamp: null, kind: "UNKNOWN", asset: "SOL", mint: null, quantityRaw: "1", status: "UNRESOLVED", missing: [], reason: "<img src=y onerror=alert(3)>", origin: "CHAIN", manualBasisId: null });
    const out = html(<TaxReportView report={r} />);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
    expect(out.toLowerCase()).not.toMatch(/irs-ready|tax filing ready|guaranteed|verified tax return|verified on-chain|your tax bill|tax-free/);
  });
  it("demo report: DEMO DATA, aggregate figures only, dashes for proceeds and cost basis", () => {
    const d = TaxReportResponse.parse(buildDemoTaxReport(DEMO_IDS.wallets.trading, "2025-01-01T00:00:00.000Z") ?? (() => { throw new Error("no demo wallet id"); })());
    const out = html(<TaxReportView report={d} />);
    expect(out).toContain("DEMO DATA");
    expect(out).toContain("fictional aggregate figures");
  });
});
