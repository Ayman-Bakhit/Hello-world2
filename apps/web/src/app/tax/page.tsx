import type { Metadata } from "next";
import { COPY } from "@project-name/shared";
import { ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { DemoDataBanner } from "@/components/DemoDataBanner";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { TaxReserveCard } from "@/components/TaxReserveCard";
import { TransactionTable } from "@/components/TransactionTable";
import { formatPercentBps, formatUsd } from "@/lib/format";
import { DEMO_TAX_ESTIMATE as E, DEMO_TAX_RESERVE, DEMO_TRANSACTIONS } from "@/mock";

export const metadata: Metadata = { title: "Tax Center" };

export default function TaxPage() {
  const a = E.assumptions;
  return (
    <div>
      <PageHeader
        eyebrow="Tax"
        title="TAX CENTER"
        subtitle="Never lose track of what you may owe. Track realized gains, estimate tax exposure, and keep a dedicated reserve."
        actions={<ButtonLink href="/tax-reserve" variant="primary">FUND TAX RESERVE</ButtonLink>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Estimated realized gains" value={formatUsd(E.realizedGainsCents)} tone="gain" />
        <StatCard label="Estimated realized losses" value={formatUsd(-E.realizedLossesCents)} tone="loss" />
        <StatCard label="Estimated taxable events" value={String(E.taxableEvents)} sub={`Tax year ${E.taxYear}`} />
        <StatCard label={COPY.taxExposure} value={formatUsd(E.exposureCents)} sub={COPY.taxPlanning} />
        <StatCard label="Current tax reserve" value={formatUsd(DEMO_TAX_RESERVE.reserveCents)} />
        <StatCard label="Reserve coverage" value={formatPercentBps(Number((DEMO_TAX_RESERVE.reserveCents * 10_000n) / E.exposureCents))} />
      </div>

      <div className="mt-6">
        <TaxReserveCard
          reserveCents={DEMO_TAX_RESERVE.reserveCents}
          exposureCents={E.exposureCents}
          actions={<ButtonLink href="/tax-reserve" variant="primary">FUND TAX RESERVE</ButtonLink>}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Assumptions used" right={<DemoDataBanner variant="chip" />}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Jurisdiction", a.jurisdiction],
              ["Cost basis method", E.costBasisMethod],
              ["Short-term rate", formatPercentBps(a.shortTermRateBps, { digits: 0 })],
              ["Long-term rate", formatPercentBps(a.longTermRateBps, { digits: 0 })],
              ["State rate", formatPercentBps(a.stateRateBps, { digits: 0 })],
              ["Short-term net", formatUsd(E.shortTermNetCents)],
              ["Long-term net", formatUsd(E.longTermNetCents)],
            ].map(([k, v]) => (
              <div key={k}><dt className="eyebrow">{k}</dt><dd className="num mt-0.5">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-faint">Rates are inputs, not advice. Editing assumptions arrives with the API. Brackets, NIIT, loss limits and state rules are not modeled.</p>
        </Card>
        <Card title="About these numbers">
          <p className="text-sm text-muted">
            Tax calculations are estimates and may not reflect your complete tax situation. Consult a qualified tax professional.
          </p>
          <p className="mt-3 text-xs text-faint">
            Official information:{" "}
            <a className="text-accent underline underline-offset-2" href={COPY.irsCrypto} target="_blank" rel="noopener noreferrer">IRS digital assets</a>
          </p>
        </Card>
      </div>

      <Card title="Potential taxable disposals" className="mt-6" right={<DemoDataBanner variant="chip" />}>
        <TransactionTable rows={DEMO_TRANSACTIONS.filter((t) => t.taxTreatment === "disposal")} />
      </Card>
    </div>
  );
}
