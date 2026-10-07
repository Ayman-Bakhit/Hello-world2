import { CHECK_IDS, PROOF_COPY, type LaunchProof } from "@project-name/shared";
import { Badge } from "./Badge";
import { DataSourceBadge } from "./DataSource";
import { SafeLink } from "./LaunchSummary";

/**
 * TOKEN PROOF (pure view). It renders what the SERVER derived: the status, every check state and both verification flags come from
 * the API. This component never computes verification, never upgrades a state, and prints "VERIFIED TRANSPARENCY" only when the
 * server says `verifiedTransparency`. Everything is rendered as text (React escapes it); nothing is fetched, no image is loaded.
 */
type Tone = "neutral" | "good" | "bad" | "info" | "demo";
const STATUS_TONE: Record<LaunchProof["status"], Tone> = { NOT_DEPLOYED: "neutral", AWAITING_OBSERVATION: "info", PARTIAL: "demo", VERIFIED: "good", FAILED: "bad", UNAVAILABLE: "neutral" };
const CHECK_TONE: Record<LaunchProof["checks"][number]["state"], Tone> = { PASS: "good", FAIL: "bad", UNKNOWN: "neutral", UNAVAILABLE: "neutral", NOT_APPLICABLE: "neutral" };
const PROV_LABEL: Record<string, string> = {
  CONFIGURED: "CONFIGURED", USER_PROVIDED: "USER-PROVIDED", DEPLOYMENT_RECORD: "DEPLOYMENT RECORD", FIXTURE: "FIXTURE", OBSERVED_ON_CHAIN: "OBSERVED ON-CHAIN", VERIFIED_MATCH: "VERIFIED MATCH", UNAVAILABLE: "UNAVAILABLE",
};
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (bps: number) => `${bps / 100}%`;

function Section({ id, title, children, note }: { id: string; title: string; children: React.ReactNode; note?: string }) {
  return (
    <section aria-labelledby={`proof-${id}`} className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 id={`proof-${id}`} className="eyebrow !text-muted">{title}</h2>
      </div>
      <div className="p-4 text-sm">{children}{note ? <p className="mt-3 text-xs text-faint">{note}</p> : null}</div>
    </section>
  );
}
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
    <dt className="eyebrow shrink-0">{label}</dt><dd className="num min-w-0 break-all text-right sm:max-w-[70%]">{children}</dd>
  </div>
);
const Prov = ({ p }: { p: string }) => <Badge tone={p === "VERIFIED_MATCH" || p === "OBSERVED_ON_CHAIN" ? "good" : p === "FIXTURE" ? "demo" : "neutral"} className="ml-2">{PROV_LABEL[p] ?? p}</Badge>;

/** An observed field: its value, or an explicit UNAVAILABLE with the reason. Never a zero or false placeholder. */
function Obs<T>({ f, show }: { f: { status: "OBSERVED"; value: T } | { status: "UNAVAILABLE"; reason: string }; show: (v: T) => string }) {
  return f.status === "OBSERVED" ? <>{show(f.value)}</> : <span className="text-faint">UNAVAILABLE ({f.reason})</span>;
}
const authority = (v: string | null) => (v === null ? "none (disabled)" : v);

