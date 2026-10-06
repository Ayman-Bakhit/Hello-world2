"use client";

import { COPY, type DonationsResponse, type PortfolioResponse, type TaxReserveResponse, type TaxResponse, type TransactionsResponse, type Wallet } from "@project-name/shared";
import type { ReactNode } from "react";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { portfolioRowsFromApi, transactionsFromApi } from "@/lib/adapters";
import { formatPercentBps, formatUsd } from "@/lib/format";
import { useScopedWallet } from "@/lib/useScopedWallet";
import { useWallet } from "@/state/wallet";
import { Card } from "../Card";
import { DataSourceBadge, DemoDataNotice } from "../DataSource";
import { NoLiveData, ResourceView, AuthRequired, LoadingState, UnavailableState } from "../states";
import { PageHeader } from "../PageHeader";
import { PortfolioTable } from "../PortfolioTable";
import { StatCard, toneOf } from "../StatCard";
import { TransactionTable } from "../TransactionTable";
import { WalletPicker } from "./WalletPicker";

/** Optional figures from other endpoints. null = that endpoint has no live data for this wallet: show a dash, never a guess. */
export interface PortfolioExtras {
  tax: TaxResponse | null;
  reserve: TaxReserveResponse | null;
  donations: DonationsResponse | null;
  walletCount: number;
}

/** Pure view of a loaded portfolio. Everything shown comes from the API response. */
export function PortfolioView({ portfolio, extras }: { portfolio: PortfolioResponse; extras: PortfolioExtras }) {
  const rows = portfolioRowsFromApi(portfolio);
  const unrealized = BigInt(portfolio.unrealizedPnlCents);
  const realized = BigInt(portfolio.realizedPnlCents);
  const dash = "—";
  const confirmedGiving = extras.donations ? formatUsd(BigInt(extras.donations.confirmedTotalCents)) : dash;
  return (
    <>
      <DemoDataNotice dataSource={portfolio.dataSource} message="These fictional balances belong to the demo account, not to any real wallet. Nothing was read from a blockchain." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total portfolio value" value={formatUsd(BigInt(portfolio.totalValueCents), { cents: true })} sub={<DataSourceBadge dataSource={portfolio.dataSource} verifiedOnChain={portfolio.verifiedOnChain} />} className="col-span-2" />
        <StatCard label="Cost basis" value={formatUsd(BigInt(portfolio.costBasisCents))} />
        <StatCard label="Assets" value={String(rows.length)} sub={`${extras.walletCount} wallet${extras.walletCount === 1 ? "" : "s"}`} />
        <StatCard label="Realized P&L" value={formatUsd(realized, { signed: true })} tone={toneOf(realized)} />
        <StatCard label="Unrealized P&L" value={formatUsd(unrealized, { signed: true })} tone={toneOf(unrealized)} />
        <StatCard label={COPY.taxExposure} value={extras.tax ? formatUsd(BigInt(extras.tax.estimatedTaxExposureCents)) : dash} sub={extras.tax ? COPY.taxPlanning : "No live tax data"} />
        <StatCard label={COPY.taxReserve} value={extras.reserve ? formatUsd(BigInt(extras.reserve.currentReserveCents)) : dash} sub={extras.reserve && extras.reserve.coverageBps !== null ? `${formatPercentBps(extras.reserve.coverageBps)} coverage` : "No live reserve data"} />
        <StatCard label="Confirmed on-chain giving" value={confirmedGiving} sub={extras.donations ? "Only confirmed transactions count" : "No donation data"} />
      </div>
      <div className="mt-3">
        <UnavailableState compact message="24h / 7d / 30d / YTD changes and the value chart need price history. The price service is not connected." />
      </div>
      <Card title="Holdings" className="mt-6" right={<DataSourceBadge dataSource={portfolio.dataSource} verifiedOnChain={portfolio.verifiedOnChain} />}>
        <PortfolioTable rows={rows} />
      </Card>
    </>
  );
}

export function TransactionsSection({ data, walletLabel }: { data: TransactionsResponse; walletLabel: string }) {
  return (
    <Card title="Recent transactions" className="mt-6" right={<DataSourceBadge dataSource={data.dataSource} verifiedOnChain={data.verifiedOnChain} />}>
      <DemoDataNotice dataSource={data.dataSource} message="Placeholder signatures (DEMO-SIG-*). These transactions do not exist on any chain." />
      {data.transactions.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No transactions for this wallet.</p>
      ) : (
        <TransactionTable rows={transactionsFromApi(data, walletLabel)} />
      )}
    </Card>
  );
}

function Body({ wallet, wallets, onSelect }: { wallet: Wallet; wallets: Wallet[]; onSelect: (id: string) => void }) {
  const w = useWallet();
  const refresh = () => void w.refreshSession();
  const portfolio = useResource(`portfolio:${wallet.id}`, () => api.getPortfolio(wallet.id), refresh);
  const transactions = useResource(`tx:${wallet.id}`, () => api.getTransactions(wallet.id, { limit: 25 }), refresh);
  // Supplementary figures are fetched independently; a missing one shows "—" instead of failing the page.
  const tax = useResource(`tax:${wallet.id}`, () => api.getTaxEstimate(wallet.id));
  const reserve = useResource(`reserve:${wallet.id}`, () => api.getTaxReserve(wallet.id));
  const donations = useResource(`donations:${wallet.id}`, () => api.getDonations(wallet.id));
  const pick = <T,>(r: { status: string; data?: T }): T | null => (r.status === "ok" ? ((r as { data: T }).data) : null);

  return (
    <>
      <WalletPicker wallets={wallets} selectedId={wallet.id} onSelect={onSelect} />
      <ResourceView
        resource={portfolio}
        loadingLabel="Loading portfolio"
        noData={<NoLiveData title="NO LIVE PORTFOLIO DATA YET" message="Your wallet is authenticated, but blockchain indexing has not been connected yet." />}
      >
        {(p) => (
          <PortfolioView portfolio={p} extras={{ tax: pick<TaxResponse>(tax), reserve: pick<TaxReserveResponse>(reserve), donations: pick<DonationsResponse>(donations), walletCount: wallets.length }} />
        )}
      </ResourceView>
      <ResourceView
        resource={transactions}
        loadingLabel="Loading transactions"
        noData={<div className="mt-6"><NoLiveData title="NO LIVE TRANSACTIONS YET" message="No transactions are shown because none have been indexed from the blockchain for your wallet." /></div>}
      >
        {(t) => <TransactionsSection data={t} walletLabel={wallet.label ?? "Wallet"} />}
      </ResourceView>
    </>
  );
}

export function PortfolioScreen(): ReactNode {
  const scope = useScopedWallet();
  return (
    <div>
      <PageHeader eyebrow="Track" title="Portfolio" subtitle="Balances for the selected wallet. Real indexed data only; demo records are always labeled and never attached to your wallet." />
      {scope.gate === "checking" ? <LoadingState label="Checking session" /> : null}
      {scope.gate === "unauthenticated" ? <AuthRequired /> : null}
      {scope.gate === "ready" ? (
        <ResourceView resource={scope.walletsState} loadingLabel="Loading wallets">
          {() => (scope.wallet ? <Body key={scope.wallet.id} wallet={scope.wallet} wallets={scope.wallets} onSelect={scope.select} /> : <NoLiveData title="NO WALLETS" message="No wallets are linked to this account." />)}
        </ResourceView>
      ) : null}
    </div>
  );
}
