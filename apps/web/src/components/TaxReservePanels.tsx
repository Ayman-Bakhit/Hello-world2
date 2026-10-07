"use client";

import { RESERVE_COPY, type SetTaxReserveTargetRequest, type TaxReserveResponse } from "@project-name/shared";
import { useState } from "react";
import { formatUsd } from "@/lib/format";
import { validateTargetDraft, type TargetKind } from "@/lib/reserveTarget";
import type { ApiErrorView } from "@/lib/api/errors";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { DataSourceBadge } from "./DataSource";
import { ApiErrorState } from "./states";

type Tone = "good" | "demo" | "bad" | "neutral" | "info";
const usd = (c: string | null) => (c === null ? null : formatUsd(BigInt(c), { cents: true }));
const inputCls = "num w-full rounded border border-line-strong bg-canvas px-2.5 py-1.5 text-sm";

/** The tax data behind the estimate, in words that never claim certainty. */
export function taxStatusBadge(s: TaxReserveResponse["taxEstimate"]["status"]): { label: string; tone: Tone } {
  switch (s) {
    case "COMPLETE": return { label: "TAX DATA COMPLETE", tone: "info" };
    case "PARTIAL": return { label: "TAX DATA INCOMPLETE", tone: "demo" };
    case "DATA_REQUIRED": return { label: "TAX DATA REQUIRED", tone: "bad" };
    case "UNAVAILABLE": return { label: "NO TAX DATA", tone: "neutral" };
  }
}

/** Headline status: the recommendation's own label, so a partial result can never read like a total. */
export function ReserveStatusBanner({ data }: { data: TaxReserveResponse }) {
  const r = data.recommendation;
  const tone: Tone = r.status === "ESTIMATE" ? "info" : r.status === "ESTIMATE_INCOMPLETE" ? "demo" : r.status === "WITHHELD" ? "bad" : "neutral";
  return (
    <section aria-label="Reserve status" className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{r.label}</Badge>
        <Badge tone={taxStatusBadge(data.taxEstimate.status).tone}>{taxStatusBadge(data.taxEstimate.status).label}</Badge>
        <DataSourceBadge dataSource={data.dataSource} verifiedOnChain={data.verifiedOnChain} />
      </div>
      <p className="mt-2 text-xs text-muted">{r.reason}</p>
    </section>
  );
}

export function MissingList({ items }: { items: TaxReserveResponse["taxEstimate"]["missing"] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="eyebrow mb-1">What is missing</p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">{items.map((m) => <li key={`${m.kind}:${m.message}`}>{m.message}{m.count > 1 ? ` (${m.count})` : ""}</li>)}</ul>
    </div>
  );
}

