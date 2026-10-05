import { formatPercentBps, formatUsd } from "@/lib/format";
import type { Token } from "@/lib/types";
import { Badge } from "./Badge";
import { Card } from "./Card";

type Level = "ok" | "watch" | "info";

export interface Row {
  label: string;
  value: string;
  level: Level;
}

const dot: Record<Level, string> = { ok: "bg-gain", watch: "bg-warn", info: "bg-faint" };

/** Indicators only. Deliberately has no aggregate score and never says "safe". */
export function rowsForToken(t: Token): Row[] {
  return [
    { label: "Mint authority", value: t.mintAuthority === "disabled" ? "Disabled" : "Held by creator", level: t.mintAuthority === "disabled" ? "ok" : "watch" },
    { label: "Freeze authority", value: t.freezeAuthority === "disabled" ? "Disabled" : "Held by creator", level: t.freezeAuthority === "disabled" ? "ok" : "watch" },
    { label: "Creator allocation", value: formatPercentBps(t.creatorAllocationBps), level: t.creatorAllocationBps > 2000 ? "watch" : "info" },
    { label: "Top 10 concentration", value: formatPercentBps(t.top10Bps), level: t.top10Bps > 4000 ? "watch" : "info" },
    {
      label: "Liquidity",
      value: `${formatUsd(t.liquidityCents)}${t.liquidityLockDays ? ` · lock ${t.liquidityLockDays}d` : " · no lock disclosed"}`,
      level: t.liquidityLockDays ? "info" : "watch",
    },
    { label: "Admin privileges", value: t.adminPrivileges === "none" ? "None disclosed" : "Fee configuration (admin controlled)", level: t.adminPrivileges === "none" ? "ok" : "watch" },
  ];
}

export function RiskPanel({ title = "TRANSPARENCY DATA", rows, demo = true }: { title?: "TRANSPARENCY DATA" | "RISK INDICATORS"; rows: Row[]; demo?: boolean }) {
  return (
    <Card title={title} right={demo ? <Badge tone="demo">DEMO · NOT VERIFIED ON-CHAIN</Badge> : undefined}>
      <p className="eyebrow mb-1">Contract</p>
      <dl className="divide-y divide-line">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
            <dt className="flex items-center gap-2 text-muted">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot[r.level]}`} />
              {r.label}
            </dt>
            <dd className="num text-right">{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-faint">
        Indicators are data points, not a safety rating. Low concentration or disabled authorities do not mean a token is
        safe. Do your own research.
      </p>
    </Card>
  );
}
