"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { DiscoverResponse } from "@project-name/shared";
import { api, type DiscoverParams } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { cn } from "@/lib/cn";
import { formatCompactUsd, formatDate, formatPercentBps } from "@/lib/format";
import { transparencyBadge } from "@/lib/transparency";
import { Badge } from "../Badge";
import { DataSourceBadge, DemoDataNotice } from "../DataSource";
import { EmptyState } from "../EmptyState";
import { PageHeader } from "../PageHeader";
import { ResourceView } from "../states";

/** Each UI filter maps to API query parameters. Nothing is ranked client-side. */
export const DISCOVER_FILTERS: Array<{ id: string; label: string; params: DiscoverParams }> = [
  { id: "new", label: "New", params: { sort: "newest", launchedWithinDays: 14 } },
  { id: "trending", label: "Trending", params: { sort: "trending" } },
  { id: "volume", label: "Highest Volume", params: { sort: "volume" } },
  { id: "liquidity", label: "Highest Liquidity", params: { sort: "liquidity" } },
  { id: "holders", label: "Most Holders", params: { sort: "holders" } },
  { id: "charity", label: "Most Charity Generated", params: { sort: "charity" } },
  { id: "concentration", label: "Lowest Creator Concentration", params: { sort: "lowestCreatorConcentration" } },
  { id: "recent", label: "Recently Launched", params: { sort: "newest" } },
  { id: "verified", label: "Verified Transparency", params: { sort: "liquidity", verifiedTransparency: true } },
];

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="eyebrow">{label}</dt><dd className="num mt-0.5">{value}</dd></div>;
}

/** Pure view of a discover response. */
export function DiscoverResults({ data }: { data: DiscoverResponse }) {
  return (
    <>
      <p className="mt-3 text-xs text-muted"><span className="font-semibold text-fg">Ranking rule:</span> {data.ranking.rule}</p>
      <div className="mt-2 flex items-center gap-2"><DataSourceBadge dataSource={data.dataSource} verifiedOnChain={data.verifiedOnChain} /></div>
      <div className="mt-3"><DemoDataNotice dataSource={data.dataSource} message={data.notice} /></div>
      {data.tokens.length === 0 ? (
        <EmptyState badge="NO MATCHES" title="NO TOKENS MATCH" description="Nothing matches this filter. No tokens are invented to fill the list." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.tokens.map((t) => {
            const b = transparencyBadge({ reported: t.transparencyChecksReported, total: t.transparencyChecksTotal, verifiedOnChain: data.verifiedOnChain, dataSource: t.dataSource });
            return (
              <Link key={t.id} href={`/token/${t.id}`} className="group rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold group-hover:text-accent">{t.name}</h3>
                    <p className="text-xs text-faint">{t.symbol} · launched {formatDate(t.launchedAt)}</p>
                  </div>
                  <DataSourceBadge dataSource={t.dataSource} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <Metric label="Market cap" value={formatCompactUsd(BigInt(t.marketCapCents))} />
                  <Metric label="Liquidity" value={formatCompactUsd(BigInt(t.liquidityCents))} />
                  <Metric label="Volume 24h" value={formatCompactUsd(BigInt(t.volume24hCents))} />
                  <Metric label="Holders" value={t.holders.toLocaleString("en-US")} />
                  <Metric label="Creator concentration" value={formatPercentBps(t.creatorConcentrationBps)} />
                  <Metric label="Charity generated" value={formatCompactUsd(BigInt(t.charityGeneratedCents))} />
                </dl>
                <div className="mt-4 border-t border-line pt-3"><Badge tone={b.tone}>{b.label}</Badge></div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

export function DiscoverScreen(): ReactNode {
  const [id, setId] = useState("volume");
  const filter = DISCOVER_FILTERS.find((f) => f.id === id)!;
  const res = useResource(`discover:${id}`, () => api.getDiscover(filter.params));
  return (
    <div>
      <PageHeader eyebrow="Discover" title="Discover" subtitle="Ranked by disclosed, checkable data. Every ranking rule is shown. No paid placement and no hype scores." />
      <div role="tablist" aria-label="Discover filters" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
        {DISCOVER_FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={f.id === id} type="button" onClick={() => setId(f.id)}
            className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors", f.id === id ? "border-accent/60 bg-accent/10 text-accent" : "border-line-strong text-muted hover:text-fg")}>
            {f.label}
          </button>
        ))}
      </div>
      <ResourceView resource={res} loadingLabel="Loading tokens">{(d) => <DiscoverResults data={d} />}</ResourceView>
      <p className="mt-6 text-xs text-faint">All tokens here are fictional demo entries and do not exist on any chain. No social signals are shown.</p>
    </div>
  );
}
