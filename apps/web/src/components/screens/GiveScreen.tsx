"use client";

import { COPY, DONATION_TAX_NOTE, GIVE_COPY, type DonationsResponse } from "@project-name/shared";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { charityFromApi } from "@/lib/adapters";
import { formatAmount, formatDate, formatUsd } from "@/lib/format";
import type { Charity } from "@/lib/types";
import { useScopedWallet } from "@/lib/useScopedWallet";
import { useWallet } from "@/state/wallet";
import { DEMO_GIVING_RULES } from "@/mock";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Card } from "../Card";
import { CharityCard } from "../CharityCard";
import { DataSourceBadge, DemoDataNotice } from "../DataSource";
import { EmptyState } from "../EmptyState";
import { CharityDetail, DonationDetailLoader, DonationPlanner, filterCharities } from "../GivePanels";
import { inputCls } from "../LaunchParts";
import { PageHeader } from "../PageHeader";
import { AuthRequired, LoadingState, ResourceView } from "../states";

type DonationRow = DonationsResponse["donations"][number];

/** Every status says what it is. Only "confirmed" claims an on-chain transaction, and only the API can produce it with one. */
export function donationStatusView(status: DonationRow["status"]): { label: string; tone: "demo" | "neutral" | "good" | "bad" } {
  switch (status) {
    case "demo": return { label: "DEMO RECORD · NOT ON-CHAIN", tone: "demo" };
    case "draft": return { label: "DRAFT · NOT SENT", tone: "neutral" };
    case "pending": return { label: "PENDING · NOT CONFIRMED", tone: "neutral" };
    case "confirmed": return { label: "CONFIRMED ON-CHAIN", tone: "good" };
    case "failed": return { label: "FAILED", tone: "bad" };
    case "cancelled": return { label: "CANCELLED", tone: "neutral" };
  }
}

export function receiptStatusLabel(d: Pick<DonationRow, "receiptId" | "receiptStatus" | "dataSource">): string {
  if (!d.receiptId) return "No receipt";
  if (d.dataSource === "demo") return "DEMO RECEIPT · NOT A TAX RECEIPT";
  return `Receipt ${(d.receiptStatus ?? "UNVERIFIED").replaceAll("_", " ")}`;
}

/** Pure view of the charity registry: information only. */
export function CharityDirectory({ charities, donations, selectedId, onSelect }: { charities: Charity[]; donations: DonationsResponse | null; selectedId?: string | null; onSelect?: (id: string) => void }) {
  const sum = (id: string, status: string) => (donations?.donations ?? []).filter((d) => d.charityId === id && d.status === status).reduce((s, d) => s + BigInt(d.usdReferenceCents ?? "0"), 0n);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {charities.map((c) => <CharityCard key={c.id} charity={c} confirmedCents={sum(c.id, "confirmed")} demoCents={sum(c.id, "demo")} selected={selectedId === c.id} {...(onSelect ? { onSelect } : {})} />)}
    </div>
  );
}

