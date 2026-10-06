"use client";

import type { TaxDetailsResponse, TaxResponse } from "@project-name/shared";
import { useState } from "react";
import { EMPTY_TAX_DRAFT, draftToQuery, type TaxFormDraft, type TaxQueryParams } from "@/lib/taxQuery";
import { formatAmount, formatDate, formatUsd } from "@/lib/format";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";

type Status = TaxResponse["status"];
const STATUS: Record<Status, { label: string; tone: "good" | "demo" | "bad" | "neutral"; headline: string }> = {
  COMPLETE: { label: "COMPLETE (ESTIMATE)", tone: "good", headline: "Every indexed transaction is accounted for. Still an estimate, based on chain data that is not independently verified." },
  PARTIAL: { label: "PARTIAL", tone: "demo", headline: "Tax data incomplete. Some transactions, history or holdings are missing or unresolved, so these figures may be missing items." },
  DATA_REQUIRED: { label: "DATA REQUIRED", tone: "bad", headline: "Tax data incomplete. Prices, cost basis or timestamps are missing, so these figures must not be treated as a total." },
  UNAVAILABLE: { label: "UNAVAILABLE", tone: "neutral", headline: "Tax data unavailable. Nothing has been indexed for this account yet, so no figures can be shown." },
};

/** Status + why. Never styled as "done" unless the API says COMPLETE. */
export function TaxStatusPanel({ tax }: { tax: TaxResponse }) {
  const s = STATUS[tax.status];
  const demo = tax.dataSource === "demo";
  return (
    <section aria-label="Calculation status" className="mb-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={demo ? "demo" : "info"}>{demo ? "DEMO DATA" : "LIVE DATA (UNVERIFIED)"}</Badge>
        <Badge tone={s.tone}>{s.label}</Badge>
        <Badge tone="neutral">{tax.costBasisMethod}{tax.methodSource === "default" ? " (DEFAULT)" : tax.methodSource === "demo_fixture" ? " (DEMO)" : ""}</Badge>
        <span className="text-xs text-muted">Tax year {tax.taxYear}</span>
      </div>
      <p className="mt-2 text-sm" role={tax.status === "COMPLETE" ? undefined : "alert"}>{demo ? "Demo fixture: fictional events with example tax rates." : s.headline}</p>
      {tax.requirements.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-xs">
          {tax.requirements.map((r) => (
            <li key={r.kind} className="flex gap-2">
              <span className={`shrink-0 font-semibold tracking-wide ${r.severity === "blocks_total" ? "text-loss" : r.severity === "incomplete" ? "text-warn" : "text-faint"}`}>
                {r.kind === "PRICE" ? "PRICE DATA UNAVAILABLE" : r.kind === "COST_BASIS" ? "DATA REQUIRED: COST BASIS" : r.kind === "TRANSFER_MATCH" ? "UNRESOLVED TRANSFERS" : r.kind === "CLASSIFICATION" ? "UNKNOWN" : r.kind === "RATES" ? "RATES REQUIRED" : r.kind}
                {" "}({r.count})
              </span>
              <span className="text-muted">{r.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {tax.calculation ? (
        <p className="mt-3 text-xs text-faint">
          Fees are recorded, not added to cost basis or proceeds. Swaps: {tax.calculation.swapTreatment === "DISPOSAL_AND_ACQUISITION" ? "treated as a disposal plus an acquisition under an explicit assumption (not a legal conclusion)" : "not assessed"}.
          {" "}Price sources: {tax.calculation.priceSources.length ? tax.calculation.priceSources.join(", ") : "none"}. Input fingerprint {tax.calculation.inputFingerprint.slice(0, 12)}…
        </p>
      ) : null}
    </section>
  );
}

const field = "num rounded border border-line-strong bg-canvas px-2 py-1 text-sm";

/** Method / year / rates. Nothing is chosen silently: empty means "server default", and the response says which was used. */
export function TaxInputsForm({ onApply, showMethod = true }: { onApply: (q: TaxQueryParams) => void; showMethod?: boolean }) {
  const [d, setD] = useState<TaxFormDraft>(EMPTY_TAX_DRAFT);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof TaxFormDraft) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }) as TaxFormDraft);
  return (
    <Card title="Calculation inputs">
      <form
        className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          const r = draftToQuery(d);
          if (!r.ok) setErr(r.error);
          else { setErr(null); onApply(r.query); }
        }}
      >
        <label className="grid gap-1"><span className="eyebrow">Tax year</span><input className={field} inputMode="numeric" placeholder="current year" value={d.year} onChange={set("year")} /></label>
        {showMethod ? (
          <>
            <label className="grid gap-1"><span className="eyebrow">Accounting method</span>
              <select className={field} value={d.method} onChange={set("method")}><option value="">FIFO (default)</option><option value="FIFO">FIFO</option><option value="LIFO">LIFO</option><option value="HIFO">HIFO</option></select>
            </label>
            <label className="grid gap-1"><span className="eyebrow">Swaps</span>
              <select className={field} value={d.swap} onChange={set("swap")}><option value="">Disposal + acquisition (assumption)</option><option value="DISPOSAL_AND_ACQUISITION">Disposal + acquisition (assumption)</option><option value="NOT_ASSESSED">Not assessed</option></select>
            </label>
          </>
        ) : null}
        <div className="grid grid-cols-3 gap-2 sm:col-span-2 lg:col-span-4">
          {([["shortRate", "Short-term rate %"], ["longRate", "Long-term rate %"], ["stateRate", "State rate %"]] as const).map(([k, label]) => (
            <label key={k} className="grid gap-1"><span className="eyebrow">{label}</span><input className={field} inputMode="decimal" placeholder="optional" value={d[k]} onChange={set(k)} /></label>
          ))}
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="secondary">RECALCULATE</Button>
          <span className="ml-3 text-xs text-faint">Rates are your own inputs; none are assumed. Without rates, gains are shown but no exposure is estimated.</span>
          {err ? <p role="alert" className="mt-2 text-xs text-loss">{err}</p> : null}
        </div>
      </form>
    </Card>
  );
}

