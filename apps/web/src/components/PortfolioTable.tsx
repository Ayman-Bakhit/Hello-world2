"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatPercentBps, formatPrice, formatUsd } from "@/lib/format";
import type { PortfolioRow } from "@/lib/portfolio";
import { Badge } from "./Badge";

type SortKey = "symbol" | "balanceNum" | "priceMicro" | "valueCents" | "costBasisCents" | "unrealizedCents" | "realizedCents" | "allocationBps";

const COLUMNS: Array<{ key: SortKey; label: string; align: "left" | "right" }> = [
  { key: "symbol", label: "Asset", align: "left" },
  { key: "balanceNum", label: "Balance", align: "right" },
  { key: "priceMicro", label: "Price", align: "right" },
  { key: "valueCents", label: "Value", align: "right" },
  { key: "costBasisCents", label: "Cost Basis", align: "right" },
  { key: "unrealizedCents", label: "Unrealized P&L", align: "right" },
  { key: "realizedCents", label: "Realized P&L", align: "right" },
  { key: "allocationBps", label: "Allocation", align: "right" },
];

const pnlClass = (v: bigint | null) => (v === null ? "text-faint" : v > 0n ? "text-gain" : v < 0n ? "text-loss" : "text-muted");
const UNPRICED = <span className="text-xs font-semibold tracking-wide text-faint">PRICE UNAVAILABLE</span>;

function compare(a: PortfolioRow, b: PortfolioRow, key: SortKey): number {
  const x = a[key], y = b[key];
  if (x === null || y === null) return x === y ? 0 : x === null ? -1 : 1; // unknown sorts as lowest, never as zero
  if (typeof x === "string" && typeof y === "string") return x.localeCompare(y);
  if (typeof x === "bigint" && typeof y === "bigint") return x < y ? -1 : x > y ? 1 : 0;
  return Number(x) - Number(y);
}

export function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "valueCents", dir: "desc" });
  const sorted = useMemo(() => {
    const out = [...rows].sort((a, b) => compare(a, b, sort.key));
    return sort.dir === "desc" ? out.reverse() : out;
  }, [rows, sort]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-line">
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                className={cn("px-3 py-2 font-normal", c.align === "right" ? "text-right" : "text-left")}
              >
                <button
                  type="button"
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === "desc" ? "asc" : "desc" }))}
                  className={cn("eyebrow inline-flex items-center gap-1 hover:!text-fg", sort.key === c.key && "!text-fg")}
                >
                  {c.label}
                  <span aria-hidden>{sort.key === c.key ? (sort.dir === "desc" ? "↓" : "↑") : ""}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key} className="border-b border-line/60 last:border-0 hover:bg-surface-2/50">
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className={cn("font-semibold", r.mint && "font-mono text-xs")} title={r.mint ?? undefined}>{r.symbol}</span>
                  {r.isDemoToken ? <Badge tone="demo">FICTIONAL</Badge> : null}
                </div>
                {r.mint ? (
                  <div className="mt-0.5 text-xs text-faint">
                    {r.metadata?.status === "resolved" ? (
                      <>
                        <span>{[r.metadata.symbol, r.metadata.name].filter(Boolean).join(" · ") || "No name in metadata"}</span>
                        <span className="ml-2 font-semibold tracking-wide text-warn">UNVERIFIED METADATA</span>
                      </>
                    ) : (
                      <span className="font-semibold tracking-wide">METADATA UNAVAILABLE</span>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-faint">{r.name}</div>
                )}
              </td>
              <td className="num px-3 py-3 text-right" title={r.quantityExact ? `On-chain balance: ${r.quantityExact}` : undefined}>{r.balanceDisplay}</td>
              <td className="num px-3 py-3 text-right">
                {r.priceMicro === null ? UNPRICED : <>{formatPrice(r.priceMicro)}{r.valuation === "stale_price" ? <span className="ml-1 text-xs text-warn">STALE</span> : null}</>}
              </td>
              <td className="num px-3 py-3 text-right font-semibold">{r.valueCents === null ? <span className="text-faint">—</span> : formatUsd(r.valueCents, { cents: true })}</td>
              <td className="num px-3 py-3 text-right text-muted">{r.costBasisCents === null ? "—" : formatUsd(r.costBasisCents, { cents: true })}</td>
              <td className={cn("num px-3 py-3 text-right", pnlClass(r.unrealizedCents))}>{r.unrealizedCents === null ? "—" : formatUsd(r.unrealizedCents, { cents: true, signed: true })}</td>
              <td className={cn("num px-3 py-3 text-right", pnlClass(r.realizedCents))}>{r.realizedCents === null ? "—" : formatUsd(r.realizedCents, { cents: true, signed: true })}</td>
              <td className="px-3 py-3">
                {r.allocationBps === null ? (
                  <span className="block text-right text-faint">—</span>
                ) : (
                  <div className="ml-auto flex w-28 items-center justify-end gap-2">
                    <span className="h-1 w-14 overflow-hidden rounded bg-line">
                      <span className="block h-full bg-accent/70" style={{ width: `${r.allocationBps / 100}%` }} />
                    </span>
                    <span className="num w-12 text-right text-xs text-muted">{formatPercentBps(r.allocationBps)}</span>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
