import type { Metadata } from "next";
import { COPY, reserveStatus } from "@project-name/shared";
import { Card } from "@/components/Card";
import { DemoDataBanner } from "@/components/DemoDataBanner";
import { PageHeader } from "@/components/PageHeader";
import { PortfolioTable } from "@/components/PortfolioTable";
import { StatCard, toneOf } from "@/components/StatCard";
import { TransactionTable } from "@/components/TransactionTable";
import { ValueChart } from "@/components/ValueChart";
import { formatPercentBps, formatUsd } from "@/lib/format";
import { portfolioRows, portfolioTotals } from "@/lib/portfolio";
import { DEMO_DONATIONS, DEMO_PORTFOLIO, DEMO_TAX_ESTIMATE, DEMO_TAX_RESERVE, DEMO_TRANSACTIONS, DEMO_WALLET_POOL } from "@/mock";

export const metadata: Metadata = { title: "Portfolio" };

export default function PortfolioPage() {
  const t = portfolioTotals(DEMO_PORTFOLIO);
  const rows = portfolioRows(DEMO_PORTFOLIO);
  const c = DEMO_PORTFOLIO.changesBps;
  const reserve = reserveStatus(DEMO_TAX_RESERVE.reserveCents, DEMO_TAX_ESTIMATE.exposureCents);
  const giving = DEMO_DONATIONS.filter((d) => d.status === "confirmed").reduce((s, d) => s + d.amountCents, 0n);

  return (
    <div>
      <PageHeader eyebrow="Track" title="Portfolio" subtitle="All connected wallets in one place. Values use stored price observations once the price service exists." actions={<DemoDataBanner variant="chip" />} />

      <div className="grid gap-3 lg:grid-cols-[2fr_3fr]">
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="eyebrow">Total portfolio value</p>
          <p className="num mt-2 text-3xl font-semibold tracking-tight">{formatUsd(t.valueCents, { cents: true })}</p>
          <p className={`num mt-1 text-sm ${toneOf(c.d1) === "gain" ? "text-gain" : "text-loss"}`}>{formatPercentBps(c.d1, { signed: true })} 24h</p>
          <div className="mt-3"><ValueChart series={DEMO_PORTFOLIO.valueSeriesCents} label="Demo 30 day portfolio value" /></div>
          <p className="text-[11px] text-faint">30 day demo series</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="24h" value={formatPercentBps(c.d1, { signed: true })} tone={toneOf(c.d1)} />
          <StatCard label="7d" value={formatPercentBps(c.d7, { signed: true })} tone={toneOf(c.d7)} />
          <StatCard label="30d" value={formatPercentBps(c.d30, { signed: true })} tone={toneOf(c.d30)} />
          <StatCard label="Year to date" value={formatPercentBps(c.ytd, { signed: true })} tone={toneOf(c.ytd)} />
          <StatCard label="Realized P&L" value={formatUsd(t.realizedCents, { signed: true })} tone={toneOf(t.realizedCents)} />
          <StatCard label="Unrealized P&L" value={formatUsd(t.unrealizedCents, { signed: true })} tone={toneOf(t.unrealizedCents)} />
          <StatCard label={COPY.taxExposure} value={formatUsd(DEMO_TAX_ESTIMATE.exposureCents)} />
          <StatCard label={COPY.taxReserve} value={formatUsd(reserve.reserveCents)} />
          <StatCard label="Reserve coverage" value={reserve.coverageBps === null ? "n/a" : formatPercentBps(reserve.coverageBps)} />
          <StatCard label="Charitable giving" value={formatUsd(giving)} />
          <StatCard label="Wallets" value={String(DEMO_WALLET_POOL.length)} />
          <StatCard label="Assets" value={String(t.assets)} />
        </div>
      </div>

      <Card title="Holdings" className="mt-6" right={<DemoDataBanner variant="chip" />}>
        <PortfolioTable rows={rows} />
      </Card>
      <Card title="Recent transactions" className="mt-6" right={<DemoDataBanner variant="chip" />}>
        <TransactionTable rows={DEMO_TRANSACTIONS} />
      </Card>
    </div>
  );
}
