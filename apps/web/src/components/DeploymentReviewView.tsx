import type { DeploymentPlanResponse } from "@project-name/shared";
import { Badge } from "./Badge";
import { DataSourceBadge } from "./DataSource";
import { SafeLink } from "./LaunchSummary";

/**
 * DEPLOYMENT PLAN (pure view). Renders the server-built plan and the review generated from that same plan. It decides nothing, builds
 * nothing and has no control that signs, sends or deploys: the only button is permanently disabled. Everything is text (escaped); no
 * remote content is loaded.
 */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (bps: number) => `${bps / 100}%`;
const dash = (v: string | null, what = "NOT AVAILABLE") => v ?? <span className="text-faint">{what}</span>;

function Section({ id, title, children, note }: { id: string; title: string; children: React.ReactNode; note?: string }) {
  return (
    <section aria-labelledby={`dp-${id}`} className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-3"><h2 id={`dp-${id}`} className="eyebrow !text-muted">{title}</h2></div>
      <div className="p-4 text-sm">{children}{note ? <p className="mt-3 text-xs text-faint">{note}</p> : null}</div>
    </section>
  );
}
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
    <dt className="eyebrow shrink-0">{label}</dt><dd className="num min-w-0 break-all text-right sm:max-w-[70%]">{children}</dd>
  </div>
);

