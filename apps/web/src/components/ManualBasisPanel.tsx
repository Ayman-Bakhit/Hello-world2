"use client";

import type { ManualBasisDetail, ManualBasisView, TaxDetailsResponse } from "@project-name/shared";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { describeApiError, type ApiErrorView } from "@/lib/api/errors";
import { EMPTY_BASIS_DRAFT, draftFromItem, draftToRequest, missingBasisItems, type BasisFormDraft, type MissingBasisItem } from "@/lib/manualBasis";
import { formatDate } from "@/lib/format";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { ApiErrorState } from "./states";

const field = "num w-full rounded border border-line-strong bg-canvas px-2 py-1 text-sm";
const REASONS: [string, string][] = [["EXCHANGE_PURCHASE", "Bought on an exchange / off-chain"], ["PRIOR_WALLET", "Moved from an earlier wallet"], ["GIFT_RECEIVED", "Received as a gift"], ["INCOME_OR_REWARD", "Income or reward"], ["OTHER", "Other"]];
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s);

/** Label that must sit next to any user-entered tax data. It is the user's statement, never blockchain data. */
export const UserProvidedBadge = () => <Badge tone="demo">USER-PROVIDED TAX DATA</Badge>;

const REVIEW_TONE = { OK: "good", POTENTIAL_DUPLICATE: "demo", OVERLAPPING_BASIS: "demo", DECIMALS_MISMATCH: "bad" } as const;

