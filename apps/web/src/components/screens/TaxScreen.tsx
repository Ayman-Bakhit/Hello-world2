"use client";

import { COPY, type TaxCalculateResponse, type TaxDetailsResponse, type TaxResponse, type TaxReserveResponse } from "@project-name/shared";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { formatPercentBps, formatUsd } from "@/lib/format";
import type { TaxQueryParams } from "@/lib/taxQuery";
import { useScopedWallet } from "@/lib/useScopedWallet";
import { useWallet } from "@/state/wallet";
import { ButtonLink } from "../Button";
import { Card } from "../Card";
import { DataSourceBadge, DemoDataNotice } from "../DataSource";
import { ManualBasisPanel } from "../ManualBasisPanel";
import { PageHeader } from "../PageHeader";
import { AuthRequired, LoadingState, NoLiveData, ResourceView } from "../states";
import { StatCard } from "../StatCard";
import { RealizedTable, TaxEventsTable, TaxInputsForm, TaxStatusPanel } from "../TaxParts";
import { TaxReserveCard } from "../TaxReserveCard";
import { WalletPicker } from "./WalletPicker";

const money = (v: string | null, opts?: { negate?: boolean }) => (v === null ? null : formatUsd(opts?.negate ? -BigInt(v) : BigInt(v)));

/**
 * Pure view. All wording is "estimated"; there is no tax-bill field in the API and none here.
 * A missing number is shown as a dash with the reason, never as $0. When status is not COMPLETE the figures carry
 * "Tax data incomplete" so a partial result cannot be mistaken for a total.
 */
export function TaxView({ tax, reserve, details }: { tax: TaxResponse; reserve: TaxReserveResponse | null; details: TaxDetailsResponse | null }) {
  const a = tax.assumptions;
  const incomplete = tax.status !== "COMPLETE";
  const dash = "—";
  const exposure = tax.estimatedTaxExposureCents === null ? null : BigInt(tax.estimatedTaxExposureCents);
  const why = tax.status === "UNAVAILABLE" ? "Unavailable" : "Tax data incomplete";
  const sub = incomplete ? why : undefined;
  const reserveCents = reserve && reserve.currentReserveCents !== null ? BigInt(reserve.currentReserveCents) : null;
  return (
    <>
      <DemoDataNotice dataSource={tax.dataSource} message="Estimated from fictional demo events with example tax rates. This is not your tax situation and nothing was read from a blockchain." />
      <TaxStatusPanel tax={tax} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Estimated realized gains" value={money(tax.estimatedRealizedGainsCents) ?? dash} tone="gain" sub={sub} />
        <StatCard label="Estimated realized losses" value={money(tax.estimatedRealizedLossesCents, { negate: true }) ?? dash} tone="loss" sub={sub} />
        <StatCard label="Estimated taxable events" value={tax.status === "UNAVAILABLE" ? dash : String(tax.estimatedTaxableEvents)} sub={`Tax year ${tax.taxYear}`} />
        <StatCard
          label={COPY.taxExposure}
          value={exposure === null ? dash : formatUsd(exposure)}
          sub={exposure === null ? (tax.status === "UNAVAILABLE" ? "Unavailable" : "Rates required: enter your own rates below") : incomplete ? `${COPY.taxPlanning}. ${why}` : COPY.taxPlanning}
        />
        <StatCard label="Estimated tax reserve" value={reserveCents === null ? dash : formatUsd(reserveCents)} sub={reserve ? (reserveCents === null ? "Reserve balance not read from any chain" : undefined) : "No live reserve data"} />
        <StatCard label="Reserve coverage" value={reserve?.coverageBps == null ? dash : formatPercentBps(reserve.coverageBps)} />
      </div>

      {reserve && reserveCents !== null && exposure !== null ? (
        <div className="mt-6">
          <TaxReserveCard reserveCents={reserveCents} exposureCents={exposure} actions={<ButtonLink href="/tax-reserve" variant="secondary">MANAGE RESERVE TARGET</ButtonLink>} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Assumptions used" right={<DataSourceBadge dataSource={tax.dataSource} verifiedOnChain={tax.verifiedOnChain} />}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Jurisdiction", a ? a.jurisdiction : "US (estimate only)"],
              ["Cost basis method", `${tax.costBasisMethod}${tax.methodSource === "default" ? " (default)" : ""}`],
              ["Short-term rate", a ? formatPercentBps(a.shortTermRateBps, { digits: 0 }) : "Not supplied"],
              ["Long-term rate", a ? formatPercentBps(a.longTermRateBps, { digits: 0 }) : "Not supplied"],
              ["State rate", a ? formatPercentBps(a.stateRateBps, { digits: 0 }) : "Not supplied"],
              ["Short-term net", money(tax.estimatedShortTermNetCents) ?? dash],
              ["Long-term net", money(tax.estimatedLongTermNetCents) ?? dash],
              ["Method", `${tax.methodology.name} v${tax.methodology.version}`],
            ].map(([k, v]) => (<div key={k}><dt className="eyebrow">{k}</dt><dd className="num mt-0.5">{v}</dd></div>))}
          </dl>
          <p className="mt-3 text-xs text-faint">Limitations of this estimate:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-faint">{tax.methodology.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </Card>
        <Card title="About these numbers">
          <div className="space-y-2 text-sm text-muted">{tax.disclaimer.map((d) => <p key={d}>{d}</p>)}</div>
          <p className="mt-3 text-xs text-faint">This is not personalized tax advice.</p>
          <p className="mt-3 text-xs text-faint">
            Official information:{" "}
            <a className="text-accent underline underline-offset-2" href={COPY.irsCrypto} target="_blank" rel="noopener noreferrer">IRS digital assets</a>
          </p>
        </Card>
      </div>

      {details ? (
        <>
          <Card title="Estimated realized gains and losses" className="mt-6" right={<DataSourceBadge dataSource={details.dataSource} verifiedOnChain={details.verifiedOnChain} />}>
            {details.note ? <p className="mb-3 text-xs text-faint">{details.note}</p> : null}
            <RealizedTable rows={details.realized} />
          </Card>
          <Card title="Tax events, unresolved items and missing data" className="mt-6">
            <TaxEventsTable events={details.events} truncated={details.truncated} />
          </Card>
        </>
      ) : null}
    </>
  );
}