export function DeploymentReviewView({ data }: { data: DeploymentPlanResponse }) {
  const { plan: p, review: r } = data;
  const fixture = p.dataSource === "demo";
  const blocked = p.status === "BLOCKED";
  return (
    <div className="space-y-5">
      {fixture ? <div role="note" className="rounded-md border border-warn/30 bg-warn/[0.07] px-3 py-2 text-xs text-warn"><span className="mr-2 font-bold tracking-wider">DEMO · FIXTURE</span>A fictional plan built from fixture data. Nothing was ever signed or sent.</div> : null}

      <header className="rounded-lg border border-line-strong bg-surface p-4" aria-label="Plan status">
        <p className="eyebrow">DEPLOYMENT PLAN</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={blocked ? "demo" : "info"} className="!px-2 !py-1 !text-xs">{blocked ? "PLAN BLOCKED" : "READY FOR USER REVIEW"}</Badge>
          {p.labels.map((l) => <Badge key={l} tone="neutral" className="!px-2 !py-1 !text-xs">{l}</Badge>)}
          <DataSourceBadge dataSource={p.dataSource} />
        </div>
        <p className="mt-3 text-sm">{r.headline}</p>
        <p className="mt-2 text-xs text-faint">Plan <code className="num">{p.identity.planHash.slice(0, 16)}…</code> · version {p.identity.planVersion} · {p.identity.builderVersion} · {data.recorded ? "recorded" : "not recorded"}{data.supersededPlans > 0 ? ` · ${data.supersededPlans} earlier plan${data.supersededPlans === 1 ? "" : "s"} no longer current` : ""}</p>
        <div className="mt-3"><button type="button" disabled aria-disabled="true" className="cursor-not-allowed rounded border border-line px-3 py-2 text-xs font-semibold tracking-wider text-faint">EXECUTION NOT ENABLED IN THIS BETA</button></div>
      </header>

      {p.blockers.length > 0 ? (
        <Section id="blockers" title="DECISIONS REQUIRED BEFORE THIS CAN BE EXECUTED">
          <ul className="space-y-3">
            {p.blockers.map((b) => (
              <li key={b.code} className="rounded-md border border-warn/30 bg-warn/[0.05] p-3 text-xs" data-blocker={b.code}>
                <p className="font-semibold text-warn">{b.code}</p><p className="mt-1">{b.message}</p><p className="mt-1 text-muted">Decision needed: {b.decision}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section id="token" title="1 · TOKEN">
          <dl className="divide-y divide-line">
            <Row label="Name / symbol">{p.token.name} / {p.token.symbol}<Badge tone="neutral" className="ml-2">USER-PROVIDED</Badge></Row>
            <Row label="Network">{p.identity.network}</Row>
            <Row label="Token program">{p.identity.tokenProgram.name} <code className="text-[11px]">{p.identity.tokenProgram.programId}</code> (Token-2022: not implemented)</Row>
            <Row label="Decimals">{p.token.decimals}</Row>
            <Row label="Intended supply">{group(p.token.totalSupply)} ({group(p.token.intendedSupplyRaw)} base units). Not all of it exists on-chain.</Row>
            <Row label="Minted supply">{p.token.mintedSupplyRaw === null ? "not defined" : `${group(p.token.mintedSupplyRaw)} base units (creator + liquidity)`}</Row>
            <Row label="Permanently unissued">{p.token.unissuedSupplyRaw === null ? "not defined" : `${group(p.token.unissuedSupplyRaw)} base units. Never minted, not burned.`}</Row>
            <Row label="Mint address">{dash(p.mint.address, "NOT KNOWN YET")}</Row>
          </dl>
          <p className="mt-3 text-xs text-faint">{p.mint.note}</p>
        </Section>

        <Section id="authorities" title="2 · AUTHORITIES">
          <dl className="divide-y divide-line">
            <Row label="Mint authority (policy)">{p.authorities.mint.policy}</Row>
            <Row label="Mint authority, at start">{dash(p.authorities.mint.initial, "none")}</Row>
            <Row label="Mint authority, expected end">{p.authorities.mint.final ?? "none (only after the revoke instruction runs)"}</Row>
            <Row label="Freeze authority (policy)">{p.authorities.freeze.policy}</Row>
            <Row label="Freeze authority, expected end">{p.authorities.freeze.final ?? "none"}</Row>
          </dl>
          <p className="mt-3 text-xs text-faint">{p.authorities.mint.note} {p.authorities.freeze.note}</p>
        </Section>
      </div>

      <Section id="metadata" title="3 · METADATA">
        <dl className="divide-y divide-line">
          <Row label="Program">{p.metadata.program}</Row>
          <Row label="Name / symbol">{p.metadata.name} / {p.metadata.symbol}</Row>
          <Row label="Metadata URI">{dash(p.metadata.uri, "NOT DECIDED")}</Row>
          <Row label="Update authority">{p.metadata.updateAuthority}{p.metadata.isMutable ? " (can change it later)" : " (created not mutable)"}</Row>
          <Row label="Image"><SafeLink href={p.metadata.imageUri} /></Row>
          <Row label="Website"><SafeLink href={p.metadata.website} /></Row>
          <Row label="Provenance"><Badge tone="neutral">{p.metadata.provenance.replace("_", "-")}</Badge> <Badge tone="neutral">NOT VERIFIED</Badge></Row>
        </dl>
        <p className="mt-3 text-xs text-faint">Nothing is fetched and no image is loaded. Metadata is user-provided and is not verified.</p>
      </Section>

      <Section id="allocations" title="4 · ALLOCATIONS" note="Token supply allocation and the fee split are different things. The fee split below is a configuration of how fees would be shared; it is not a token allocation.">
        <p className="eyebrow mb-1">Token supply</p>
        <ul className="divide-y divide-line">
          {p.supplyAllocations.map((a) => (
            <li key={a.role} className="flex flex-wrap items-center justify-between gap-2 py-2" data-allocation={a.role} data-status={a.status}>
              <span>{a.role}{a.bps === null ? "" : ` · ${pct(a.bps)}`}</span>
              <span className="num">{a.amountRaw === null ? "UNDEFINED" : group(a.amountRaw)} <Badge tone={a.status === "DEFINED" ? "info" : "demo"}>{a.status}</Badge></span>
            </li>
          ))}
        </ul>
        <p className="eyebrow mb-1 mt-4">Fee split (configured, not enforced on-chain)</p>
        <ul className="divide-y divide-line">
          {p.feeAllocations.buckets.map((b) => <li key={b.bucket} className="flex justify-between py-2"><span>{b.destinationRole}</span><span className="num">{pct(b.bps)}</span></li>)}
        </ul>
      </Section>

      <Section id="destinations" title="5 · DESTINATIONS">
        <ul className="divide-y divide-line">
          {p.destinations.map((d) => (
            <li key={d.role} className="py-2" data-destination={d.role} data-validation={d.validation}>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{d.role}</span><span className="flex gap-1.5"><Badge tone="neutral">{d.provenance.replaceAll("_", " ")}</Badge><Badge tone={d.validation === "VALID_ADDRESS" ? "good" : "demo"}>{d.validation.replaceAll("_", " ")}</Badge></span></div>
              <p className="num mt-1 break-all text-xs">{d.address ?? <span className="text-faint">no address</span>}</p>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section id="liquidity" title="6 · FUTURE LIQUIDITY">
          <Badge tone="demo">{p.liquidity.status}</Badge>
          <dl className="mt-2 divide-y divide-line">
            <Row label="Configured">{group(p.liquidity.initialLiquidityUsdc)} USDC · {pct(p.liquidity.supplyBps)} of supply · lock {p.liquidity.lockDays} days</Row>
            <Row label="Venue">{dash(null, "NOT DECIDED")}</Row>
            <Row label="Pool address">{dash(null, "NONE (not created)")}</Row>
          </dl>
          <p className="mt-3 text-xs text-faint">{p.liquidity.note}</p>
        </Section>
        <Section id="routing" title="7 · FUTURE FEE ROUTING">
          <Badge tone="demo">{p.feeRouting.status.replace("_", " ")}</Badge>
          <p className="mt-2 text-xs">{p.feeRouting.note}</p>
          <p className="mt-2 text-xs text-faint">On-chain enforcement: none. Program: none assumed.</p>
        </Section>
      </div>

      <Section id="expected" title="8 · EXPECTED POST-DEPLOYMENT STATE" note="This is what a later observation would be compared with. It is expected, not observed, and proves nothing by itself.">
        <dl className="divide-y divide-line">
          <Row label="Provenance"><Badge tone="demo">EXPECTED · NOT OBSERVED</Badge></Row>
          <Row label="Network / program">{p.expectedState.network} / SPL_TOKEN</Row>
          <Row label="Decimals / expected minted supply">{p.expectedState.decimals} / {p.expectedState.mintedSupplyRaw === null ? "not defined" : `${group(p.expectedState.mintedSupplyRaw)} base units`}</Row>
          <Row label="Intended / unissued">{group(p.expectedState.intendedSupplyRaw)} / {p.expectedState.unissuedSupplyRaw === null ? "not defined" : group(p.expectedState.unissuedSupplyRaw)} base units (unissued is never minted)</Row>
          <Row label="Mint authority">{p.expectedState.mintAuthority ?? "none"}</Row>
          <Row label="Freeze authority">{p.expectedState.freezeAuthority ?? "none"}</Row>
          <Row label="Fee routing">{p.expectedState.feeRouting.status.replace("_", " ")} (configured {pct(p.expectedState.feeRouting.configuredBps.creator)} / {pct(p.expectedState.feeRouting.configuredBps.taxReserve)} / {pct(p.expectedState.feeRouting.configuredBps.charity)} / {pct(p.expectedState.feeRouting.configuredBps.protocol)})</Row>
          <Row label="Configuration fingerprint"><code className="text-[11px]">{p.expectedState.configFingerprint}</code></Row>
          <Row label="Plan hash"><code className="text-[11px]">{p.expectedState.planHash}</code></Row>
        </dl>
      </Section>

      <Section id="sign" title="9 · WHAT THE WALLET WILL NEED TO SIGN" note="Nothing is signed now. Transactions are not serialized: that needs the mint public key and a recent blockhash, which exist only at signing time.">
        <ul className="space-y-3">
          {p.transactions.map((t) => (
            <li key={t.id} className="rounded-md border border-line p-3 text-xs" data-transaction={t.id}>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{t.index + 1}. {t.label}</span><Badge tone={t.status === "BLOCKED" ? "demo" : "info"}>{t.status}</Badge></div>
              <p className="mt-1 text-muted">Signers: {t.requiredSigners.join(", ")}{t.dependsOnTransactions.length ? ` · after transaction ${t.dependsOnTransactions.map((x) => x + 1).join(", ")}` : ""}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                {t.instructionIds.map((iid) => { const i = p.instructions.find((x) => x.id === iid)!; return <li key={iid} data-instruction={iid} data-status={i.status}><span className="font-medium">{i.kind}</span> ({i.program}): {i.description}</li>; })}
              </ol>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-faint">Rent, network fees and compute are not estimated here (they need a live cluster).</p>
      </Section>

      <Section id="who" title="WHO RECEIVES WHAT">
        <ul className="divide-y divide-line text-xs">
          {r.whoReceivesWhat.map((w, i) => <li key={`${w.role}-${i}`} className="flex flex-wrap justify-between gap-2 py-2"><span>{w.role}</span><span className="num break-all text-right">{w.what}</span></li>)}
        </ul>
      </Section>

      <Section id="not" title="WHAT DOES NOT HAPPEN">
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-muted">{r.whatDoesNotHappen.map((l) => <li key={l}>{l}</li>)}</ul>
      </Section>
    </div>
  );
}