/** Estimate, recommendation, target, balance, coverage and remaining, each with its own source. Pure view. */
export function ReserveFigures({ data }: { data: TaxReserveResponse }) {
  const e = data.taxEstimate;
  const rec = data.recommendation;
  const t = data.userTarget;
  const exposure = usd(e.estimatedExposureCents);
  const recCents = usd(rec.recommendedCents);
  const targetCents = usd(t.effectiveCents ?? t.resolvedCents);
  const b = data.reserveBalance;
  const incompleteNote = e.status === "PARTIAL" ? "Tax data incomplete: this may be missing items." : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Estimated tax exposure" right={<Badge tone={taxStatusBadge(e.status).tone}>ESTIMATE · {taxStatusBadge(e.status).label}</Badge>}>
        <p className="num text-2xl font-semibold">{exposure ?? "UNAVAILABLE"}</p>
        {exposure === null ? <p className="mt-1 text-xs text-muted">{e.withheldReason}</p> : null}
        {incompleteNote ? <p role="alert" className="mt-1 text-xs text-warn">{incompleteNote}</p> : null}
        <p className="mt-2 text-xs text-faint">From the tax engine using the rates you entered. A planning estimate, not a tax bill. Source: {e.source === "DEMO_FIXTURE" ? "demo fixture" : "tax engine"}.</p>
        <MissingList items={e.missing.filter((m) => m.kind !== "DEMO")} />
      </Card>

      <Card title="Recommended reserve" right={<Badge tone="neutral">SYSTEM RECOMMENDATION</Badge>}>
        <p className="num text-2xl font-semibold">{recCents ?? "UNAVAILABLE"}</p>
        <p className="mt-1 text-xs font-semibold text-muted">{rec.label}</p>
        <p className="mt-1 text-xs text-muted">{rec.reason}</p>
        <p className="mt-2 text-xs text-faint">{RESERVE_COPY.recommendationNotTarget}</p>
      </Card>

      <Card title="Your reserve target" right={<Badge tone="neutral">{t.set ? (t.source === "SYSTEM_RECOMMENDED" ? "ADOPTED RECOMMENDATION" : "USER-SET") : "NOT SET"}</Badge>}>
        {t.set ? (
          <>
            <p className="num text-2xl font-semibold">{targetCents ?? "UNAVAILABLE"}</p>
            <p className="mt-1 text-xs text-muted">
              {t.targetType === "percentage" ? `${t.targetPercentage}% of realized gains` : "Fixed amount"} · USDC · {t.label}
              {t.enabled === false ? " · coverage is not computed while disabled" : ""}
            </p>
            {t.resolutionNote ? <p className="mt-1 text-xs text-muted">{t.resolutionNote}</p> : null}
            <p className="mt-1 text-xs text-muted">{data.targetVsExposure.available ? data.targetVsExposure.wording : `Compared with the estimate: unavailable. ${data.targetVsExposure.reason ?? ""}`}</p>
          </>
        ) : <p className="text-sm text-muted">{RESERVE_COPY.noTarget}</p>}
        <p className="mt-2 text-xs text-faint">{RESERVE_COPY.targetIsConfiguration}</p>
      </Card>

      <Card title="Reserve balance" right={<DataSourceBadge dataSource={b.source === "DEMO_FIXTURE" ? "demo" : "database"} />}>
        {b.cents !== null ? <p className="num text-2xl font-semibold">{usd(b.cents)}</p> : <p className="text-xl font-semibold">{b.label}</p>}
        <p className="mt-1 text-xs text-muted">{b.cents !== null ? `${b.label}. ${b.note}` : b.note}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="eyebrow">Coverage</dt><dd className="num mt-0.5">{data.coverage.available ? data.coverage.label : "UNAVAILABLE"}</dd>{data.coverage.available ? null : <p className="mt-0.5 text-[11px] text-faint">{data.coverage.reason}</p>}</div>
          <div><dt className="eyebrow">Remaining target</dt><dd className="num mt-0.5">{data.remaining.available ? usd(data.remaining.cents) : "UNAVAILABLE"}</dd>{data.remaining.available ? null : <p className="mt-0.5 text-[11px] text-faint">{data.remaining.reason}</p>}</div>
        </dl>
      </Card>
    </div>
  );
}

/**
 * Reserve TARGET editor with an explicit confirmation step. Saving stores a number in account settings: nothing is moved,
 * and the wallet is never asked to sign anything.
 */