export function LaunchProofView({ proof, audience = proof.audience }: { proof: LaunchProof; audience?: "owner" | "public" }) {
  const p = proof;
  const fixture = p.evidence.class === "FIXTURE" || p.dataSource === "demo";
  const o = p.observed;
  const c = p.configured;
  const unresolved = p.checks.filter((x) => x.state === "UNKNOWN" || x.state === "UNAVAILABLE");
  const checkOrder = (id: string) => CHECK_IDS.indexOf(id as (typeof CHECK_IDS)[number]);
  return (
    <div className="space-y-5">
      {fixture ? (
        <div role="note" className="rounded-md border border-warn/30 bg-warn/[0.07] px-3 py-2 text-xs text-warn">
          <span className="mr-2 font-bold tracking-wider">DEMO · FIXTURE · NOT VERIFIED ON-CHAIN</span>{PROOF_COPY.fixtureNote}
        </div>
      ) : null}

      <header className="rounded-lg border border-line-strong bg-surface p-4" aria-label="Proof status">
        <p className="eyebrow">TOKEN PROOF</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[p.status]} className="!text-xs !px-2 !py-1">{p.statusLabel}</Badge>
          <DataSourceBadge dataSource={p.dataSource} />
          {fixture ? <Badge tone="demo">FIXTURE</Badge> : null}
          <Badge tone="neutral">{p.audience === "public" ? "PUBLIC VIEW" : "OWNER VIEW"}</Badge>
        </div>
        <p className="mt-3 text-sm">{p.explanation}</p>
        <p className="mt-2 text-xs text-faint">
          {p.checks.length === 0 ? "No checks were evaluated." : `${p.summary.pass} passed · ${p.summary.fail} failed · ${p.summary.unknown + p.summary.unavailable} unknown or unavailable · ${p.summary.notApplicable} not applicable.`}
        </p>
      </header>

      {audience === "public" ? (
        <Section id="plain" title="IN PLAIN WORDS">
          <dl className="space-y-2">
            <div><dt className="font-semibold">What was promised?</dt><dd className="text-muted">A {c.symbol} token with total supply {group(c.totalSupply)}, {c.decimals} decimals, a {pct(c.feeSplit.creator)}/{pct(c.feeSplit.taxReserve)}/{pct(c.feeSplit.charity)}/{pct(c.feeSplit.protocol)} fee split{c.charity ? ` and ${c.charity.name} as the charity` : ""}. This is the creator&apos;s configuration, not proof.</dd></div>
            <div><dt className="font-semibold">What was observed?</dt><dd className="text-muted">{o ? `A ${o.source === "FIXTURE" ? "FIXTURE (test data, not a blockchain read)" : "blockchain"} observation at ${o.observedAt}.` : "Nothing. No observation exists."}</dd></div>
            <div><dt className="font-semibold">Do they match?</dt><dd className="text-muted">{p.checks.length === 0 ? "There is nothing to compare." : p.mismatches.length > 0 ? `No. ${p.mismatches.length} observed value${p.mismatches.length === 1 ? " differs" : "s differ"} from the configuration.` : `${p.summary.pass} checks pass and none fail${p.verifiedTransparency ? "." : ", but that is not verification."}`}</dd></div>
            <div><dt className="font-semibold">What could not be verified?</dt><dd className="text-muted">{unresolved.length === 0 ? (p.checks.length === 0 ? "Everything: no token is deployed." : "No required check is unresolved.") : unresolved.map((x) => x.label).join("; ")}. Description, image and links are user-provided and never verified here.</dd></div>
          </dl>
        </Section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section id="identity" title="A · IDENTITY">
          <dl className="divide-y divide-line">
            <Row label="Network">{p.identity.network}</Row>
            <Row label="Mint address">{p.identity.mintAddress ?? <span className="text-faint">NOT DEPLOYED</span>}{p.identity.mintAddress ? <Prov p={p.identity.mintProvenance} /> : null}</Row>
            <Row label="Deployment signature">{p.identity.deploymentSignature ?? <span className="text-faint">NOT AVAILABLE</span>}{p.identity.deploymentSignature ? <Prov p={p.identity.signatureProvenance} /> : null}</Row>
            <Row label="Observed at">{p.identity.observedAt ?? <span className="text-faint">NOT OBSERVED</span>}</Row>
            <Row label="Explorer link"><span className="text-faint">none (not generated by this system)</span></Row>
          </dl>
        </Section>

        <Section id="configured" title="B · CONFIGURATION (WHAT WAS PROMISED)" note={PROOF_COPY.configuredNotProof}>
          <dl className="divide-y divide-line">
            <Row label="Name / symbol">{c.name} / {c.symbol}<Badge tone="neutral" className="ml-2">USER-PROVIDED</Badge></Row>
            <Row label="Decimals">{c.decimals}</Row>
            <Row label="Intended supply">{group(c.totalSupply)} ({group(c.intendedSupplyRaw)} base units). Not all of it exists on-chain.</Row>
            <Row label="Expected minted supply">{group(c.expectedMintedSupplyRaw)} base units (what a chain read should show)</Row>
            <Row label="Permanently unissued">{group(c.unissuedSupplyRaw)} base units. Never minted, not burned.</Row>
            <Row label="Mint authority">{c.mintAuthority.policy === "disabled" ? "disabled" : c.mintAuthority.expected}</Row>
            <Row label="Freeze authority">{c.freezeAuthority.policy === "disabled" ? "disabled" : c.freezeAuthority.expected}</Row>
            <Row label="Fee split">{pct(c.feeSplit.creator)} / {pct(c.feeSplit.taxReserve)} / {pct(c.feeSplit.charity)} / {pct(c.feeSplit.protocol)}</Row>
            <Row label="Charity">{c.charity ? c.charity.name : <span className="text-faint">none</span>}</Row>
            <Row label="Tax reserve allocation">{pct(c.taxReserve.bps)} · {c.taxReserve.destination ?? <span className="text-faint">destination not shown publicly</span>}</Row>
            <Row label="Protocol allocation">{pct(c.protocol.bps)} · <span className="text-faint">no protocol address configured</span></Row>
            <Row label="Creator allocation">{pct(c.creator.bps)} · {c.creator.address}</Row>
            <Row label="Liquidity">{group(c.liquidity.initialLiquidityUsdc)} USDC · lock {c.liquidity.lockDays} days</Row>
            <Row label="Configuration fingerprint"><code className="text-[11px]">{c.fingerprint}</code></Row>
            <Row label="Deployed fingerprint">{c.deployedFingerprint ? <code className="text-[11px]">{c.deployedFingerprint}</code> : <span className="text-faint">NOT RECORDED</span>}</Row>
            <Row label="Description"><span className="break-words">{c.metadata.description || "None"}</span></Row>
            <Row label="Image"><SafeLink href={c.metadata.imageUri} /></Row>
            <Row label="Website"><SafeLink href={c.metadata.website} /></Row>
          </dl>
          <p className="mt-3 text-xs text-faint">{PROOF_COPY.fingerprintNote}</p>
        </Section>
      </div>

      <Section id="observed" title="C · OBSERVED ON-CHAIN (WHAT WAS SEEN)">
        {o ? (
          <>
            <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">Source: <Badge tone={o.source === "RPC" ? "good" : "demo"}>{o.source === "RPC" ? "BLOCKCHAIN READ" : "FIXTURE (NOT A BLOCKCHAIN READ)"}</Badge> at {o.observedAt}<Prov p={o.provenance} /></p>
            <dl className="divide-y divide-line">
              <Row label="Network"><Obs f={o.network} show={(v) => v} /></Row>
              <Row label="Mint"><Obs f={o.mintAddress} show={(v) => v} /></Row>
              <Row label="Decimals"><Obs f={o.decimals} show={(v) => String(v)} /></Row>
              <Row label="Supply (base units)"><Obs f={o.supplyRaw} show={(v) => group(v)} /></Row>
              <Row label="Mint authority"><Obs f={o.mintAuthority} show={authority} /></Row>
              <Row label="Freeze authority"><Obs f={o.freezeAuthority} show={authority} /></Row>
              <Row label="On-chain name / symbol"><Obs f={o.metadata} show={(v) => `${v.name} / ${v.symbol}`} /></Row>
              <Row label="Liquidity"><Obs f={o.liquidity} show={(v) => `${group(v.initialLiquidityUsdc)} USDC · lock ${v.lockDays === null ? "none" : `${v.lockDays} days`}`} /></Row>
              <Row label="Fee routing"><Obs f={o.feeRouting} show={(v) => `${pct(v.creatorBps)} / ${pct(v.taxReserveBps)} / ${pct(v.charityBps)} / ${pct(v.protocolBps)}`} /></Row>
            </dl>
            <p className="mt-3 text-xs text-faint">On-chain metadata is untrusted text. It is shown as plain text and never interpreted or loaded.</p>
          </>
        ) : (
          <p className="text-muted">{p.status === "UNAVAILABLE" && p.evidence.observationCount > 0 ? "The stored observation history failed its integrity check, so no observation is shown." : p.status === "NOT_DEPLOYED" ? PROOF_COPY.noDeployment : "No observation has been recorded."}</p>
        )}
      </Section>

      <Section id="checks" title="D · VERIFICATION CHECKS">
        {p.checks.length === 0 ? <p className="text-muted">No checks apply: {p.status === "NOT_DEPLOYED" ? PROOF_COPY.noDeployment : "the proof history is not usable."}</p> : (
          <ul className="divide-y divide-line">
            {[...p.checks].sort((a, b) => checkOrder(a.id) - checkOrder(b.id)).map((x) => (
              <li key={x.id} className="py-2.5" data-check={x.id} data-state={x.state}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{x.label}</span>
                  <span className="flex items-center gap-1.5"><Badge tone={CHECK_TONE[x.state]}>{x.state.replace("_", " ")}</Badge><Prov p={x.provenance} /></span>
                </div>
                <p className="mt-1 text-xs text-muted">{x.explanation}</p>
                {x.configured !== null || x.observed !== null ? (
                  <p className="num mt-1 break-all text-[11px] text-faint">configured: {x.configured ?? "not available"} · observed: {x.observed ?? "not available"}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="mismatches" title="E · MISMATCHES">
        {p.mismatches.length === 0 ? <p className="text-muted">{p.checks.length === 0 ? "None, because nothing was compared." : "No observed value differs from the configured value. Unknown and unavailable checks are not mismatches and are not passes."}</p> : (
          <ul className="space-y-2">
            {p.mismatches.map((m) => (
              <li key={m.checkId} className="rounded-md border border-loss/30 bg-loss/[0.06] p-3 text-xs">
                <p className="font-semibold text-loss">{m.label}</p>
                <p className="num mt-1 break-all">configured: {m.configured ?? "not available"}</p>
                <p className="num break-all">observed: {m.observed ?? "not available"}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="provenance" title="F · PROVENANCE">
        <ul className="space-y-1.5 text-xs text-muted">
          <li>Configuration <Prov p="CONFIGURED" /> what the creator intended, committed to by the fingerprint.</li>
          <li>Metadata (description, image, links) <Prov p="USER_PROVIDED" /> never fetched, never verified here.</li>
          <li>Mint address and signature <Prov p={p.identity.mintProvenance} /> {p.identity.mintAddress ? "taken from a deployment record, corroborated only by an on-chain check." : "none recorded."}</li>
          <li>Observation <Prov p={o ? o.provenance : "UNAVAILABLE"} /> {o ? `${p.evidence.observationCount} stored, history ${p.evidence.historyIntact ? "intact" : "FAILED its integrity check"}.` : "none."}</li>
          <li>Verified match <Prov p="VERIFIED_MATCH" /> appears only on a check that passed against a blockchain read.</li>
        </ul>
        <p className="mt-3 text-xs text-faint">{PROOF_COPY.historyNote}</p>
      </Section>

      <Section id="disclosure" title="G · DISCLOSURE">
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-muted">
          {p.disclosures.map((d) => <li key={d}>{d}</li>)}
        </ul>
      </Section>
    </div>
  );
}
