import type { DataSource } from "@project-name/shared";
import { Badge } from "./Badge";

/**
 * How a record should be labeled, derived ONLY from what the API says.
 *   demo     -> DEMO DATA      (fictional fixture; never associated with the signed-in wallet)
 *   chain    -> LIVE DATA      (read from a Solana RPC node by the indexer. This is NOT a claim of independent
 *                              verification: that needs an objective source and is never inferred)
 *   database -> ACCOUNT DATA   (saved in this app's database; not blockchain data)
 */
export function dataSourceLabel(dataSource: DataSource, verifiedOnChain = false): { label: string; tone: "demo" | "good" | "info" | "neutral" } {
  if (dataSource === "demo") return { label: "DEMO DATA", tone: "demo" };
  if (dataSource === "chain") return { label: "LIVE DATA", tone: verifiedOnChain ? "good" : "info" };
  return { label: "ACCOUNT DATA", tone: "info" };
}

export function DataSourceBadge({ dataSource, verifiedOnChain }: { dataSource: DataSource; verifiedOnChain?: boolean }) {
  const { label, tone } = dataSourceLabel(dataSource, verifiedOnChain);
  return <Badge tone={tone}>{label}</Badge>;
}

/** Full-width notice shown above any block of demo data. Renders nothing for other sources. */
export function DemoDataNotice({ dataSource, message }: { dataSource: DataSource; message?: string }) {
  if (dataSource !== "demo") return null;
  return (
    <div role="note" className="mb-4 rounded-md border border-warn/30 bg-warn/[0.07] px-3 py-2 text-xs text-warn">
      <span className="mr-2 font-bold tracking-wider">DEMO DATA</span>
      {message ?? "Fictional records for demonstration. They do not belong to any wallet and nothing was read from a blockchain."}
    </div>
  );
}
