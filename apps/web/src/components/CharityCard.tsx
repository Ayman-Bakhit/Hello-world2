import { GIVE_COPY, verificationLabel } from "@project-name/shared";
import type { Charity } from "@/lib/types";
import { formatDate, formatUsd } from "@/lib/format";
import { Badge } from "./Badge";
import { Button } from "./Button";

/** Label comes only from the API's state and source. A fixture verification is labeled as such and is never styled as real. */
export function verificationBadge(c: Pick<Charity, "verification" | "verificationSource" | "dataSource">): { label: string; tone: "good" | "demo" | "bad" | "neutral" } {
  const label = verificationLabel(c.verification, c.verificationSource);
  if (c.verification === "VERIFIED") return { label, tone: c.verificationSource === "FIXTURE" || c.dataSource === "demo" ? "demo" : "good" };
  if (c.verification === "PENDING_REVIEW") return { label, tone: "demo" };
  if (c.verification === "SUSPENDED") return { label, tone: "bad" };
  return { label, tone: "neutral" };
}

/** Registry facts the card and the detail panel both show. All values are rendered as text. */
export function VerificationFacts({ charity }: { charity: Charity }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
      <div><dt className="eyebrow">{GIVE_COPY.verificationStatus}</dt><dd className="mt-0.5">{verificationBadge(charity).label}</dd></div>
      <div><dt className="eyebrow">{GIVE_COPY.verificationSource}</dt><dd className="mt-0.5">{charity.verificationSource ? charity.verificationSource.replaceAll("_", " ") : "None recorded"}</dd></div>
      <div><dt className="eyebrow">{GIVE_COPY.lastReviewed}</dt><dd className="num mt-0.5">{charity.lastReviewedAt ? formatDate(charity.lastReviewedAt) : "Never"}</dd></div>
      <div><dt className="eyebrow">{GIVE_COPY.evidence}</dt><dd className="num mt-0.5">{charity.evidenceCount} {charity.evidenceCount === 1 ? "item" : "items"}</dd></div>
    </dl>
  );
}

/** CHARITY INFORMATION only. It is not a donation, and nothing on this card moves funds. */
export function CharityCard({ charity, confirmedCents, demoCents, selected = false, onSelect }: { charity: Charity; confirmedCents: bigint; demoCents: bigint; selected?: boolean; onSelect?: (id: string) => void }) {
  const badge = verificationBadge(charity);
  return (
    <div className={`rounded-lg border bg-surface p-4 ${selected ? "border-accent" : "border-line"}`} aria-current={selected ? "true" : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold">{charity.name}</h3>
          <p className="text-xs text-faint">{charity.category}{charity.country ? ` · ${charity.country}` : ""}</p>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <p className="mt-2 break-words text-xs text-muted">{charity.description}</p>
      <p className="mt-2 text-[11px] text-faint">{charity.verificationNote}</p>
      <VerificationFacts charity={charity} />
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div><dt className="eyebrow">Confirmed on-chain</dt><dd className="num text-lg font-semibold">{formatUsd(confirmedCents)}</dd></div>
        <div><dt className="eyebrow">Demo records</dt><dd className="num text-lg font-semibold text-muted">{formatUsd(demoCents)}</dd></div>
      </dl>
      {onSelect ? <div className="mt-3"><Button onClick={() => onSelect(charity.id)} aria-label={`View evidence for ${charity.name}`}>VIEW EVIDENCE</Button></div> : null}
    </div>
  );
}
