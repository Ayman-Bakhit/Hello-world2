"use client";

import type { TaxReportResponse } from "@project-name/shared";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { describeApiError } from "@/lib/api/errors";
import { useResource } from "@/lib/api/useResource";
import { downloadText } from "@/lib/download";
import { formatDate, formatUsd } from "@/lib/format";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { DataSourceBadge } from "./DataSource";
import { ApiErrorState, ResourceView } from "./states";
import { StatCard } from "./StatCard";

const field = "num rounded border border-line-strong bg-canvas px-2 py-1 text-sm";
type Q = { taxYear?: number; method?: "FIFO" | "LIFO" | "HIFO"; swapTreatment?: "DISPOSAL_AND_ACQUISITION" | "NOT_ASSESSED" };

const STATUS = {
  COMPLETE: { label: "COMPLETE (ESTIMATE)", tone: "good", text: "Every indexed transaction is accounted for. This is still an estimate based on data that is not independently verified." },
  PARTIAL: { label: "PARTIAL", tone: "demo", text: "Tax data incomplete. Some transactions, history or holdings are missing or unresolved, so figures may be missing items." },
  DATA_REQUIRED: { label: "DATA REQUIRED", tone: "bad", text: "Tax data incomplete. Prices, cost basis or timestamps are missing, or the data exceeds supported limits. Do not treat these figures as a total." },
  UNAVAILABLE: { label: "UNAVAILABLE", tone: "neutral", text: "Tax data unavailable. Nothing has been indexed for this account yet, so there is nothing to report." },
} as const;
const usd = (v: string | null) => (v === null ? "—" : formatUsd(BigInt(v), { cents: true }));
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s);

