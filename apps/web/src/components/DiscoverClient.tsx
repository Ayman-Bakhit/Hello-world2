"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { FILTERS, TOTAL_CHECKS, type FilterId } from "@/lib/discover";
import { formatCompactUsd, formatDate, formatPercentBps } from "@/lib/format";
import type { Token } from "@/lib/types";
import { tokenCharityGeneratedCents, tokenChecksPassed } from "@/mock/tokens";
import { Badge } from "./Badge";

export function TransparencyStatus({ token }: { token: Token }) {
  const n = tokenChecksPassed(token);
  return n === TOTAL_CHECKS ? (
    <Badge tone="info">ALL {TOTAL_CHECKS} CHECKS REPORTED · DEMO</Badge>
  ) : (
    <Badge tone="neutral">{n}/{TOTAL_CHECKS} CHECKS REPORTED · DEMO</Badge>
  );
}

export function DiscoverClient({ tokens }: { tokens: Token[] }) {
  const [id, setId] = useState<FilterId>("volume");
  const filter = FILTERS.find((f) => f.id === id)!;
  const shown = filter.apply(tokens);

  return (
    <div>
      <div role="tablist" aria-label="Discover filters" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={f.id === id}
            type="button"
            onClick={() => setId(f.id)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors",
              f.id === id ? "border-accent/60 bg-accent/10 text-accent" : "border-line-strong text-muted hover:text-fg",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted"><span className="font-semibold text-fg">Ranking rule:</span> {filter.rule}</p>

      {shown.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line-strong p-8 text-center text-sm text-muted">
          No demo tokens match this filter.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => (
            <Link key={t.slug} href={`/token/${t.slug}`} className="group rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold group-hover:text-accent">{t.name}</h3>
                  <p className="text-xs text-faint">{t.symbol} · launched {formatDate(t.launchedAt)}</p>
                </div>
                <Badge tone="demo">DEMO</Badge>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Metric label="Market cap" value={formatCompactUsd(t.marketCapCents)} />
                <Metric label="Liquidity" value={formatCompactUsd(t.liquidityCents)} />
                <Metric label="Volume 24h" value={formatCompactUsd(t.volume24hCents)} />
                <Metric label="Holders" value={t.holders.toLocaleString("en-US")} />
                <Metric label="Creator concentration" value={formatPercentBps(t.creatorAllocationBps)} />
                <Metric label="Charity generated" value={formatCompactUsd(tokenCharityGeneratedCents(t))} />
              </dl>
              <div className="mt-4 border-t border-line pt-3"><TransparencyStatus token={t} /></div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-0.5">{value}</dd>
    </div>
  );
}