const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s);
const asset = (a: string, mint: string | null) => (mint ? short(mint) : a);

export function RealizedTable({ rows }: { rows: TaxDetailsResponse["realized"] }) {
  const inYear = rows.filter((r) => r.inTaxYear);
  if (inYear.length === 0) return <p className="py-6 text-center text-sm text-muted">No realized gains or losses in this tax year from the data available.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead><tr className="border-b border-line text-left">{["Disposed", "Asset", "Quantity", "Acquired", "Cost basis", "Proceeds", "Gain / loss", "Term", "Transaction"].map((h, i) => <th key={h} scope="col" className={`eyebrow px-3 py-2 font-normal ${i >= 4 && i <= 6 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>
          {inYear.map((r) => (
            <tr key={`${r.disposalEventId}|${r.lotEventId}`} className="border-b border-line/60 last:border-0">
              <td className="num px-3 py-2.5 text-muted">{formatDate(r.disposedAt)}</td>
              <td className="px-3 py-2.5 font-semibold" title={r.mint ?? undefined}>{asset(r.asset, r.mint)}</td>
              <td className="num px-3 py-2.5">{formatAmount(BigInt(r.quantity), r.decimals, 4)}</td>
              <td className="num px-3 py-2.5 text-muted">{formatDate(r.acquiredAt)}</td>
              <td className="num px-3 py-2.5 text-right">{formatUsd(BigInt(r.costBasisCents), { cents: true })}</td>
              <td className="num px-3 py-2.5 text-right">{formatUsd(BigInt(r.proceedsCents), { cents: true })}</td>
              <td className={`num px-3 py-2.5 text-right ${BigInt(r.gainLossCents) < 0n ? "text-loss" : "text-gain"}`}>{formatUsd(BigInt(r.gainLossCents), { cents: true, signed: true })}</td>
              <td className="px-3 py-2.5 text-xs">{r.holdingPeriod === "LONG_TERM" ? "Long-term" : "Short-term"}</td>
              <td className="px-3 py-2.5 font-mono text-xs text-faint" title={r.disposalSignature}>{short(r.disposalSignature)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const KIND: Record<string, string> = { BUY: "Acquisition (buy)", SELL: "Disposal (sell)", TRANSFER_IN: "Transfer in", TRANSFER_OUT: "Transfer out", FEE: "Network fee", UNKNOWN: "UNKNOWN" };
const STAT: Record<string, { label: string; tone: "good" | "demo" | "bad" | "neutral" }> = {
  READY: { label: "READY", tone: "good" }, DATA_REQUIRED: { label: "DATA REQUIRED", tone: "bad" }, UNRESOLVED: { label: "UNRESOLVED", tone: "demo" }, MATCHED: { label: "MATCHED (INTERNAL)", tone: "neutral" }, EXCLUDED: { label: "EXCLUDED", tone: "neutral" },
};
const FILTERS = [["all", "All"], ["attention", "Needs attention"], ["unknown", "UNKNOWN"], ["price", "Price unavailable"], ["basis", "Cost basis missing"]] as const;
type Filter = (typeof FILTERS)[number][0];
const keep: Record<Filter, (e: TaxDetailsResponse["events"][number]) => boolean> = {
  all: () => true,
  attention: (e) => e.status === "DATA_REQUIRED" || e.status === "UNRESOLVED",
  unknown: (e) => e.kind === "UNKNOWN",
  price: (e) => e.missing.includes("PRICE"),
  basis: (e) => e.missing.includes("COST_BASIS"),
};

export function TaxEventsTable({ events, truncated }: { events: TaxDetailsResponse["events"]; truncated: boolean }) {
  const [f, setF] = useState<Filter>("attention");
  const rows = events.filter(keep[f]);
  return (
    <div>
      <div role="tablist" aria-label="Event filter" className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={f === k} onClick={() => setF(k)} className={`rounded border px-2.5 py-1 text-xs ${f === k ? "border-accent text-fg" : "border-line-strong text-muted"}`}>{label} ({events.filter(keep[k]).length})</button>
        ))}
      </div>
      {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">Nothing in this view.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b border-line text-left">{["Date", "Event", "Asset", "Quantity", "USD value", "Status", "Why"].map((h, i) => <th key={h} scope="col" className={`eyebrow px-3 py-2 font-normal ${i === 3 || i === 4 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-line/60 align-top last:border-0">
                  <td className="num px-3 py-2.5 text-muted">{e.timestamp ? formatDate(e.timestamp) : "Unknown"}</td>
                  <td className="px-3 py-2.5">{KIND[e.kind]}<span className="block font-mono text-xs text-faint" title={e.signature}>{short(e.signature)}</span></td>
                  <td className="px-3 py-2.5 font-semibold" title={e.mint ?? undefined}>{asset(e.asset, e.mint)}</td>
                  <td className="num px-3 py-2.5 text-right">{e.kind === "FEE" ? `${formatAmount(BigInt(e.quantity), 9, 6)} SOL` : formatAmount(BigInt(e.quantity), e.decimals, 4)}</td>
                  <td className="num px-3 py-2.5 text-right">{e.usdValueCents === null ? <span className="text-xs text-faint">{e.missing.includes("PRICE") ? "PRICE DATA UNAVAILABLE" : "—"}</span> : <>{formatUsd(BigInt(e.usdValueCents), { cents: true })}{e.valuation === "COUNTER_LEG" ? <span className="block text-xs text-faint">from the other swap leg</span> : null}</>}</td>
                  <td className="px-3 py-2.5"><Badge tone={STAT[e.status]!.tone}>{STAT[e.status]!.label}</Badge>{e.missing.length ? <span className="mt-1 block text-xs text-faint">needs: {e.missing.join(", ").toLowerCase().replace("_", " ")}</span> : null}</td>
                  <td className="max-w-xs px-3 py-2.5 text-xs text-muted">{e.reason}{e.candidates.length ? <span className="mt-1 block text-faint">{e.candidates.length} possible counterpart(s) found (suggested only, not applied).</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {truncated ? <p className="mt-3 text-xs text-warn">Showing a capped list; more events exist.</p> : null}
    </div>
  );
}
