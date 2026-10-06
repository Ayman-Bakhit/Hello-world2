"use client";

import { COPY, type TaxResponse, type TaxReserveResponse, type TransactionsResponse } from "@project-name/shared";
import type { ReactNode } from "react";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { transactionsFromApi } from "@/lib/adapters";
import { formatPercentBps, formatUsd } from "@/lib/format";
import { useScopedWallet } from "@/lib/useScopedWallet";
import { useWallet } from "@/state/wallet";
import { ButtonLink } from "../Button";
import { Card } from "../Card";
import { DataSourceBadge, DemoDataNotice } from "../DataSource";
import { PageHeader } from "../PageHeader";
import { AuthRequired, LoadingState, NoLiveData, ResourceView } from "../states";
import { StatCard } from "../StatCard";
import { TaxReserveCard } from "../TaxReserveCard";
import { TransactionTable } from "../TransactionTable";
import { WalletPicker } from "./WalletPicker";

/** Pure view. All wording is "estimated"; there is no tax-bill field in the API and none here. */
export function TaxView({ tax, reserve, transactions, walletLabel }: { tax: TaxResponse; reserve: TaxReserveResponse | null; transactions: TransactionsResponse | null; walletLabel: string }) {
  const a = tax.assumptions;
  const exposure = BigInt(tax.estimatedTaxExposureCents);
  const reserveCents = reserve ? BigInt(reserve.currentReserveCents) : null;
  const coverage = reserve?.coverageBps ?? null;
  const disposals = transactions ? transactions.transactions.filter((t) => t.taxTreatment === "disposal") : [];
  return (
    <>
      <DemoDataNotice dataSource={tax.dataSource} message="Estimated from fictional demo events with example tax rates. This is not your tax situation and nothing was read from a blockchain." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Estimated realized gains" value={formatUsd(BigInt(tax.estimatedRealizedGainsCents))} tone="gain" />
        <StatCard label="Estimated realized losses" value={formatUsd(-BigInt(tax.estimatedRealizedLossesCents))} tone="loss" />
        <StatCard label="Estimated taxable events" value={String(tax.estimatedTaxableEvents)} sub={`Tax year ${tax.taxYear}`} />
        <StatCard label={COPY.taxExposure} value={formatUsd(exposure)} sub={COPY.taxPlanning} />
        <StatCard label="Estimated tax reserve" value={reserveCents === null ? "—" : formatUsd(reserveCents)} sub={reserve ? undefined : "No live reserve data"} />
        <StatCard label="Reserve coverage" value={coverage === null ? "—" : formatPercentBps(coverage)} />
      </div>

      {reserve ? (
        <div className="mt-6">
          <TaxReserveCard reserveCents={BigInt(reserve.currentReserveCents)} exposureCents={exposure} actions={<ButtonLink href="/tax-reserve" variant="secondary">MANAGE RESERVE TARGET</ButtonLink>} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Assumptions used" right={<DataSourceBadge dataSource={tax.dataSource} verifiedOnChain={tax.verifiedOnChain} />}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Jurisdiction", a.jurisdiction],
              ["Cost basis method", tax.costBasisMethod],
              ["Short-term rate", formatPercentBps(a.shortTermRateBps, { digits: 0 })],
              ["Long-term rate", formatPercentBps(a.longTermRateBps, { digits: 0 })],
              ["State rate", formatPercentBps(a.stateRateBps, { digits: 0 })],
              ["Short-term net", formatUsd(BigInt(tax.estimatedShortTermNetCents))],
              ["Long-term net", formatUsd(BigInt(tax.estimatedLongTermNetCents))],
              ["Method", `${tax.methodology.name} v${tax.methodology.version}`],
            ].map(([k, v]) => (<div key={k}><dt className="eyebrow">{k}</dt><dd className="num mt-0.5">{v}</dd></div>))}
          </dl>
          <p className="mt-3 text-xs text-faint">Limitations of this estimate:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-faint">{tax.methodology.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </Card>
        <Card title="About these numbers">
          <div className="space-y-2 text-sm text-muted">{tax.disclaimer.map((d) => <p key={d}>{d}</p>)}</div>
          <p className="mt-3 text-xs text-faint">
            Official information:{" "}
            <a className="text-accent underline underline-offset-2" href={COPY.irsCrypto} target="_blank" rel="noopener noreferrer">IRS digital assets</a>
          </p>
        </Card>
      </div>

      <Card title="Potential taxable disposals" className="mt-6" right={transactions ? <DataSourceBadge dataSource={transactions.dataSource} verifiedOnChain={transactions.verifiedOnChain} /> : undefined}>
        {disposals.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No potential disposals to show.</p>
        ) : (
          <TransactionTable rows={transactionsFromApi({ ...transactions!, transactions: disposals }, walletLabel)} />
        )}
      </Card>
    </>
  );
}

function Body({ walletId, walletLabel, wallets, onSelect, wallet }: { walletId: string; walletLabel: string; wallets: Parameters<typeof WalletPicker>[0]["wallets"]; onSelect: (id: string) => void; wallet: string }) {
  const w = useWallet();
  const refresh = () => void w.refreshSession();
  const tax = useResource(`tax:${walletId}`, () => api.getTaxEstimate(walletId), refresh);
  const reserve = useResource(`reserve:${walletId}`, () => api.getTaxReserve(walletId));
  const tx = useResource(`tx-all:${walletId}`, () => api.getTransactions(walletId, { limit: 100 }));
  return (
    <>
      <WalletPicker wallets={wallets} selectedId={wallet} onSelect={onSelect} />
      <ResourceView resource={tax} loadingLabel="Loading tax estimate" noData={<NoLiveData title="NO LIVE TAX DATA YET" message="Your wallet is authenticated, but no indexed transactions exist to estimate from. Blockchain indexing has not been connected yet." />}>
        {(t) => <TaxView tax={t} reserve={reserve.status === "ok" ? reserve.data : null} transactions={tx.status === "ok" ? tx.data : null} walletLabel={walletLabel} />}
      </ResourceView>
    </>
  );
}

export function TaxScreen(): ReactNode {
  const scope = useScopedWallet();
  return (
    <div>
      <PageHeader
        eyebrow="Tax"
        title="TAX CENTER"
        subtitle="Never lose track of what you may owe. Track realized gains, estimate tax exposure, and keep a dedicated reserve."
        actions={<ButtonLink href="/tax-reserve" variant="secondary">TAX RESERVE</ButtonLink>}
      />
      {scope.gate === "checking" ? <LoadingState label="Checking session" /> : null}
      {scope.gate === "unauthenticated" ? <AuthRequired /> : null}
      {scope.gate === "ready" ? (
        <ResourceView resource={scope.walletsState} loadingLabel="Loading wallets">
          {() => scope.wallet ? <Body key={scope.wallet.id} walletId={scope.wallet.id} walletLabel={scope.wallet.label ?? "Wallet"} wallets={scope.wallets} onSelect={scope.select} wallet={scope.wallet.id} /> : <NoLiveData title="NO WALLETS" message="No wallets are linked to this account." />}
        </ResourceView>
      ) : null}
    </div>
  );
}