/** Pure view of one report. Missing numbers are dashes with the reason; incompleteness is always stated. */
export function TaxReportView({ report }: { report: TaxReportResponse }) {
  const s = STATUS[report.status];
  const sum = report.summary;
  const demo = report.provenance.dataSource === "demo";
  const sub = report.status === "COMPLETE" ? undefined : report.status === "UNAVAILABLE" ? "Unavailable" : "Tax data incomplete";
  const num = (v: string | null | undefined) => (sum && v !== undefined ? usd(v) : "—");
  return (
    <>
      <section aria-label="Report status" className="mb-4 rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={demo ? "demo" : "info"}>{demo ? "DEMO DATA" : "LIVE DATA (UNVERIFIED)"}</Badge>
          <Badge tone={s.tone}>{s.label}</Badge>
          <Badge tone="neutral">{report.accountingMethod}</Badge>
          <span className="text-xs text-muted">Tax year {report.taxYear} · {formatDate(report.yearBoundary.from)} to {formatDate(new Date(Date.parse(report.yearBoundary.toExclusive) - 1).toISOString())} UTC, by disposal time</span>
        </div>
        <p className="mt-2 text-sm" role={report.status === "COMPLETE" ? undefined : "alert"}>{demo ? "Demo fixture: fictional aggregate figures. There are no itemized transactions behind them." : s.text}</p>
        {report.manualBasis.disclosure ? <p className="mt-2 text-sm font-semibold text-warn">{report.manualBasis.disclosure} <Badge tone="demo">USER-PROVIDED TAX DATA</Badge></p> : null}
        {report.requirements.length > 0 ? (
          <ul className="mt-3 space-y-1.5 text-xs">
            {report.requirements.map((r) => (
              <li key={`${r.kind}-${r.message}`} className="flex gap-2">
                <span className={`shrink-0 font-semibold tracking-wide ${r.severity === "blocks_total" ? "text-loss" : r.severity === "incomplete" ? "text-warn" : "text-faint"}`}>
                  {r.kind === "PRICE" ? "PRICE DATA UNAVAILABLE" : r.kind === "COST_BASIS" ? "DATA REQUIRED: COST BASIS" : r.kind === "LIMIT" ? "SUPPORTED LIMIT EXCEEDED" : r.kind === "BASIS_REVIEW" ? "BASIS NEEDS REVIEW" : r.kind === "TRANSFER_MATCH" ? "UNRESOLVED TRANSFERS" : r.kind === "CLASSIFICATION" ? "UNKNOWN" : r.kind} ({r.count})
                </span>
                <span className="text-muted">{r.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Realized proceeds" value={num(sum?.proceedsCents)} sub={sub} />
        <StatCard label="Cost basis" value={num(sum?.costBasisCents)} sub={sub} />
        <StatCard label="Net gain / loss" value={num(sum?.gainLossCents)} tone={sum ? (BigInt(sum.gainLossCents) > 0n ? "gain" : BigInt(sum.gainLossCents) < 0n ? "loss" : "neutral") : "neutral"} sub={sub} />
        <StatCard label="Short-term" value={num(sum?.shortTermGainLossCents)} sub={sub} />
        <StatCard label="Long-term" value={num(sum?.longTermGainLossCents)} sub={sub} />
        <StatCard label="Unresolved" value={String(report.counts.unresolvedEvents + report.counts.dataRequiredEvents)} sub={`${report.counts.unknownEvents} unknown · ${report.counts.dataRequiredEvents} data required`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Where the numbers come from" right={<DataSourceBadge dataSource={report.provenance.dataSource} verifiedOnChain={report.provenance.verifiedOnChain} />}>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            <li>{report.provenance.chainDataNote}</li>
            <li>{report.priceProvenance.note} {report.priceProvenance.sources.length ? `Sources: ${report.priceProvenance.sources.join(", ")}.` : "Price data unavailable: no prices were used."}</li>
            <li>{report.provenance.userProvidedNote}</li>
            <li>Fees are recorded, not added to cost basis or proceeds. Swaps: {report.swapTreatment === "DISPOSAL_AND_ACQUISITION" ? "treated as a disposal plus an acquisition under an explicit assumption" : "not assessed"}.</li>
            <li>Calculation fingerprint <span className="font-mono">{report.fingerprint.slice(0, 16)}…</span> · report hash <span className="font-mono">{report.reportHash.slice(0, 16)}…</span></li>
          </ul>
        </Card>
        <Card title="User-provided records used" right={<Badge tone="demo">USER-PROVIDED TAX DATA</Badge>}>
          {report.manualBasis.records.length === 0 ? <p className="text-xs text-muted">No user-provided cost basis is included.</p> : (
            <ul className="space-y-1 text-xs">
              {report.manualBasis.records.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-faint" title={m.id}>{short(m.id)}</span>
                  <span className="num">{m.quantityRaw} base units of <span title={m.mint ?? undefined}>{m.mint ? short(m.mint) : m.asset}</span></span>
                  <span className="num text-muted">{usd(m.costBasisCents)}</span>
                  <Badge tone={m.includedInCalculation ? "good" : "demo"}>{m.includedInCalculation ? `INCLUDED · used in ${m.disposalSlicesUsing} disposal(s)` : `EXCLUDED · ${m.reviewState.replace("_", " ")}`}</Badge>
                </li>
              ))}
            </ul>
          )}
          {report.manualBasis.records.length > 0 ? <Button variant="secondary" className="mt-3" onClick={() => document.getElementById("manual-basis")?.scrollIntoView({ behavior: "smooth" })}>VIEW RECORDS AND AUDIT HISTORY</Button> : null}
        </Card>
      </div>

      <Card title="Realized disposals" className="mt-4">
        {report.limits.rowsExceeded ? <p role="alert" className="mb-3 text-xs text-warn">More disposals exist than this list shows ({report.summary?.disposalCount}). Totals above include all of them; the list is capped at {report.limits.maxRows}.</p> : null}
        {report.disposals.length === 0 ? <p className="py-4 text-center text-sm text-muted">No realized disposals in this tax year from the data available.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead><tr className="border-b border-line text-left">{["Disposed", "Asset", "Quantity", "Acquired", "Acquisition source", "Cost basis", "Proceeds", "Gain / loss", "Term", "Transaction"].map((h) => <th key={h} scope="col" className="eyebrow px-2 py-2 font-normal">{h}</th>)}</tr></thead>
              <tbody>
                {report.disposals.map((d) => (
                  <tr key={d.id} className="border-b border-line/60 last:border-0">
                    <td className="num px-2 py-2 text-muted">{formatDate(d.disposedAt)}</td>
                    <td className="px-2 py-2 font-semibold" title={d.mint ?? undefined}>{d.mint ? short(d.mint) : d.asset}</td>
                    <td className="num px-2 py-2">{d.quantity}</td>
                    <td className="num px-2 py-2 text-muted">{formatDate(d.acquiredAt)}</td>
                    <td className="px-2 py-2">{d.acquisitionSource === "USER_PROVIDED" ? <Badge tone="demo">USER-PROVIDED</Badge> : <span className="text-muted">Indexed transaction</span>}</td>
                    <td className="num px-2 py-2">{usd(d.costBasisCents)}</td>
                    <td className="num px-2 py-2">{usd(d.proceedsCents)}{d.proceedsPriceConfidence === "FIXTURE" ? <span className="block text-faint">fixture price</span> : null}</td>
                    <td className={`num px-2 py-2 ${BigInt(d.gainLossCents) < 0n ? "text-loss" : "text-gain"}`}>{usd(d.gainLossCents)}</td>
                    <td className="px-2 py-2">{d.holdingPeriod === "LONG_TERM" ? "Long" : "Short"}</td>
                    <td className="px-2 py-2 font-mono text-faint" title={d.disposalSignature}>{short(d.disposalSignature)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {report.unresolvedEvents.length > 0 ? (
        <Card title="Unresolved and data-required events" className="mt-4">
          <ul className="space-y-1.5 text-xs">
            {report.unresolvedEvents.slice(0, 50).map((e) => (
              <li key={e.id} className="flex flex-wrap gap-2">
                <Badge tone={e.status === "DATA_REQUIRED" ? "bad" : "demo"}>{e.status.replace("_", " ")}</Badge>
                <span className="font-semibold">{e.kind.replace("_", " ")}</span>
                <span className="font-mono text-faint" title={e.signature}>{e.signature ? short(e.signature) : "user record"}</span>
                <span className="text-muted">{e.reason}</span>
              </li>
            ))}
          </ul>
          {report.unresolvedEvents.length > 50 ? <p className="mt-2 text-xs text-faint">Showing 50 of {report.unresolvedEvents.length}. The JSON export lists all of them.</p> : null}
        </Card>
      ) : null}

      <div className="mt-4 space-y-1 text-xs text-faint">{report.disclaimer.map((d) => <p key={d}>{d}</p>)}</div>
    </>
  );
}

/** Controls, loading and downloads. Parameters are sent as a POST body for exports; nothing financial is put in a URL. */
export function TaxReportPanel({ walletId, refreshKey }: { walletId: string; refreshKey: number }) {
  const [year, setYear] = useState("");
  const [method, setMethod] = useState<"" | "FIFO" | "LIFO" | "HIFO">("");
  const [swap, setSwap] = useState<"" | "DISPOSAL_AND_ACQUISITION" | "NOT_ASSESSED">("");
  const [q, setQ] = useState<Q>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"csv" | "json" | null>(null);
  const [dlErr, setDlErr] = useState<ReturnType<typeof describeApiError> | null>(null);
  const res = useResource(`tax-report:${walletId}:${JSON.stringify(q)}:${refreshKey}`, () => api.getTaxReport(walletId, q));

  const apply = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (year.trim() && !/^\d{4}$/.test(year.trim())) { setFormErr("Tax year must be 4 digits."); return; }
    setFormErr(null);
    setQ({ ...(year.trim() ? { taxYear: Number(year.trim()) } : {}), ...(method ? { method } : {}), ...(swap ? { swapTreatment: swap } : {}) });
  };
  const download = async (format: "csv" | "json") => {
    setBusy(format); setDlErr(null);
    try {
      const f = await api.exportTaxReport(walletId, { format, ...q });
      downloadText(f.filename, f.text, `${f.mime};charset=utf-8`);
    } catch (e) { setDlErr(describeApiError(e)); } finally { setBusy(null); }
  };
  const ok = res.status === "ok" ? res.data : null;
  return (
    <section aria-label="Tax report" className="mt-8">
      <h2 className="text-lg font-semibold tracking-tight">TAX REPORT</h2>
      <p className="mt-1 text-sm text-muted">Estimated tax report from the data available. For planning and review only: it is not a filing and nothing is submitted anywhere.</p>
      <form className="mt-3 grid gap-3 rounded-lg border border-line bg-surface p-4 text-sm sm:grid-cols-4" onSubmit={apply}>
        <label className="grid gap-1"><span className="eyebrow">Tax year (UTC calendar year)</span><input className={field} inputMode="numeric" placeholder="current year" value={year} onChange={(e) => setYear(e.target.value)} /></label>
        <label className="grid gap-1"><span className="eyebrow">Accounting method</span>
          <select className={field} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="">FIFO (default)</option><option value="FIFO">FIFO</option><option value="LIFO">LIFO</option><option value="HIFO">HIFO</option></select></label>
        <label className="grid gap-1"><span className="eyebrow">Swap treatment</span>
          <select className={field} value={swap} onChange={(e) => setSwap(e.target.value as typeof swap)}><option value="">Disposal + acquisition (assumption)</option><option value="DISPOSAL_AND_ACQUISITION">Disposal + acquisition (assumption)</option><option value="NOT_ASSESSED">Not assessed</option></select></label>
        <div className="flex items-end"><Button type="submit" variant="secondary">UPDATE REPORT</Button></div>
        {formErr ? <p role="alert" className="text-xs text-loss sm:col-span-4">{formErr}</p> : null}
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!ok || busy !== null} onClick={() => void download("csv")}>{busy === "csv" ? "PREPARING…" : "DOWNLOAD CSV"}</Button>
        <Button variant="secondary" disabled={!ok || busy !== null} onClick={() => void download("json")}>{busy === "json" ? "PREPARING…" : "DOWNLOAD JSON"}</Button>
        <span className="text-xs text-faint">One row per realized disposal (CSV) or the full report with provenance (JSON). Generated from the data of the signed-in account only.</span>
      </div>
      {dlErr ? <div className="mt-3"><ApiErrorState error={dlErr} /></div> : null}
      <div className="mt-4">
        <ResourceView resource={res} loadingLabel="Building report">{(r) => <TaxReportView report={r} />}</ResourceView>
      </div>
    </section>
  );
}
