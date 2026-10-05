import { Badge } from "./Badge";
import { Card } from "./Card";

export interface ProofRow {
  label: string;
  value: string;
  status: "DEMO" | "NOT CONNECTED" | "NOT IMPLEMENTED";
  mono?: boolean;
}

/**
 * Each row will link to chain evidence once the indexer exists. Until then the evidence link is
 * explicitly unavailable: we never render a link that implies verification.
 */
export function ProofPanel({ title = "TRANSPARENCY", rows }: { title?: string; rows: ProofRow[] }) {
  return (
    <Card title={title} right={<Badge tone="demo">NOT VERIFIED ON-CHAIN</Badge>}>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.label} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="eyebrow">{r.label}</p>
              <p className={`mt-0.5 break-all text-sm ${r.mono ? "num font-mono text-xs" : ""}`}>{r.value}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone="demo">{r.status}</Badge>
              <span className="text-[11px] text-faint" title="Explorer evidence appears here once on-chain data is connected.">
                explorer link unavailable
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
