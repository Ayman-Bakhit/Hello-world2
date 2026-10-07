import { CANONICAL_FEE_SPLIT, FEE_BUCKETS, LAUNCH_COPY, allocationName, launchAllocations } from "@project-name/shared";
import { BUCKET_COLOR, BUCKET_LABEL } from "@/lib/feeDrafts";
import { AllocationBar } from "./AllocationBar";
import { Badge } from "./Badge";

/**
 * The launch fee split is FIXED in this version: creator 60%, tax reserve 15%, charity 15%, protocol 10% (6000/1500/1500/1000 bps).
 * It is a validated launch CONFIGURATION that the server enforces; nothing is enforced on-chain, so it is never described as unchangeable.
 * There is nothing to edit here: a user cannot reallocate it, and the server rejects any other split anyway.
 */
export function FeeSplitEditor() {
  const rows = launchAllocations(CANONICAL_FEE_SPLIT);
  return (
    <div>
      <Badge tone="info" className="mb-3">FIXED FOR THIS VERSION · CONFIGURATION, NOT ON-CHAIN ENFORCEMENT</Badge>
      <AllocationBar segments={FEE_BUCKETS.map((b) => ({ label: BUCKET_LABEL[b], bps: CANONICAL_FEE_SPLIT[b], colorClass: BUCKET_COLOR[b] }))} className="mb-4" />
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.bucket} className="rounded-md border border-line p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="eyebrow">{r.label}</span>
              <span className="num text-lg font-semibold">{r.percent}</span>
            </div>
            <p className="mt-1 text-xs font-semibold text-muted">{allocationName(r.bucket)}</p>
            <p className="mt-0.5 text-xs text-faint">{r.note}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">{LAUNCH_COPY.feeSplitNote} The four shares total exactly 100% (10,000 basis points) and the server rejects any other split.</p>
    </div>
  );
}
