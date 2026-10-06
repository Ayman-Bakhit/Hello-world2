"use client";

import { COPY, type DonationsResponse, type PortfolioResponse, type TaxReserveResponse, type TaxResponse, type TransactionsResponse, type Wallet } from "@project-name/shared";
import type { ReactNode } from "react";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { portfolioRowsFromApi, transactionsFromApi } from "@/lib/adapters";
import { formatPercentBps, formatUsd } from "@/lib/format";
import { useWalletSync } from "@/lib/useWalletSync";
import { useScopedWallet } from "@/lib/useScopedWallet";
import { useWallet } from "@/state/wallet";
import { Card } from "../Card";
import { DataSourceBadge, DemoDataNotice } from "../DataSource";
import { NoLiveData, ResourceView, AuthRequired, LoadingState, UnavailableState } from "../states";
import { PageHeader } from "../PageHeader";
import { PortfolioTable } from "../PortfolioTable";
import { SyncPanel } from "../SyncPanel";
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

const UNPRICED = "PRICE DATA UNAVAILABLE";

/** Pure view of a loaded portfolio. Everything shown comes from the API response. */
export function PortfolioView({ portfolio, extras }: { portfolio: PortfolioResponse; extras: PortfolioExtras }) {
  const rows = portfolioRowsFromApi(portfolio);
  const live = portfolio.dataSource === "chain";
  const unrealized = portfolio.unrealizedPnlCents === null ? null : BigInt(portfolio.unrealizedPnlCents);
  const realized = portfolio.realizedPnlCents === null ? null : BigInt(portfolio.realizedPnlCents);
  const dash = "—";
  const confirmedGiving = extras.donations ? formatUsd(BigInt(extras.donations.confirmedTotalCents)) : dash;
  const { valuation } = portfolio;
  // A partial sum is never presented as the total.
  const totalValue = portfolio.totalValueCents === null ? <span className="text-base sm:text-lg">{UNPRICED}</span> : formatUsd(BigInt(portfolio.totalValueCents), { cents: true });
  const totalSub =
    portfolio.totalValueCents === null
      ? portfolio.partialValueCents !== null
        ? `Partial: ${formatUsd(BigInt(portfolio.partialValueCents), { cents: true })} from ${valuation.pricedAssets} of ${valuation.pricedAssets + valuation.unpricedAssets} assets with a price`
        : "No asset has a price yet. Balances below are on-chain; value is unknown."
      : valuation.status === "stale" ? "Includes a stale price" : null;
  return (
    <>
      <DemoDataNotice dataSource={portfolio.dataSource} message="These fictional balances belong to the demo account, not to any real wallet. Nothing was read from a blockchain." />
      {live ? (
        <div role="note" className="mb-4 rounded-md border border-b-creator/30 bg-b-creator/[0.07] px-3 py-2 text-xs text-b-creator">
          <span className="mr-2 font-bold tracking-wider">LIVE DATA</span>
          Read from a Solana RPC node{portfolio.source.cluster ? ` (${portfolio.source.cluster})` : ""}{portfolio.source.slot !== null ? ` at slot ${portfolio.source.slot}` : ""}. Balances are on-chain; prices and values are separate and shown only when a price source has one. Not independently verified.
        </div>
      ) : null}
      {live && !portfolio.source.holdingsComplete ? (
        <div role="alert" className="mb-4 rounded-md border border-warn/30 bg-warn/[0.07] px-3 py-2 text-xs text-warn">
          <span className="mr-2 font-bold tracking-wider">INCOMPLETE</span>
          The last sync could not list every holding (or is still running), so the asset list may be missing tokens and no total is shown.
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={live ? "Total portfolio value (USD)" : "Total portfolio value"} value={totalValue} sub={<><DataSourceBadge dataSource={portfolio.dataSource} verifiedOnChain={portfolio.verifiedOnChain} />{totalSub ? <span className="ml-2">{totalSub}</span> : null}</>} className="col-span-2" />
        <StatCard label="Cost basis" value={portfolio.costBasisCents === null ? dash : formatUsd(BigInt(portfolio.costBasisCents))} sub={portfolio.costBasisCents === null ? "Needs classified transactions" : undefined} />
        <StatCard label="Assets" value={String(rows.length)} sub={`${extras.walletCount} wallet${extras.walletCount === 1 ? "" : "s"}`} />
        <StatCard label="Realized P&L" value={realized === null ? dash : formatUsd(realized, { signed: true })} tone={realized === null ? "neutral" : toneOf(realized)} sub={realized === null ? "Not computed for live wallets yet" : undefined} />
        <StatCard label="Unrealized P&L" value={unrealized === null ? dash : formatUsd(unrealized, { signed: true })} tone={unrealized === null ? "neutral" : toneOf(unrealized)} sub={unrealized === null ? "Not computed for live wallets yet" : undefined} />
        <StatCard label={COPY.taxExposure} value={extras.tax ? formatUsd(BigInt(extras.tax.estimatedTaxExposureCents)) : dash} sub={extras.tax ? COPY.taxPlanning : "No live tax data"} />
        <StatCard label={COPY.taxReserve} value={extras.reserve ? formatUsd(BigInt(extras.reserve.currentReserveCents)) : dash} sub={extras.reserve && extras.reserve.coverageBps !== null ? `${formatPercentBps(extras.reserve.coverageBps)} coverage` : "No live reserve data"} />
        <StatCard label="Confirmed on-chain giving" value={confirmedGiving} sub={extras.donations ? "Only confirmed transactions count" : "No donation data"} />
      </div>
      <div className="mt-3">
        <UnavailableState compact message="24h / 7d / 30d / YTD changes and the value chart need price history. The price service is not connected." />
      </div>
      <Card title="Holdings" className="mt-6" right={<DataSourceBadge dataSource={portfolio.dataSource} verifiedOnChain={portfolio.verifiedOnChain} />}>
        {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">This wallet holds no SOL or tokens on {portfolio.source.cluster ?? "this cluster"}.</p> : <PortfolioTable rows={rows} />}
      </Card>
    </>
  );
}

export function TransactionsSection({ data, walletLabel }: { data: TransactionsResponse; walletLabel: string }) {
  return (
    <Card title="Recent transactions" className="mt-6" right={<DataSourceBadge dataSource={data.dataSource} verifiedOnChain={data.verifiedOnChain} />}>
      <DemoDataNotice dataSource={data.dataSource} message="Placeholder signatures (DEMO-SIG-*). These transactions do not exist on any chain." />
      {data.dataSource === "chain" && data.window ? (
        <p className="mb-3 text-xs text-muted">
          {data.window.indexedCount} indexed{data.window.historyComplete ? " (full history)" : " (recent history only; older transactions are not indexed)"}.
          Types are conservative labels of what moved, not tax conclusions.
          {data.window.hasGap ? " Some transactions between syncs may be missing." : ""}
        </p>
      ) : null}
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
  const sync = useWalletSync(wallet.id, () => { portfolio.reload(); transactions.reload(); });
  // Supplementary figures are fetched independently; a missing one shows "—" instead of failing the page.
  const tax = useResource(`tax:${wallet.id}`, () => api.getTaxEstimate(wallet.id));
  const reserve = useResource(`reserve:${wallet.id}`, () => api.getTaxReserve(wallet.id));
  const donations = useResource(`donations:${wallet.id}`, () => api.getDonations(wallet.id));
  const pick = <T,>(r: { status: string; data?: T }): T | null => (r.status === "ok" ? ((r as { data: T }).data) : null);

  return (
    <>
      <WalletPicker wallets={wallets} selectedId={wallet.id} onSelect={onSelect} />
      <SyncPanel status={sync.status} syncing={sync.syncing} error={sync.error} onSync={() => void sync.start()} />
      <div className="mt-6" />
      <ResourceView
        resource={portfolio}
        loadingLabel="Loading portfolio"
        noData={
          sync.syncing
            ? <NoLiveData title="INDEXING WALLET" message="Reading this wallet from the blockchain. Live data appears here as soon as the first sync finishes." />
            : <NoLiveData title="NO LIVE PORTFOLIO DATA YET" message={sync.status?.state === "indexing_unavailable" ? "This server is not connected to a Solana RPC node, so no live data can be loaded." : "Your wallet is authenticated, but nothing has been read from the blockchain for it yet. Press SYNC WALLET."} />
        }
      >
        {(p) => (
          <PortfolioView portfolio={p} extras={{ tax: pick<TaxResponse>(tax), reserve: pick<TaxReserveResponse>(reserve), donations: pick<DonationsResponse>(donations), walletCount: wallets.length }} />
        )}
      </ResourceView>
      <ResourceView
        resource={transactions}
        loadingLabel="Loading transactions"
        noData={<div className="mt-6"><NoLiveData title={sync.syncing ? "INDEXING WALLET" : "NO LIVE TRANSACTIONS YET"} message="No transactions are shown because none have been indexed from the blockchain for your wallet yet." /></div>}
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
