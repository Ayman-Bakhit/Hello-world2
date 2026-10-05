import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return (
    <div>
      <PageHeader eyebrow="Analytics" title="Analytics" subtitle="Portfolio, creator, and protocol analytics from indexed on-chain data." />
      <EmptyState
        title="Analytics need indexed data"
        description="Charts will be built on the transaction indexer (Slice 5). Until then, there is no real data to analyze and we won't invent any."
        items={["Portfolio value, realized and unrealized P&L", "Tax exposure and reserve coverage", "Giving and trading volume", "Creator volume, fees, holders, liquidity", "Protocol volume, revenue, charity generated"]}
      />
    </div>
  );
}