function Body({ walletId, wallets, onSelect }: { walletId: string; wallets: Parameters<typeof WalletPicker>[0]["wallets"]; onSelect: (id: string) => void }) {
  const w = useWallet();
  const refresh = () => void w.refreshSession();
  const [q, setQ] = useState<TaxQueryParams>({});
  const [rev, setRev] = useState(0);
  // Rates and other inputs stay in memory and are sent in POST bodies: never in a URL, never persisted.
  const key = `${walletId}:${JSON.stringify(q)}:${rev}`;
  const calc = useResource(`tax-calc:${key}`, () => api.calculateTax(walletId, q), refresh);
  const reserve = useResource(`reserve-calc:${key}`, () => api.calculateTaxReserve(walletId, q));
  // keep the last good result mounted while a recalculation runs, so open forms and notices are not lost
  const data: TaxCalculateResponse | null = calc.status === "ok" ? calc.data : calc.status === "loading" ? (calc.previous ?? null) : null;
  return (
    <>
      <WalletPicker wallets={wallets} selectedId={walletId} onSelect={onSelect} />
      {data ? (
        <>
          <TaxView tax={data.tax} reserve={reserve.status === "ok" ? reserve.data : null} details={data.details} />
          {data.tax.dataSource === "chain" ? (
            <>
              <ManualBasisPanel walletId={walletId} details={data.details} onChanged={() => setRev((n) => n + 1)} />
              <div className="mt-6"><TaxInputsForm onApply={setQ} /></div>
            </>
          ) : null}
          {calc.status === "loading" ? <p role="status" className="mt-3 text-xs text-muted">Recalculating…</p> : null}
        </>
      ) : (
        <ResourceView resource={calc} loadingLabel="Loading tax estimate" noData={<NoLiveData title="NO LIVE TAX DATA YET" message="Your wallet is authenticated, but no tax data is available for it yet." />}>
          {() => null}
        </ResourceView>
      )}
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
        subtitle="Estimated realized gains and tax exposure from the data available. Incomplete data is flagged, never filled in."
        actions={<ButtonLink href="/tax-reserve" variant="secondary">TAX RESERVE</ButtonLink>}
      />
      {scope.gate === "checking" ? <LoadingState label="Checking session" /> : null}
      {scope.gate === "unauthenticated" ? <AuthRequired /> : null}
      {scope.gate === "ready" ? (
        <ResourceView resource={scope.walletsState} loadingLabel="Loading wallets">
          {() => scope.wallet ? <Body key={scope.wallet.id} walletId={scope.wallet.id} wallets={scope.wallets} onSelect={scope.select} /> : <NoLiveData title="NO WALLETS" message="No wallets are linked to this account." />}
        </ResourceView>
      ) : null}
    </div>
  );
}
