import { cn } from "@/lib/cn";
import { Badge } from "./Badge";

export const DEFAULT_DEMO_MESSAGE =
  "Anything labeled DEMO DATA is fictional and was not read from a chain. A signed-in wallet shows LIVE DATA only after you sync it (a read-only Solana lookup) and stays empty until then.";

/** Reusable demo-data labeling. `chip` is for individual panels; `bar` for page-level notice. */
export function DemoDataBanner({
  variant = "bar",
  message = DEFAULT_DEMO_MESSAGE,
  className,
}: {
  variant?: "bar" | "chip";
  message?: string;
  className?: string;
}) {
  if (variant === "chip") return <Badge tone="demo" className={className}>DEMO DATA</Badge>;
  return (
    <div
      role="note"
      className={cn("flex items-start gap-3 border-b border-warn/25 bg-warn/[0.07] px-4 py-2 text-xs text-warn", className)}
    >
      <span className="mt-px shrink-0 font-bold tracking-wider">DEMO DATA</span>
      <span className="text-warn/90">{message}</span>
    </div>
  );
}
