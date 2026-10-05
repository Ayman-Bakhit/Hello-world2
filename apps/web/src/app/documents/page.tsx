import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage() {
  return (
    <div>
      <PageHeader eyebrow="Documents" title="Documents" subtitle="Exports and reports built from your own transaction records." />
      <EmptyState
        title="Reports are not built yet"
        description="Exports will be generated from immutable raw transactions so every figure traces back to a signature."
        items={["CSV transaction export", "PDF tax planning summary", "Donation report with receipts", "Creator income report", "Reserve report", "Token fee report"]}
      />
    </div>
  );
}