/** Pure view of donation history. Empty history is an empty state, never filler. */
export function DonationHistory({ data, charities, onSelect }: { data: DonationsResponse; charities: Charity[]; onSelect?: (id: string) => void }) {
  const nameOf = (id: string) => charities.find((c) => c.id === id)?.name ?? "Unknown charity";
  return (
    <Card title="Donation history" right={<DataSourceBadge dataSource={data.dataSource} verifiedOnChain={data.verifiedOnChain} />}>
      <DemoDataNotice dataSource={data.dataSource} message="These are fictional demo records. No blockchain transaction exists for them." />
      {data.donations.length === 0 ? (
        <EmptyState badge="NO DONATIONS" title={GIVE_COPY.noDonations} description="No donations are recorded for this wallet. Actual on-chain donations are not available yet." />
      ) : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-4 text-sm">
            <div><dt className="eyebrow">Confirmed on-chain</dt><dd className="num text-lg font-semibold">{formatUsd(BigInt(data.confirmedTotalCents))}</dd></div>
            <div><dt className="eyebrow">Demo records (not donations)</dt><dd className="num text-lg font-semibold text-muted">{formatUsd(BigInt(data.demoTotalCents))}</dd></div>
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-line text-left">{["Date", "Charity", "Quantity", "USD reference", "Status", "Receipt", ""].map((h, i) => <th key={i} scope="col" className="eyebrow px-3 py-2 font-normal">{h}</th>)}</tr></thead>
              <tbody>
                {data.donations.map((d) => {
                  const st = donationStatusView(d.status);
                  return (
                    <tr key={d.id} className="border-b border-line/60 last:border-0">
                      <td className="num px-3 py-2.5 text-muted">{formatDate(d.donatedAt ?? d.createdAt)}</td>
                      <td className="break-words px-3 py-2.5">{nameOf(d.charityId)}</td>
                      <td className="num px-3 py-2.5">{formatAmount(BigInt(d.quantity), d.assetDecimals, 2)} {d.asset}</td>
                      <td className="num px-3 py-2.5">{d.usdReferenceCents === null ? "Not available" : formatUsd(BigInt(d.usdReferenceCents), { cents: true })}</td>
                      <td className="px-3 py-2.5"><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td className="px-3 py-2.5 text-xs text-faint">{receiptStatusLabel(d)}</td>
                      <td className="px-3 py-2.5">{onSelect ? <Button onClick={() => onSelect(d.id)} aria-label={`Details for donation to ${nameOf(d.charityId)}`}>DETAILS</Button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-muted">{data.taxNote}</p>
      <p className="mt-1 text-xs text-faint">{GIVE_COPY.usdReference}</p>
    </Card>
  );
}

function History({ walletId, charities }: { walletId: string; charities: Charity[] }) {
  const w = useWallet();
  const [open, setOpen] = useState<string | null>(null);
  const res = useResource(`donations-screen:${walletId}`, () => api.getDonations(walletId), () => void w.refreshSession());
  return (
    <div className="space-y-4">
      <ResourceView resource={res} loadingLabel="Loading donations">{(d) => <DonationHistory data={d} charities={charities} onSelect={setOpen} />}</ResourceView>
      {open ? <DonationDetailLoader key={open} donationId={open} /> : null}
    </div>
  );
}

const STATE_FILTERS = ["ALL", "VERIFIED", "PENDING_REVIEW", "UNVERIFIED", "SUSPENDED"] as const;

export function GiveScreen(): ReactNode {
  const scope = useScopedWallet();
  const charities = useResource("charities", () => api.getCharities());
  const donations = useResource(`donations-for-cards:${scope.wallet?.id ?? "none"}`, scope.gate === "ready" && scope.wallet ? () => api.getDonations(scope.wallet!.id) : null);
  const donationsData = donations.status === "ok" ? donations.data : null;
  const [query, setQuery] = useState("");
  const [state, setState] = useState<string>("ALL");
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div>
      <PageHeader eyebrow="Give" title="Turn part of your crypto activity into measurable impact." subtitle="Review charities and their verification evidence. Donation transfers are not enabled in this beta." />

      <section aria-labelledby="info" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="info" className="eyebrow !text-muted">CHARITY REGISTRY</h2>
          <Badge tone="neutral">NOT A DONATION</Badge>
        </div>
        <ResourceView resource={charities} loadingLabel="Loading charities">
          {(list) => {
            const view = list.map(charityFromApi);
            const shown = filterCharities(view, query, state);
            const selectedCharity = view.find((c) => c.id === selected) ?? null;
            return (
              <>
                <DemoDataNotice dataSource={list.some((c) => c.dataSource === "demo") ? "demo" : "database"} message="Fictional demo charities. Their verification rests on labeled fixture evidence, not a real-world check, and charity verification is admin-data driven in this build." />
                <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
                  <div>
                    <label htmlFor="charity-search" className="eyebrow">Search charities</label>
                    <input id="charity-search" className={`${inputCls} mt-1.5`} value={query} maxLength={80} autoComplete="off" onChange={(e) => setQuery(e.target.value)} placeholder="Name, category or country" />
                  </div>
                  <div>
                    <label htmlFor="charity-state" className="eyebrow">{GIVE_COPY.verificationStatus}</label>
                    <select id="charity-state" className={`${inputCls} mt-1.5`} value={state} onChange={(e) => setState(e.target.value)}>
                      {STATE_FILTERS.map((s) => <option key={s} value={s}>{s === "ALL" ? "All statuses" : s.replace("_", " ")}</option>)}
                    </select>
                  </div>
                </div>
                {shown.length === 0 ? <EmptyState badge="NO MATCHES" title="NO CHARITIES MATCH" description="Try a different search or status." /> : (
                  <CharityDirectory charities={shown} donations={donationsData} selectedId={selected} onSelect={setSelected} />
                )}
                {selectedCharity ? <CharityDetail key={selectedCharity.id} charity={selectedCharity} /> : null}
              </>
            );
          }}
        </ResourceView>
      </section>

      <section className="mt-8 space-y-3" aria-labelledby="donate">
        <div className="flex items-center justify-between gap-3">
          <h2 id="donate" className="eyebrow !text-muted">REVIEW A DONATION</h2>
          <Badge tone="neutral">TRANSFERS NOT ENABLED</Badge>
        </div>
        <Card>
          {scope.gate === "checking" ? <LoadingState label="Checking session" /> : null}
          {scope.gate === "unauthenticated" ? <AuthRequired message="Connect and sign in to review a donation for your wallet." /> : null}
          {scope.gate === "ready" && scope.wallet && charities.status === "ok" ? (
            <DonationPlanner key={scope.wallet.id} walletId={scope.wallet.id} charities={charities.data.map(charityFromApi)} selectedId={selected} />
          ) : null}
          <p className="mt-3 text-xs font-semibold text-warn">{GIVE_COPY.transfersDisabled}</p>
          <p className="mt-2 text-xs text-muted">{COPY.donation}</p>
          <p className="mt-1 text-xs text-faint">{DONATION_TAX_NOTE.split(". ").slice(-1)[0]} <a className="text-accent underline underline-offset-2" href={COPY.irsCharity} target="_blank" rel="noopener noreferrer">IRS: charitable organizations</a></p>
          <div className="mt-4 border-t border-line pt-3">
            <p className="eyebrow mb-2">Planned giving rules (examples, not active)</p>
            <ul className="flex flex-wrap gap-2">{DEMO_GIVING_RULES.map((r) => <li key={r}><Badge tone="neutral">{r}</Badge></li>)}</ul>
          </div>
        </Card>
      </section>

      <section className="mt-8 space-y-3" aria-labelledby="history">
        <h2 id="history" className="eyebrow !text-muted">YOUR DONATION RECORDS</h2>
        {scope.gate === "checking" ? <LoadingState label="Checking session" /> : null}
        {scope.gate === "unauthenticated" ? <AuthRequired message="Connect and sign in to see donation records for your wallet." /> : null}
        {scope.gate === "ready" ? (
          <ResourceView resource={scope.walletsState} loadingLabel="Loading wallets">
            {() => (scope.wallet && charities.status === "ok" ? <History key={scope.wallet.id} walletId={scope.wallet.id} charities={charities.data.map(charityFromApi)} /> : <LoadingState />)}
          </ResourceView>
        ) : null}
      </section>
    </div>
  );
}
