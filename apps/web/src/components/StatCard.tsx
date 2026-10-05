import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  sub,
  tone,
  dotClass,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "gain" | "loss" | "neutral";
  dotClass?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface p-4", className)}>
      <div className="flex items-center gap-2">
        {dotClass ? <span aria-hidden className={cn("h-2 w-2 rounded-full", dotClass)} /> : null}
        <p className="eyebrow">{label}</p>
      </div>
      <p
        className={cn(
          "num mt-2 text-xl font-semibold tracking-tight sm:text-2xl",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

/** Gain/loss coloring helper for bigint cents and bps numbers. */
export const toneOf = (n: bigint | number): "gain" | "loss" | "neutral" =>
  n > 0 ? "gain" : n < 0 ? "loss" : "neutral";
