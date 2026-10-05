import { reserveStatus } from "@project-name/shared";
import { formatPercentBps, formatUsd } from "@/lib/format";
import { cn } from "@/lib/cn";
import { COPY } from "@project-name/shared";
import { Card } from "./Card";
import { DemoDataBanner } from "./DemoDataBanner";

export function TaxReserveCard({
  reserveCents,
  exposureCents,
  actions,
}: {
  reserveCents: bigint;
  exposureCents: bigint;
  actions?: React.ReactNode;
}) {
  const s = reserveStatus(reserveCents, exposureCents);
  const covered = s.coverageBps === null ? 10_000 : Math.min(10_000, s.coverageBps);
  return (
    <Card title="Tax reserve" right={<DemoDataBanner variant="chip" />}>
      <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Current reserve" value={formatUsd(s.reserveCents)} />
        <Metric label={COPY.taxExposure} value={formatUsd(s.exposureCents)} />
        <Metric label="Coverage" value={s.coverageBps === null ? "n/a" : formatPercentBps(s.coverageBps)} tone={covered >= 10_000 ? "gain" : "warn"} />
        <Metric label="Recommended additional reserve" value={formatUsd(s.recommendedAdditionalCents)} />
      </dl>
      <div
        className="mt-5 h-2 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label="Reserve coverage of estimated exposure"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(covered / 100)}
      >
        <div className={cn("h-full", covered >= 10_000 ? "bg-gain" : "bg-b-tax")} style={{ width: `${covered / 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-faint">
        Coverage compares your reserve to a planning estimate, not to an actual tax liability.
      </p>
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "gain" | "warn" }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className={cn("num mt-1.5 text-xl font-semibold", tone === "gain" && "text-gain", tone === "warn" && "text-b-tax")}>{value}</dd>
    </div>
  );
}
