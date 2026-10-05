import type { Charity } from "@/lib/types";
import { formatUsd } from "@/lib/format";
import { Badge } from "./Badge";
import { Button } from "./Button";

export function CharityCard({
  charity,
  donatedCents,
  selected,
  onSelect,
}: {
  charity: Charity;
  donatedCents: bigint;
  selected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const verified = charity.verification === "verified";
  return (
    <div className={`rounded-lg border bg-surface p-4 ${selected ? "border-accent/60" : "border-line"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{charity.name}</h3>
          <p className="text-xs text-faint">{charity.category} · {charity.country}</p>
        </div>
        <Badge tone={verified ? "good" : "demo"}>{verified ? "VERIFIED (DEMO)" : "PENDING REVIEW"}</Badge>
      </div>
      <p className="mt-2 text-xs text-muted">{charity.description}</p>
      <p className="mt-2 text-[11px] text-faint">{charity.verificationNote}</p>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="eyebrow">You donated</p>
          <p className="num text-lg font-semibold">{formatUsd(donatedCents)}</p>
        </div>
        {onSelect ? (
          <Button variant={selected ? "primary" : "secondary"} disabled={!verified} onClick={() => onSelect(charity.id)}>
            {selected ? "SELECTED" : verified ? "SELECT" : "UNAVAILABLE"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