/** Shown whenever the tax result needs cost basis. Never worded as verified. */
export function MissingBasisBanner({ items, recordCount, onAdd, onReview }: { items: MissingBasisItem[]; recordCount: number; onAdd: (i: MissingBasisItem | null) => void; onReview: () => void }) {
  if (items.length === 0 && recordCount === 0) return null;
  return (
    <section aria-label="Missing cost basis" className="mt-6 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        {items.length > 0 ? <Badge tone="bad">COST BASIS REQUIRED</Badge> : <Badge tone="neutral">COST BASIS</Badge>}
        <UserProvidedBadge />
      </div>
      {items.length > 0 ? (
        <>
          <p className="mt-2 text-sm">This asset has no verified historical cost basis.</p>
          <p className="mt-1 text-xs text-muted">The indexed history does not show how these were acquired. You can add the cost basis you know. It is recorded as your own statement, is not checked against any blockchain or exchange, and cannot make missing prices or unknown transactions complete.</p>
          <ul className="mt-3 space-y-1.5 text-xs">
            {items.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{i.kind === "DISPOSAL" ? "Sold without cost basis" : "Received, origin unknown"}</span>
                <span className="num">{i.quantity} <span title={i.mint ?? undefined}>{i.mint ? short(i.mint) : i.asset}</span></span>
                {i.timestamp ? <span className="text-faint">{formatDate(i.timestamp)}</span> : null}
                <Button variant="secondary" className="!px-2 !py-1" onClick={() => onAdd(i)}>ADD COST BASIS</Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length === 0 ? null : <Button variant="primary" onClick={() => onAdd(null)}>ADD COST BASIS</Button>}
        <Button variant="secondary" onClick={onReview}>REVIEW EXISTING BASIS ({recordCount})</Button>
        {items.length === 0 ? <Button variant="ghost" onClick={() => onAdd(null)}>ADD COST BASIS</Button> : null}
      </div>
    </section>
  );
}

export function ManualBasisForm({
  draft, setDraft, onSubmit, saving, fields, error, title = "Add cost basis", revise,
}: {
  draft: BasisFormDraft; setDraft: (d: BasisFormDraft) => void; onSubmit: (extra: { changeReason: string; acknowledgeOverlap: boolean }) => void; saving: boolean;
  fields: Record<string, string[]> | null; error: ApiErrorView | null; title?: string; revise?: { overlap: boolean };
}) {
  const [changeReason, setChangeReason] = useState("");
  const [ack, setAck] = useState(false);
  const set = (k: keyof BasisFormDraft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  const err = (k: string) => (fields?.[k] ? <span role="alert" className="text-xs text-loss">{fields[k]!.join(" ")}</span> : null);
  return (
    <Card title={title} right={<UserProvidedBadge />}>
      <form className="grid gap-3 text-sm sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onSubmit({ changeReason, acknowledgeOverlap: ack }); }}>
        <label className="grid gap-1"><span className="eyebrow">Asset (native, or token mint)</span><input className={field} value={draft.asset} onChange={set("asset")} disabled={!!revise} placeholder="native or mint address" />{err("asset")}</label>
        <label className="grid gap-1"><span className="eyebrow">Token decimals (if the asset is new)</span><input className={field} inputMode="numeric" value={draft.decimals} onChange={set("decimals")} disabled={!!revise} placeholder="e.g. 6" />{err("decimals")}</label>
        <label className="grid gap-1"><span className="eyebrow">Quantity (whole tokens)</span><input className={field} inputMode="decimal" value={draft.quantity} onChange={set("quantity")} placeholder="e.g. 1.5" />{err("quantity")}</label>
        <label className="grid gap-1"><span className="eyebrow">Acquisition date and time (UTC)</span><input className={field} value={draft.acquiredAt} onChange={set("acquiredAt")} placeholder="2023-05-17T14:30:00Z" />{err("acquiredAt")}</label>
        <label className="grid gap-1"><span className="eyebrow">Total cost basis (USD)</span><input className={field} inputMode="decimal" value={draft.costBasis} onChange={set("costBasis")} placeholder="e.g. 1234.56" />{err("costBasis")}</label>
        <label className="grid gap-1"><span className="eyebrow">Currency</span><select className={field} value="USD" disabled><option>USD</option></select></label>
        <label className="grid gap-1"><span className="eyebrow">Reason / source</span><select className={field} value={draft.reason} onChange={set("reason")}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{err("reason")}</label>
        <label className="grid gap-1"><span className="eyebrow">Transaction signature (optional)</span><input className={field} value={draft.signature} onChange={set("signature")} placeholder="ties this basis to a transfer" />{err("signature")}</label>
        <label className="grid gap-1 sm:col-span-2"><span className="eyebrow">Notes (optional, plain text)</span><textarea className={field} rows={2} value={draft.notes} onChange={set("notes")} maxLength={1000} />{err("notes")}</label>
        {revise ? (
          <>
            <label className="grid gap-1 sm:col-span-2"><span className="eyebrow">Why are you changing this? (kept in the audit history)</span><input className={field} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />{err("changeReason")}</label>
            {revise.overlap ? <label className="flex items-start gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />I have reviewed the duplicate/overlap warning and this is a separate acquisition. Include it.</label> : null}
          </>
        ) : null}
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "SAVING…" : revise ? "SAVE REVISION" : "SAVE COST BASIS"}</Button>
          <span className="ml-3 text-xs text-faint">Nothing is rounded: values that cannot be stored exactly are rejected. This is your own statement; it is not verified.</span>
        </div>
      </form>
      {error ? <div className="mt-3"><ApiErrorState error={error} /></div> : null}
    </Card>
  );
}

export function ReviewNotice({ record }: { record: ManualBasisView }) {
  const r = record.review;
  if (!r || (r.state === "OK" && r.included)) return null;
  return (
    <div role="alert" className="mt-2 rounded border border-warn/30 bg-warn/[0.07] p-2 text-xs text-warn">
      <span className="mr-2 font-bold tracking-wider">{r.state.replace("_", " ")}</span>
      {r.included ? "Acknowledged and included." : "Excluded from the calculation until reviewed."} {r.explanation}
      {r.conflicts.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 text-muted">
          {r.conflicts.map((c) => <li key={c.id}>{c.source === "CHAIN" ? "Blockchain transaction" : "Your earlier record"}: {c.quantity} base units of {c.asset}{c.timestamp ? ` on ${formatDate(c.timestamp)}` : ""}{c.signature && c.source === "CHAIN" ? `, ${short(c.signature)}` : ""}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

export function ManualBasisRecords({ records, onHistory, onRevise, onVoid }: { records: ManualBasisView[]; onHistory: (r: ManualBasisView) => void; onRevise: (r: ManualBasisView) => void; onVoid: (r: ManualBasisView) => void }) {
  if (records.length === 0) return <p className="py-4 text-center text-sm text-muted">No cost basis records yet.</p>;
  return (
    <ul className="space-y-3">
      {records.map((r) => (
        <li key={r.id} className="rounded border border-line p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <UserProvidedBadge />
            <Badge tone={r.status === "voided" ? "neutral" : REVIEW_TONE[r.review?.state ?? "OK"]}>{r.status === "voided" ? "VOIDED" : r.review ? r.review.state.replace("_", " ") : "SAVED"}</Badge>
            <span className="text-xs text-faint">revision {r.revision}</span>
          </div>
          <p className="mt-1.5"><span className="num font-semibold">{r.quantity}</span> <span title={r.mint ?? undefined}>{r.mint ? short(r.mint) : r.asset}</span> · cost basis <span className="num">${r.costBasis} {r.currency}</span> · acquired {formatDate(r.acquiredAt)}</p>
          <p className="mt-0.5 text-xs text-muted">Reason: {r.reason.replace(/_/g, " ").toLowerCase()}{r.signature ? ` · signature ${short(r.signature)}` : ""}</p>
          {r.notes ? <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted">Notes: {r.notes}</p> : null}
          <ReviewNotice record={r} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="ghost" className="!px-2 !py-1" onClick={() => onHistory(r)}>AUDIT HISTORY</Button>
            {r.status === "active" ? <><Button variant="ghost" className="!px-2 !py-1" onClick={() => onRevise(r)}>REVISE</Button><Button variant="ghost" className="!px-2 !py-1" onClick={() => onVoid(r)}>VOID</Button></> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function BasisHistory({ detail }: { detail: ManualBasisDetail & { historyIntact: boolean } }) {
  return (
    <Card title="Audit history" right={<UserProvidedBadge />}>
      <p className="mb-2 text-xs text-muted">Every change is a new revision. Earlier values are never overwritten. {detail.historyIntact ? "Hash chain intact." : <span className="text-loss">Hash chain check FAILED: this history has been altered outside the application.</span>}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead><tr className="border-b border-line text-left">{["Rev", "When", "Action", "Quantity", "Cost basis", "Reason for change"].map((h) => <th key={h} scope="col" className="eyebrow px-2 py-1.5 font-normal">{h}</th>)}</tr></thead>
          <tbody>
            {detail.history.map((h) => (
              <tr key={h.revision} className="border-b border-line/60 last:border-0">
                <td className="num px-2 py-1.5">{h.revision}</td><td className="num px-2 py-1.5 text-muted">{formatDate(h.createdAt)}</td><td className="px-2 py-1.5">{h.action}{h.status === "voided" ? " (voided)" : ""}</td>
                <td className="num px-2 py-1.5">{h.quantity}</td><td className="num px-2 py-1.5">${h.costBasis}</td><td className="px-2 py-1.5 text-muted">{h.changeReason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

type View = { kind: "closed" } | { kind: "add"; draft: BasisFormDraft } | { kind: "review" } | { kind: "revise"; record: ManualBasisView; draft: BasisFormDraft };

/** Container: loads/saves through the API client; after any change it asks the screen to recalculate the tax result. */
export function ManualBasisPanel({ walletId, details, onChanged }: { walletId: string; details: TaxDetailsResponse; onChanged: () => void }) {
  const items = missingBasisItems(details);
  const [view, setView] = useState<View>({ kind: "closed" });
  const [records, setRecords] = useState<ManualBasisView[] | null>(null);
  const [detail, setDetail] = useState<(ManualBasisDetail & { historyIntact: boolean }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string[]> | null>(null);
  const [error, setError] = useState<ApiErrorView | null>(null);
  const [saved, setSaved] = useState<ManualBasisView | null>(null);

  const load = async () => {
    try { setRecords((await api.listManualBasis(walletId, true)).records); setError(null); } catch (e) { setError(describeApiError(e)); }
  };
  const open = (v: View) => { setFields(null); setError(null); setSaved(null); setView(v); if (v.kind === "review") void load(); };
  const fail = (e: unknown) => {
    const v = describeApiError(e);
    setFields(v.kind === "validation" ? (v.fields ?? null) : null);
    setError(v.kind === "validation" ? null : v);
  };

  const submitAdd = async (draft: BasisFormDraft) => {
    const r = draftToRequest(draft, Date.now());
    if (!r.ok) { setFields(r.fields); return; }
    setSaving(true); setFields(null); setError(null);
    try { const rec = await api.createManualBasis(walletId, r.body); setSaved(rec); setView({ kind: "review" }); await load(); onChanged(); } catch (e) { fail(e); } finally { setSaving(false); }
  };
  const submitRevise = async (record: ManualBasisView, draft: BasisFormDraft, extra: { changeReason: string; acknowledgeOverlap: boolean }) => {
    const r = draftToRequest({ ...draft, asset: record.asset === "SOL" ? "native" : record.asset, decimals: String(record.decimals) }, Date.now());
    if (!r.ok) { setFields(r.fields); return; }
    const { asset: _a, decimals: _d, ...rest } = r.body;
    void _a; void _d;
    setSaving(true); setFields(null); setError(null);
    try { const rec = await api.reviseManualBasis(walletId, record.id, { ...rest, ...extra, expectedRevision: record.revision }); setSaved(rec); setView({ kind: "review" }); await load(); onChanged(); } catch (e) { fail(e); } finally { setSaving(false); }
  };
  const doVoid = async (record: ManualBasisView) => {
    const why = typeof window !== "undefined" ? window.prompt("Why are you voiding this record? (kept in the audit history)") : null;
    if (!why || why.trim().length < 3) return;
    try { await api.voidManualBasis(walletId, record.id, { changeReason: why.trim(), expectedRevision: record.revision }); setSaved(null); await load(); onChanged(); } catch (e) { fail(e); }
  };
  const showHistory = async (r: ManualBasisView) => { try { setDetail(await api.getManualBasis(walletId, r.id)); } catch (e) { fail(e); } };

  return (
    <>
      <MissingBasisBanner items={items} recordCount={records?.length ?? 0} onAdd={(i) => open({ kind: "add", draft: i ? draftFromItem(i) : EMPTY_BASIS_DRAFT })} onReview={() => open({ kind: "review" })} />
      {view.kind === "add" ? <div className="mt-4"><FormHolder view={view} setView={setView} saving={saving} fields={fields} error={error} onSubmit={(d) => void submitAdd(d)} /></div> : null}
      {view.kind === "revise" ? <div className="mt-4"><FormHolder view={view} setView={setView} saving={saving} fields={fields} error={error} revise={{ overlap: view.record.review?.state === "POTENTIAL_DUPLICATE" || view.record.review?.state === "OVERLAPPING_BASIS" }} onSubmit={(d, x) => void submitRevise(view.record, d, x)} /></div> : null}
      {view.kind === "review" ? (
        <Card title="Your cost basis records" className="mt-4" right={<UserProvidedBadge />}>
          {saved ? (
            <div role="status" className="mb-3 rounded border border-gain/30 bg-gain/[0.06] p-2 text-xs text-gain">
              Saved as revision {saved.revision} ({saved.action}). Source: <strong>USER_PROVIDED</strong>: your statement, not verified on-chain.
              {saved.review && !(saved.review.state === "OK" && saved.review.included) ? <span className="ml-1 text-warn">Review needed: {saved.review.state.replace("_", " ")}.</span> : <span className="ml-1">The tax result was recalculated.</span>}
            </div>
          ) : null}
          {error ? <ApiErrorState error={error} onRetry={() => void load()} /> : records === null ? <p className="text-sm text-muted">Loading…</p> : (
            <ManualBasisRecords records={records} onHistory={(r) => void showHistory(r)} onRevise={(r) => open({ kind: "revise", record: r, draft: { ...EMPTY_BASIS_DRAFT, asset: r.asset, decimals: String(r.decimals), quantity: r.quantity, acquiredAt: r.acquiredAt, costBasis: r.costBasis, reason: r.reason, signature: r.signature ?? "", notes: r.notes ?? "" } })} onVoid={(r) => void doVoid(r)} />
          )}
        </Card>
      ) : null}
      {view.kind === "review" && detail ? <div className="mt-4"><BasisHistory detail={detail} /></div> : null}
    </>
  );
}

function FormHolder({ view, setView, saving, fields, error, revise, onSubmit }: {
  view: Extract<View, { kind: "add" | "revise" }>; setView: (v: View) => void; saving: boolean; fields: Record<string, string[]> | null; error: ApiErrorView | null; revise?: { overlap: boolean };
  onSubmit: (d: BasisFormDraft, extra: { changeReason: string; acknowledgeOverlap: boolean }) => void;
}) {
  return (
    <ManualBasisForm
      draft={view.draft} setDraft={(d) => setView({ ...view, draft: d })} onSubmit={(x) => onSubmit(view.draft, x)} saving={saving} fields={fields} error={error}
      title={revise ? "Revise cost basis" : "Add cost basis"} {...(revise ? { revise } : {})}
    />
  );
}
