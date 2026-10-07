"use client";

import {
  GIVE_COPY, safeHttpUrl, type CharityEvidenceResponse, type DonationDetail, type DonationPlanResponse, type Receipt,
} from "@project-name/shared";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { describeApiError } from "@/lib/api/errors";
import { useResource } from "@/lib/api/useResource";
import { formatAmount, formatDate, formatUsd } from "@/lib/format";
import type { Charity } from "@/lib/types";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { verificationBadge, VerificationFacts } from "./CharityCard";
import { DataSourceBadge } from "./DataSource";
import { inputCls } from "./LaunchParts";
import { ResourceView } from "./states";

/** Search and state filter, applied client-side to the public registry. Matches names, categories and countries as plain text. */
export function filterCharities(list: Charity[], query: string, state: string): Charity[] {
  const q = query.trim().toLowerCase();
  return list.filter((c) => (state === "ALL" || c.verification === state) && (q === "" || `${c.name} ${c.category} ${c.country}`.toLowerCase().includes(q)));
}

/** Pure view of one charity's public evidence. No internal notes exist in the data it receives. */
export function EvidenceList({ data }: { data: CharityEvidenceResponse }) {
  return (
    <div>
      <p className="eyebrow mb-2">{GIVE_COPY.evidence}</p>
      {data.evidence.length === 0 ? <p className="text-xs text-muted">No evidence recorded.</p> : (
        <ul className="space-y-2">
          {data.evidence.map((e) => {
            const url = safeHttpUrl(e.sourceUrl);
            return (
              <li key={e.id} className="rounded border border-line p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={e.sourceType === "FIXTURE" ? "demo" : "neutral"}>{e.sourceType.replaceAll("_", " ")}</Badge>
                  <Badge tone="neutral">{e.status.replaceAll("_", " ")}</Badge>
                  <span className="num text-faint">Checked {formatDate(e.checkedAt)}</span>
                  <span className="text-faint">{e.reviewedBy === "ADMIN" ? "Admin review recorded" : "Reviewer not recorded"}</span>
                </div>
                <p className="mt-1.5 break-words text-muted">{e.publicSummary}</p>
                <p className="mt-1 break-all text-faint">
                  Source: {url ? <a className="text-accent underline underline-offset-2" href={url} target="_blank" rel="noopener noreferrer nofollow">{e.sourceRef}</a> : e.sourceRef}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-faint">{data.caveat}</p>
    </div>
  );
}

/** Pure view of the selected charity. The website link is validated again at render and opens with rel=noopener noreferrer nofollow. */
export function CharityDetailView({ charity, evidence }: { charity: Charity; evidence: CharityEvidenceResponse | null }) {
  const badge = verificationBadge(charity);
  const site = safeHttpUrl(charity.website);
  return (
    <Card title="Selected charity" right={<Badge tone={badge.tone}>{badge.label}</Badge>}>
      <h3 className="break-words text-base font-semibold">{charity.name}</h3>
      <p className="text-xs text-faint">{charity.category}{charity.country ? ` · ${charity.country}` : ""}</p>
      <p className="mt-2 break-words text-sm text-muted">{charity.description}</p>
      {site ? <p className="mt-2 break-all text-xs text-faint">Website (not verified by us): <a className="text-accent underline underline-offset-2" href={site} target="_blank" rel="noopener noreferrer nofollow">{site}</a></p> : null}
      <VerificationFacts charity={charity} />
      <p className="mt-2 text-[11px] text-faint">{charity.verificationNote}</p>
      <div className="mt-4 border-t border-line pt-3">{evidence ? <EvidenceList data={evidence} /> : <p className="text-xs text-muted">Loading evidence…</p>}</div>
    </Card>
  );
}

export function CharityDetail({ charity }: { charity: Charity }) {
  const res = useResource(`evidence:${charity.id}`, () => api.getCharityEvidence(charity.id));
  return <ResourceView resource={res} loadingLabel="Loading evidence">{(d) => <CharityDetailView charity={charity} evidence={d} />}</ResourceView>;
}

/** Pure view of a donation plan. The final action is disabled: nothing is signed or sent. */
export function DonationPlanView({ plan }: { plan: DonationPlanResponse }) {
  const badge = verificationBadge({ verification: plan.charity.verificationState, verificationSource: plan.charity.verificationSource, dataSource: plan.charity.dataSource });
  return (
    <section aria-label="Donation review" className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">REVIEW ONLY · NOTHING SENT</p>
        <DataSourceBadge dataSource={plan.dataSource} />
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="eyebrow">Charity</dt><dd className="mt-0.5 break-words">{plan.charity.name}</dd></div>
        <div><dt className="eyebrow">{GIVE_COPY.verificationStatus}</dt><dd className="mt-0.5"><Badge tone={badge.tone}>{badge.label}</Badge></dd></div>
        <div><dt className="eyebrow">Asset</dt><dd className="mt-0.5">{plan.asset}</dd></div>
        <div><dt className="eyebrow">Amount</dt><dd className="num mt-0.5">{formatAmount(BigInt(plan.quantity), plan.assetDecimals, plan.assetDecimals)} {plan.asset}</dd></div>
        <div><dt className="eyebrow">USD reference value</dt><dd className="num mt-0.5">{formatUsd(BigInt(plan.usdReferenceCents), { cents: true })}</dd></div>
        <div><dt className="eyebrow">Network fee</dt><dd className="mt-0.5 text-xs text-muted">{plan.feeDisclosure}</dd></div>
      </dl>
      {plan.charity.eligible ? null : <p role="alert" className="mt-3 text-xs text-loss">{plan.charity.blockedReason}</p>}
      <p className="mt-3 text-xs text-muted">{plan.usdReferenceNote}</p>
      <p className="mt-1 text-xs text-muted">{plan.taxNote}</p>
      <p className="mt-1 text-xs text-muted">{plan.signingNote}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled aria-disabled="true">CONFIRM DONATION</Button>
        <p className="text-xs font-semibold text-warn">{plan.disabledReason}</p>
      </div>
    </section>
  );
}

/** Review form. It calls a stateless endpoint: no record is created and nothing is signed. */
export function DonationPlanner({ walletId, charities, selectedId }: { walletId: string; charities: Charity[]; selectedId: string | null }) {
  const [charityId, setCharityId] = useState<string>(selectedId ?? charities[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<DonationPlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = charities.some((c) => c.id === charityId) ? charityId : (charities[0]?.id ?? "");

  async function review(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setPlan(null);
    try {
      setPlan(await api.planDonation({ walletId, charityId: chosen, amount: amount.trim() }));
    } catch (err) {
      const v = describeApiError(err);
      setError(v.fields ? Object.entries(v.fields).map(([k, m]) => `${k}: ${m.join(", ")}`).join("; ") : v.message);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <form onSubmit={review} className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
        <div>
          <label htmlFor="plan-charity" className="eyebrow">Charity</label>
          <select id="plan-charity" className={`${inputCls} mt-1.5`} value={chosen} onChange={(e) => { setCharityId(e.target.value); setPlan(null); }}>
            {charities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="plan-amount" className="eyebrow">Amount (USDC)</label>
          <input id="plan-amount" className={`${inputCls} mt-1.5`} inputMode="decimal" autoComplete="off" placeholder="25.00" value={amount} onChange={(e) => { setAmount(e.target.value); setPlan(null); }} />
        </div>
        <Button type="submit" disabled={busy || chosen === "" || amount.trim() === ""}>{busy ? "REVIEWING" : "REVIEW DONATION"}</Button>
      </form>
      {error ? <p role="alert" className="mt-3 text-xs text-loss">{error}</p> : null}
      {plan ? <DonationPlanView plan={plan} /> : null}
    </div>
  );
}

/** Pure view of one donation record and its receipt reference. A receipt is not proof of deductibility. */
export function DonationDetailView({ detail }: { detail: DonationDetail }) {
  const d = detail.donation;
  return (
    <section aria-label="Donation detail" className="rounded-lg border border-line bg-surface-2 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="eyebrow">DONATION RECORD</p>
        <DataSourceBadge dataSource={d.dataSource} />
        <Badge tone="neutral">{d.provenance.replaceAll("_", " ")}</Badge>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><dt className="eyebrow">Quantity</dt><dd className="num mt-0.5">{formatAmount(BigInt(d.quantity), d.assetDecimals, d.assetDecimals)} {d.asset}</dd></div>
        <div><dt className="eyebrow">USD reference value</dt><dd className="num mt-0.5">{d.usdReferenceCents === null ? "Not available" : formatUsd(BigInt(d.usdReferenceCents), { cents: true })}{d.usdReferenceSource ? <span className="ml-2 text-xs text-faint">{d.usdReferenceSource.replaceAll("_", " ")}</span> : null}</dd></div>
        <div><dt className="eyebrow">Transaction</dt><dd className="mt-0.5 break-all text-xs">{d.transactionSignature ?? "None. No transaction exists for this record."}</dd></div>
        <div><dt className="eyebrow">Donated at</dt><dd className="num mt-0.5">{d.donatedAt ? formatDate(d.donatedAt) : "Not donated on-chain"}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-muted">{GIVE_COPY.usdReference}</p>
      <div className="mt-4 border-t border-line pt-3">
        <p className="eyebrow mb-2">Receipt</p>
        {detail.receipt ? <ReceiptView receipt={detail.receipt} /> : <p className="text-xs text-muted">No receipt recorded for this donation.</p>}
      </div>
      <p className="mt-3 text-xs text-muted">{d.taxNote}</p>
    </section>
  );
}

export function ReceiptView({ receipt }: { receipt: Receipt }) {
  const doc = safeHttpUrl(receipt.documentUrl, { httpsOnly: true });
  return (
    <div className="text-xs">
      <div className="flex flex-wrap gap-2">{receipt.labels.map((l) => <Badge key={l} tone="demo">{l}</Badge>)}</div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div><dt className="eyebrow">Reference</dt><dd className="num mt-0.5 break-all">{receipt.receiptReference}</dd></div>
        <div><dt className="eyebrow">Charity reference</dt><dd className="num mt-0.5 break-all">{receipt.charityReceiptReference ?? "Not provided"}</dd></div>
        <div><dt className="eyebrow">Issued</dt><dd className="num mt-0.5">{formatDate(receipt.issuedAt)}</dd></div>
        <div><dt className="eyebrow">Receipt status</dt><dd className="mt-0.5">{receipt.verificationState.replaceAll("_", " ")}</dd></div>
        <div><dt className="eyebrow">Document</dt><dd className="mt-0.5 break-all">{doc ? <a className="text-accent underline underline-offset-2" href={doc} target="_blank" rel="noopener noreferrer nofollow">{doc}</a> : "None"}</dd></div>
      </dl>
      <p className="mt-2 text-muted">{receipt.caveat}</p>
    </div>
  );
}

export function DonationDetailLoader({ donationId }: { donationId: string }) {
  const res = useResource(`donation:${donationId}`, () => api.getDonation(donationId));
  return <ResourceView resource={res} loadingLabel="Loading donation">{(d) => <DonationDetailView detail={d} />}</ResourceView>;
}
