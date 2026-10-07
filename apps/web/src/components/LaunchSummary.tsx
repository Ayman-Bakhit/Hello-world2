import Link from "next/link";
import { FEE_BUCKETS, LAUNCH_COPY, allocationName, launchAllocations, safeHttpUrl, verificationLabel, type Launch, type LaunchHistory, type PublicLaunch } from "@project-name/shared";
import { BUCKET_COLOR, BUCKET_LABEL } from "@/lib/feeDrafts";
import { formatDate, formatDateTime, formatUsd, shortAddress } from "@/lib/format";
import { AllocationBar } from "./AllocationBar";
import { Badge } from "./Badge";
import { DataSourceBadge } from "./DataSource";

type Tone = "neutral" | "good" | "bad" | "info" | "demo";
/** Status vocabulary. READY is "ready for deployment", never a success or live state. */
export function launchStatusBadge(status: Launch["status"]): { label: string; tone: Tone } {
  switch (status) {
    case "DRAFT": return { label: "DRAFT", tone: "neutral" };
    case "CONFIGURED": return { label: "CONFIGURED", tone: "info" };
    case "REVIEW": return { label: "IN REVIEW", tone: "demo" };
    case "READY": return { label: LAUNCH_COPY.readyTitle, tone: "info" };
    case "CANCELLED": return { label: "CANCELLED", tone: "neutral" };
  }
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function ReadyBanner() {
  return (
    <section aria-label="Readiness" className="rounded-md border border-accent/40 bg-accent/[0.06] p-3">
      <p className="text-sm font-semibold">{LAUNCH_COPY.readyTitle}</p>
      <p className="mt-1 text-xs text-muted">Configuration validated. {LAUNCH_COPY.readyMeaning}</p>
      <p className="mt-1 text-xs font-semibold text-warn">{LAUNCH_COPY.deploymentDisabled}</p>
    </section>
  );
}

export function Fingerprint({ value }: { value: string }) {
  return (
    <div>
      <p className="eyebrow">Configuration fingerprint</p>
      <code className="num mt-0.5 block break-all text-[11px]">{value}</code>
      <p className="mt-0.5 text-[11px] text-faint">{LAUNCH_COPY.fingerprintNote}</p>
    </div>
  );
}

/** Links are validated again at render and opened with rel=noopener noreferrer nofollow. Metadata is text, never HTML. */
export function SafeLink({ href }: { href: string | null }) {
  if (!href) return <span className="text-faint">None</span>;
  const u = safeHttpUrl(href);
  return u ? <a className="break-all text-accent underline underline-offset-2" href={u} target="_blank" rel="noopener noreferrer nofollow">{u}</a> : <span className="text-faint">Not shown (unsafe URL)</span>;
}

function Allocations({ split }: { split: Launch["config"]["feeSplit"] }) {
  const rows = launchAllocations(split);
  return (
    <div>
      <p className="eyebrow mb-2">Configured allocations</p>
      <AllocationBar segments={FEE_BUCKETS.map((b) => ({ label: BUCKET_LABEL[b], bps: split[b], colorClass: BUCKET_COLOR[b] }))} />
      <ul className="mt-2 space-y-1.5 text-xs">
        {rows.map((r) => (
          <li key={r.bucket}>
            <div className="flex justify-between"><span className="font-semibold">{allocationName(r.bucket)}</span><span className="num">{r.percent}</span></div>
            <p className="text-faint">{r.note}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-faint">{LAUNCH_COPY.feeSplitNote}</p>
    </div>
  );
}

function CharityBlock({ charity }: { charity: PublicLaunch["charity"] }) {
  if (!charity) return <p className="text-xs text-muted">Charity: the registry has no record of the selected charity.</p>;
  return (
    <div className="rounded-md border border-line p-3 text-xs">
      <p className="eyebrow mb-1">Selected charity</p>
      <p className="break-words font-semibold">{charity.name}</p>
      <dl className="mt-2 grid grid-cols-3 gap-2">
        <div><dt className="text-faint">Verification status</dt><dd className="mt-0.5">{verificationLabel(charity.verificationState, charity.verificationSource)}</dd></div>
        <div><dt className="text-faint">Verification source</dt><dd className="mt-0.5">{charity.verificationSource ? charity.verificationSource.replaceAll("_", " ") : "None recorded"}</dd></div>
        <div><dt className="text-faint">Last reviewed</dt><dd className="num mt-0.5">{charity.lastReviewedAt ? formatDate(charity.lastReviewedAt) : "Never"}</dd></div>
      </dl>
      {charity.dataSource === "demo" ? <p className="mt-2 text-warn">DEMO DATA. This registry record is a fixture, not a real-world verification.</p> : null}
      <p className="mt-2 text-faint">{LAUNCH_COPY.charityNote}</p>
    </div>
  );
}

/** Pure view of a saved launch configuration, its server review and its lifecycle state. States plainly that nothing is deployed. */
export function LaunchSummary({ launch }: { launch: Launch }) {
  const st = launchStatusBadge(launch.status);
  const c = launch.config;
  const r = launch.review;
  return (
    <div className="space-y-4 rounded-md border border-line bg-surface-2/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-words font-semibold">{c.name}</span>
        <span className="num font-mono text-xs text-muted">{c.symbol}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
        <Badge tone="neutral">{LAUNCH_COPY.notDeployed}</Badge>
        <Badge tone="neutral">{LAUNCH_COPY.notVerified}</Badge>
        <DataSourceBadge dataSource={launch.dataSource} />
      </div>
      {launch.status === "READY" ? <ReadyBanner /> : null}
      <p className="text-xs text-muted">{launch.statusMeaning}</p>
      <p className="text-xs text-faint">Configuration id {launch.id} · revision {launch.revision}. A saved configuration is a record only: no token, mint, liquidity, contract or fee routing exists.</p>

      <dl className="grid gap-3 text-xs sm:grid-cols-3">
        <div><dt className="eyebrow">Network</dt><dd className="mt-0.5">{c.network} (configuration only)</dd></div>
        <div><dt className="eyebrow">Total supply</dt><dd className="num mt-0.5">{group(c.totalSupply)}</dd></div>
        <div><dt className="eyebrow">Decimals</dt><dd className="num mt-0.5">{c.decimals}</dd></div>
        <div className="sm:col-span-3"><dt className="eyebrow">Description</dt><dd className="mt-0.5 break-words">{c.description || "None"}</dd></div>
        <div className="sm:col-span-3">
          <dt className="eyebrow">Metadata <Badge tone="neutral" className="ml-1">USER-PROVIDED</Badge></dt>
          <dd className="mt-1 space-y-0.5">
            <p>Image: <SafeLink href={c.imageUri} /></p>
            <p>Website: <SafeLink href={c.website} /></p>
            {(["twitter", "telegram", "discord", "github"] as const).filter((k) => c.socials[k]).map((k) => <p key={k}>{k}: <SafeLink href={c.socials[k]} /></p>)}
            <p className="text-faint">{LAUNCH_COPY.metadataNote}</p>
          </dd>
        </div>
      </dl>

      <Allocations split={c.feeSplit} />
      <CharityBlock charity={r?.charity ?? null} />
      {!r ? <p className="text-xs text-faint">The charity&apos;s registry state is recorded when the configuration is validated.</p> : null}
      <div className="rounded-md border border-line p-3 text-xs">
        <p className="eyebrow mb-1">Tax reserve allocation (launch fee)</p>
        <p>Destination you control: <span className="num font-mono">{shortAddress(c.taxReserveConfiguration.destinationAddress)}</span></p>
        <p className="mt-1 text-faint">{LAUNCH_COPY.reserveNote}</p>
      </div>
      <Fingerprint value={launch.fingerprint} />

      {r ? (
        <div className="space-y-2">
          <p className={`text-xs font-semibold ${r.passed ? "text-gain" : "text-loss"}`}>{r.passed ? "Server validation passed this configuration." : "Server validation found problems."}</p>
          {r.errors.length > 0 ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-loss">{r.errors.map((e) => <li key={`${e.field}-${e.message}`}>{e.message}</li>)}</ul> : null}
          {r.warnings.length > 0 ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-warn">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
          <p className="text-xs text-muted">
            {r.feeSplitLabel} (enforcement: {r.feeSplitEnforcement.replace("_", " ")}). Illustration for a $1,000.00 fee:{" "}
            {Object.entries(r.moneyFlowExampleCents).map(([k, v]) => `${k} ${formatUsd(BigInt(v), { cents: true })}`).join(" · ")}. Nothing is paid.
          </p>
          <p className="text-xs text-faint">Deployable: no. {LAUNCH_COPY.deploymentDisabled}</p>
        </div>
      ) : (
        <p className="text-xs text-muted">Not validated yet.</p>
      )}
    </div>
  );
}

export function HistoryList({ history }: { history: LaunchHistory }) {
  return (
    <div className="text-xs">
      <p className="eyebrow mb-1">Configuration history</p>
      <ol className="space-y-1">
        {history.revisions.map((h) => (
          <li key={h.seq} className="flex flex-wrap items-center gap-2 border-b border-line/60 pb-1">
            <span className="num text-faint">#{h.seq}</span>
            <Badge tone="neutral">{h.action.toUpperCase()}</Badge>
            <span>{launchStatusBadge(h.statusAfter).label}</span>
            <span className="num font-mono text-faint">{h.fingerprint.slice(0, 12)}…</span>
            <span className="num text-faint">{formatDateTime(h.createdAt)}</span>
            {h.reason ? <span className="break-words text-muted">{h.reason}</span> : null}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-faint">{history.historyIntact ? "Hash chain verified." : "The hash chain does not verify: a row was changed outside the API."} {history.note}</p>
    </div>
  );
}

/** Read-only public view of a published READY configuration. */
export function PublicLaunchView({ launch }: { launch: PublicLaunch }) {
  const st = launchStatusBadge(launch.status);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="break-words text-lg font-semibold">{launch.name}</h2>
        <span className="num font-mono text-xs text-muted">{launch.symbol}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
        {launch.labels.map((l) => <Badge key={l} tone={l === "DEMO DATA" ? "demo" : "neutral"}>{l}</Badge>)}
      </div>
      <p className="text-xs text-muted">{launch.statusMeaning}</p>
      <dl className="grid gap-3 text-xs sm:grid-cols-4">
        <div><dt className="eyebrow">Network</dt><dd className="mt-0.5">{launch.network} (configuration only)</dd></div>
        <div><dt className="eyebrow">Creator</dt><dd className="num mt-0.5 font-mono">{launch.creator}</dd></div>
        <div><dt className="eyebrow">Total supply</dt><dd className="num mt-0.5">{group(launch.totalSupply)}</dd></div>
        <div><dt className="eyebrow">Decimals</dt><dd className="num mt-0.5">{launch.decimals}</dd></div>
        <div className="sm:col-span-4"><dt className="eyebrow">Description</dt><dd className="mt-0.5 break-words">{launch.description || "None"}</dd></div>
        <div className="sm:col-span-4">
          <dt className="eyebrow">Metadata <Badge tone="neutral" className="ml-1">USER-PROVIDED</Badge></dt>
          <dd className="mt-1 space-y-0.5"><p>Image: <SafeLink href={launch.metadata.imageUri} /></p><p>Website: <SafeLink href={launch.metadata.website} /></p><p className="text-faint">{LAUNCH_COPY.metadataNote}</p></dd>
        </div>
      </dl>
      <Allocations split={launch.feeSplit} />
      <CharityBlock charity={launch.charity} />
      <Fingerprint value={launch.fingerprint} />
      <p className="text-xs font-semibold text-warn">{LAUNCH_COPY.deploymentDisabled} No token, mint, liquidity or fee routing exists for this configuration.</p>
      <p className="text-xs"><Link className="text-accent underline underline-offset-2" href={`/launches/proof?id=${encodeURIComponent(launch.id)}`}>VIEW TOKEN PROOF</Link></p>
    </div>
  );
}
