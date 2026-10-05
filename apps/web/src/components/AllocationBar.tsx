import { cn } from "@/lib/cn";
import { formatPercentBps } from "@/lib/format";

export interface Segment {
  label: string;
  bps: number;
  colorClass: string;
}

/** Segmented bar. Widths are the bps themselves; if they don't sum to 10000 the gap is shown, not hidden. */
export function AllocationBar({ segments, className }: { segments: Segment[]; className?: string }) {
  const summary = segments.map((s) => `${s.label} ${formatPercentBps(s.bps, { digits: 2 })}`).join(", ");
  return (
    <div
      role="img"
      aria-label={summary}
      className={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-line", className)}
    >
      {segments.map((s) => (
        <div key={s.label} className={cn("h-full transition-[width] duration-300", s.colorClass)} style={{ width: `${Math.max(0, s.bps) / 100}%` }} />
      ))}
    </div>
  );
}
