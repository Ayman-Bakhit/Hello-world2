"use client";

import { COPY, DONATION_TAX_NOTE, type DonationsResponse } from "@project-name/shared";
import type { ReactNode } from "react";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { charityFromApi } from "@/lib/adapters";
import { formatDate, formatUsd } from "@/lib/format";
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
import { PageHeader } from "../PageHeader";
import { AuthRequired, LoadingState, ResourceView, UnavailableState } from "../states";

export function donationStatusView(status: DonationsResponse["donations"][number]["status"]): { label: string; tone: "demo" | "neutral" | "good" | "bad" } {
  switch (status) {
    case "demo": return { label: "DEMO RECORD · NOT ON-CHAIN", tone: "demo" };
    case "pending": return { label: "PENDING · NOT CONFIRMED", tone: "neutral" };
    case "confirmed": return { label: "CONFIRMED ON-CHAIN", tone: "good" };
    case "failed": return { label: "FAILED", tone: "bad" };
  }
}

/** Pure view of the charity directory: information only. */
export function CharityDirectory({ charities, donations }: { charities: Charity[]; donations: DonationsResponse | null }) {
  const sum = (id: string, status: string) => (donations?.donations ?? []).filter((d) => d.charityId === id && d.status === status).reduce((s, d) => s + BigInt(d.amountUsdCents), 0n);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {charities.map((c) => <CharityCard key={c.id} charity={c} confirmedCents={sum(c.id, "confirmed")} demoCents={sum(c.id, "demo")} />)}
    </div>
  );
}

/** Pure view of donation history. Empty history is an empty state, never filler. */
export function DonationHistory({ data, charities }: { data: DonationsResponse; charities: Charity[] }) {
  const nameOf = (id: string) => charities.find((c) => c.id === id)?.name ?? "Unknown charity";
  return (
    <Card title="Donation history" right={<DataSourceBadge dataSource={data.dataSource} verifiedOnChain={data.verifiedOnChain} />}>
      <DemoDataNotice dataSource={data.dataSource} message="These are fictional demo records. No blockchain transaction exists for them." />
      {data.donations.length === 0 ? (
        <EmptyState badge="NO DONATIONS" title="NO DONATIONS YET" description="No donations are recorded for this wallet. Actual on-chain donations are not available yet." />
      ) : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-4 text-sm">
            <div><dt className="eyebrow">Confirmed on-chain</dt><dd className="num text-lg font-semibold">{formatUsd(BigInt(data.confirmedTotalCents))}</dd></div>
            <div><dt className="eyebrow">Demo records (not donations)</dt><dd className="num text-lg font-semibold text-muted">{formatUsd(BigInt(data.demoTotalCents))}</dd></div>
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-line text-left">{["Date", "Charity", "Amount", "Status", "Transaction"].map((h) => <th key={h} scope="col" className="eyebrow px-3 py-2 font-normal">{h}</th>)}</tr></thead>
              <tbody>
                {data.donations.map((d) => {
                  const st = donationStatusView(d.status);
                  return (
                    <tr key={d.id} className="border-b border-line/60 last:border-0">
                      <td className="num px-3 py-2.5 text-muted">{formatDate(d.createdAt)}</td>
                      <td className="px-3 py-2.5">{nameOf(d.charityId)}</td>
                      <td className="num px-3 py-2.5">{formatUsd(BigInt(d.amountUsdCents), { cents: true })} {d.asset}</td>
                      <td className="px-3 py-2.5"><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td className="px-3 py-2.5 text-xs text-faint">{d.transactionSignature ? <span className="num font-mono">{d.transactionSignature}</span> : "none"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-muted">{data.taxNote}</p>
    </Card>
  );
}

function History({ walletId, charities }: { walletId: string; charities: Charity[] }) {
  const w = useWallet();
  const res = useResource(`donations-screen:${walletId}`, () => api.getDonations(walletId), () => void w.refreshSession());
  return <ResourceView resource={res} loadingLabel="Loading donations">{(d) => <DonationHistory data={d} charities={charities} />}</ResourceView>;
}

export function GiveScreen(): ReactNode {
  const scope = useScopedWallet();
  const charities = useResource("charities", () => api.getCharities());
  const donations = useResource(`donations-for-cards:${scope.wallet?.id ?? "none"}`, scope.gate === "ready" && scope.wallet ? () => api.getDonations(scope.wallet!.id) : null);
  const donationsData = donations.status === "ok" ? donations.data : null;

  return (
    <div>
      <PageHeader eyebrow="Give" title="Turn part of your crypto activity into measurable impact." subtitle="Donate transparently and keep a permanent record of your contributions." />

      <section aria-labelledby="info" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="info" className="eyebrow !text-muted">CHARITY INFORMATION</h2>
          <Badge tone="neutral">NOT A DONATION</Badge>
        </div>
        <ResourceView resource={charities} loadingLabel="Loading charities">
          {(list) => {
            const view = list.map(charityFromApi);
            return (
              <>
                <DemoDataNotice dataSource={list.some((c) => c.dataSource === "demo") ? "demo" : "database"} message="Fictional demo charities. Verification shown is demo status; the real admin review workflow is not implemented." />
                <CharityDirectory charities={view} donations={donationsData} />
              </>
            );
          }}
        </ResourceView>
      </section>

      <section className="mt-8 space-y-3" aria-labelledby="donate">
        <div className="flex items-center justify-between gap-3">
          <h2 id="donate" className="eyebrow !text-muted">ACTUAL ON-CHAIN DONATION</h2>
          <Badge tone="neutral">UNAVAILABLE</Badge>
        </div>
        <Card>
          <div className="flex flex-wrap gap-2"><Button disabled title="Not available yet">DONATE</Button></div>
          <div className="mt-3"><UnavailableState compact message="On-chain donations are not available yet. This build creates no donation records and sends no transactions." /></div>
          <p className="mt-3 text-xs text-muted">{COPY.donation}</p>
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
