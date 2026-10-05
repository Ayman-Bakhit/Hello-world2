"use client";

import { FEE_BUCKETS, TOTAL_BPS, percentToBps, type FeeBucket } from "@project-name/shared";
import { BUCKET_COLOR, BUCKET_LABEL, parseFeeDrafts, sampleDistribution, type FeeDrafts } from "@/lib/feeDrafts";
import { cn } from "@/lib/cn";
import { formatPercentBps, formatUsd } from "@/lib/format";
import { AllocationBar } from "./AllocationBar";
import { Badge } from "./Badge";
import { Button } from "./Button";

const HINT: Record<FeeBucket, string> = {
  creator: "Paid to the creator wallet",
  taxReserve: "Creator-controlled reserve destination (V1)",
  charity: "Verified charity wallet",
  protocol: "Protocol treasury (public)",
};

const safeBps = (s: string): number => {
  try { return percentToBps(s); } catch { return 0; }
};

export function FeeSplitEditor({ drafts, onChange }: { drafts: FeeDrafts; onChange: (b: FeeBucket, v: string) => void }) {
  const result = parseFeeDrafts(drafts);
  const valid = result.split !== null;
  const segments = FEE_BUCKETS.map((b) => ({ label: BUCKET_LABEL[b], bps: safeBps(drafts[b]), colorClass: BUCKET_COLOR[b] }));
  const sample = result.split ? sampleDistribution(result.split) : null;

  const assignRemainder = () => {
    if (result.totalBps === null) return;
    const others = FEE_BUCKETS.filter((b) => b !== "creator").reduce((s, b) => s + safeBps(drafts[b]), 0);
    const remainder = TOTAL_BPS - others;
    if (remainder >= 0) onChange("creator", `${Math.floor(remainder / 100)}${remainder % 100 ? "." + String(remainder % 100).padStart(2, "0") : ""}`);
  };

  return (
    <div>
      <Badge tone="demo" className="mb-3">DEMO CONFIGURATION — ON-CHAIN ENFORCEMENT NOT IMPLEMENTED</Badge>

      <div className="space-y-3">
        {FEE_BUCKETS.map((b) => {
          const bps = safeBps(drafts[b]);
          return (
            <div key={b} className="rounded-md border border-line bg-surface-2/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={`fee-${b}`} className="flex items-center gap-2 text-sm font-semibold">
                  <span aria-hidden className={cn("h-2.5 w-2.5 rounded-sm", BUCKET_COLOR[b])} />
                  {BUCKET_LABEL[b]}
                </label>
                <div className="flex items-center gap-2">
                  <span className="num hidden text-xs text-faint sm:inline">{bps} bps</span>
                  <div className="relative">
                    <input
                      id={`fee-${b}`}
                      inputMode="decimal"
                      value={drafts[b]}
                      onChange={(e) => onChange(b, e.target.value)}
                      aria-invalid={parseFeeDrafts(drafts).messages.some((m) => m.startsWith(BUCKET_LABEL[b]))}
                      className="num w-24 rounded border border-line-strong bg-canvas py-1.5 pl-2 pr-6 text-right text-sm"
                    />
                    <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-faint">%</span>
                  </div>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.min(100, Math.round(bps / 100))}
                onChange={(e) => onChange(b, e.target.value)}
                aria-label={`${BUCKET_LABEL[b]} percent slider`}
                className="mt-2 w-full"
              />
              <p className="text-[11px] text-faint">{HINT[b]}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-5">
        <p className="eyebrow mb-2">WHERE THE MONEY GOES</p>
        <AllocationBar segments={segments} />
        <ul className="mt-3 divide-y divide-line text-sm">
          {FEE_BUCKETS.map((b) => (
            <li key={b} className="flex justify-between py-1.5">
              <span className="text-muted">{BUCKET_LABEL[b]}</span>
              <span className="num">{formatPercentBps(safeBps(drafts[b]), { digits: 2 })}</span>
            </li>
          ))}
          <li className="flex justify-between py-2 font-semibold">
            <span>Total</span>
            <span className={cn("num", valid ? "text-gain" : "text-loss")}>
              {result.totalBps === null ? "—" : formatPercentBps(result.totalBps, { digits: 2 })}
            </span>
          </li>
        </ul>
      </div>

      <div aria-live="polite" className="mt-3">
        {valid ? (
          <p className="text-xs text-gain">Valid: exactly {TOTAL_BPS} basis points (100.00%).</p>
        ) : (
          <div role="alert" className="rounded-md border border-loss/40 bg-loss/10 p-3 text-xs text-loss">
            <p className="mb-1 font-semibold">Fee split is invalid. Review and deployment are blocked.</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {result.messages.map((m) => <li key={m}>{m}</li>)}
            </ul>
            {result.totalBps !== null && result.totalBps !== TOTAL_BPS ? (
              <Button className="mt-2" onClick={assignRemainder}>SET CREATOR TO REMAINDER</Button>
            ) : null}
          </div>
        )}
      </div>

      {sample ? (
        <p className="mt-3 text-xs text-muted">
          Example: a {formatUsd(100_000n, { cents: true })} fee splits into{" "}
          {FEE_BUCKETS.map((b) => `${BUCKET_LABEL[b]} ${formatUsd(sample[b], { cents: true })}`).join(" · ")}. Rounding dust,
          if any, goes to Protocol.
        </p>
      ) : null}
    </div>
  );
}
