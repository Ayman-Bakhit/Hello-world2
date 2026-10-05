import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type Tone = "neutral" | "demo" | "good" | "bad" | "info";

const TONES: Record<Tone, string> = {
  neutral: "border-line-strong text-muted",
  demo: "border-warn/40 bg-warn/10 text-warn",
  good: "border-gain/40 bg-gain/10 text-gain",
  bad: "border-loss/40 bg-loss/10 text-loss",
  info: "border-b-creator/40 bg-b-creator/10 text-b-creator",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wider",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