export function TargetEditor({ data, onSave, saving, error }: { data: TaxReserveResponse; onSave: (req: SetTaxReserveTargetRequest) => void; saving: boolean; error: ApiErrorView | null }) {
  const t = data.userTarget;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TargetKind>(t.targetType ?? "amount");
  const [percent, setPercent] = useState(t.targetPercentage ?? "30");
  const [amount, setAmount] = useState(t.targetAmountCents ? (BigInt(t.targetAmountCents) / 100n).toString() + "." + (BigInt(t.targetAmountCents) % 100n).toString().padStart(2, "0") : "");
  const [enabled, setEnabled] = useState(t.enabled ?? true);
  const [confirming, setConfirming] = useState<ReturnType<typeof validateTargetDraft> | null>(null);
  const errors = confirming && !confirming.ok ? confirming.errors : {};

  if (!open) {
    return (
      <Card title="Reserve target" right={<Badge tone="info">STORED, NO FUNDS MOVE</Badge>}>
        <Button variant="primary" onClick={() => setOpen(true)}>{t.set ? "EDIT RESERVE TARGET" : "SET RESERVE TARGET"}</Button>
        <p className="mt-3 text-xs text-faint">{RESERVE_COPY.targetIsConfiguration}</p>
      </Card>
    );
  }
  return (
    <Card title="Reserve target" right={<Badge tone="info">STORED, NO FUNDS MOVE</Badge>}>
      <fieldset disabled={saving}>
        <legend className="sr-only">Reserve target</legend>
        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm">
            <input type="radio" name="rule" checked={kind === "amount"} onChange={() => { setKind("amount"); setConfirming(null); }} className="mt-1" />
            <span className="flex-1">A fixed target
              <span className="mt-1.5 flex items-center gap-2">
                <span className="text-xs text-muted">$</span>
                <input aria-label="Reserve target in USDC" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => { setAmount(e.target.value); setConfirming(null); }} className={`${inputCls} !w-36`} disabled={kind !== "amount"} placeholder="10000.00" />
                <span className="text-xs text-muted">USDC</span>
              </span>
              {errors.amount ? <span role="alert" className="mt-1 block text-xs text-loss">{errors.amount}</span> : null}
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="radio" name="rule" checked={kind === "percentage"} onChange={() => { setKind("percentage"); setConfirming(null); }} className="mt-1" />
            <span className="flex-1">A percentage of realized gains
              <span className="mt-1.5 flex items-center gap-2">
                <input aria-label="Percent of realized gains" inputMode="decimal" autoComplete="off" value={percent} onChange={(e) => { setPercent(e.target.value); setConfirming(null); }} className={`${inputCls} !w-24`} disabled={kind !== "percentage"} />
                <span className="text-xs text-muted">%</span>
              </span>
              {errors.percent ? <span role="alert" className="mt-1 block text-xs text-loss">{errors.percent}</span> : null}
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setConfirming(null); }} />Target enabled</label>
        </div>
      </fieldset>
      {confirming && confirming.ok ? (
        <div role="alertdialog" aria-label="Confirm reserve target" className="mt-4 rounded-md border border-accent/50 bg-surface-2 p-3">
          <p className="text-sm font-semibold">Save this reserve target?</p>
          <p className="num mt-1 text-sm">{confirming.summary}</p>
          <p className="mt-1 text-xs text-muted">This changes a number in your account settings. It does not move or lock any funds, and your wallet is not asked to sign anything.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={saving} onClick={() => onSave(confirming.request)}>{saving ? "SAVING…" : "CONFIRM AND SAVE"}</Button>
            <Button disabled={saving} onClick={() => setConfirming(null)}>CANCEL</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" disabled={saving} onClick={() => setConfirming(validateTargetDraft({ kind, percent, amount, enabled }))}>REVIEW TARGET</Button>
          <Button disabled={saving} onClick={() => { setOpen(false); setConfirming(null); }}>CLOSE</Button>
        </div>
      )}
      {error ? <div className="mt-3"><ApiErrorState error={error} /></div> : null}
    </Card>
  );
}

/** Compact reserve summary for the Tax page. Same sources and labels as the full page. */
export function ReserveSummary({ data, action }: { data: TaxReserveResponse; action?: React.ReactNode }) {
  const rec = usd(data.recommendation.recommendedCents);
  return (
    <Card title="Tax reserve" right={<DataSourceBadge dataSource={data.dataSource} verifiedOnChain={data.verifiedOnChain} />}>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div><dt className="eyebrow">Recommended reserve</dt><dd className="num mt-1 text-lg font-semibold">{rec ?? "UNAVAILABLE"}</dd><p className="mt-0.5 text-[11px] text-faint">{data.recommendation.label}</p></div>
        <div><dt className="eyebrow">Reserve balance</dt><dd className="num mt-1 text-lg font-semibold">{data.reserveBalance.cents !== null ? usd(data.reserveBalance.cents) : "UNAVAILABLE"}</dd><p className="mt-0.5 text-[11px] text-faint">{data.reserveBalance.label}</p></div>
        <div><dt className="eyebrow">Coverage</dt><dd className="num mt-1 text-lg font-semibold">{data.coverage.available ? data.coverage.label : "UNAVAILABLE"}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-faint">{RESERVE_COPY.fundingDisabled}</p>
      {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
    </Card>
  );
}
