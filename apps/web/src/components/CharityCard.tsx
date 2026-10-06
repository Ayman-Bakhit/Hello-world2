import type { Charity } from "@/lib/types";
import { formatUsd } from "@/lib/format";
import { Badge } from "./Badge";

/** Verification label comes only from the API's status (and says DEMO when the record is a demo record). */
export function verificationBadge(c: Pick<Charity, "verification" | "dataSource">): { label: string; tone: "good" | "demo" | "bad" } {
  if (c.verification === "verified") return { label: c.dataSource === "demo" ? "VERIFIED (DEMO DATA)" : "VERIFIED", tone: c.dataSource === "demo" ? "demo" : "good" };
  if (c.verification === "pending") return { label: "PENDING REVIEW", tone: "demo" };
  return { label: c.verification === "rejected" ? "REJECTED" : "REVOKED", tone: "bad" };
}

/** CHARITY INFORMATION only. It is not a donation, and nothing on this card moves funds. */
export function CharityCard({ charity, confirmedCents, demoCents }: { charity: Charity; confirmedCents: bigint; demoCents: bigint }) {
  const badge = verificationBadge(charity);
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{charity.name}</h3>
          <p className="text-xs text-faint">{charity.category}{charity.country ? ` · ${charity.country}` : ""}</p>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <p className="mt-2 text-xs text-muted">{charity.description}</p>
      <p className="mt-2 text-[11px] text-faint">{charity.verificationNote}</p>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div><dt className="eyebrow">Confirmed on-chain</dt><dd className="num text-lg font-semibold">{formatUsd(confirmedCents)}</dd></div>
        <div><dt className="eyebrow">Demo records</dt><dd className="num text-lg font-semibold text-muted">{formatUsd(demoCents)}</dd></div>
      </dl>
    </div>
  );
}
