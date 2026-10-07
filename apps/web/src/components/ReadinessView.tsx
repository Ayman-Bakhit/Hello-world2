import type { DeploymentDecisionSummary, ExecutionReadinessResponse } from "@project-name/shared";
import { Badge } from "./Badge";
import { DataSourceBadge } from "./DataSource";

/**
 * DEPLOYMENT READINESS (pure view). Shows what the server derived. It decides nothing, has no control that signs, sends or
 * approves, and never says a launch is ready to sign: real execution is disabled in this build.
 */
type Tone = "neutral" | "good" | "bad" | "info" | "demo";
const GATE_TONE: Record<string, Tone> = { PASS: "good", BLOCKED: "bad", PENDING: "demo", NOT_APPLICABLE: "neutral" };
const CATEGORY_LABEL: Record<string, string> = { PRODUCT: "PRODUCT DECISION", TECHNICAL: "TECHNICAL", SECURITY: "SECURITY", LEGAL: "LEGAL" };
const GROUPS: Array<{ title: string; ids: string[] }> = [
  { title: "Launch and plan", ids: ["LAUNCH_READY", "FINGERPRINT_CURRENT", "PLAN_BUILDABLE", "PLAN_RECORDED_CURRENT"] },
  { title: "Token and economics", ids: ["TOKEN_PROGRAM_SELECTED", "SUPPLY_ALLOCATION_DEFINED", "ALLOCATIONS_SUM_10000_BPS", "UNISSUED_SUPPLY_PERMANENT", "ALLOCATION_LOCKS_DEFINED", "METADATA_STRATEGY_DEFINED", "LIQUIDITY_STRATEGY_DEFINED"] },
  { title: "Fees and destinations", ids: ["FEE_SPLIT_VALID", "FEE_SPLIT_SCOPE_DEFINED", "FEE_ROUTING_DEFINED", "FEE_ROUTING_ENFORCEABLE", "PROTOCOL_DESTINATION_VALID", "CHARITY_DESTINATIONS_VERIFIED", "CHARITY_GOVERNANCE_DEFINED", "TAX_RESERVE_DESTINATION_VALID", "TAX_RESERVE_FUNDING_DEFINED"] },
  { title: "Keys, costs, environment and approval", ids: ["MINT_STRATEGY_DEFINED", "FEE_POLICY_DEFINED", "CLUSTER_VALID", "PRODUCT_APPROVAL_COMPLETE"] },
  { title: "Reviews and the execution gate", ids: ["SECURITY_REVIEW_COMPLETE", "SMART_CONTRACT_REVIEW_COMPLETE", "LEGAL_REVIEW_COMPLETE", "REAL_EXECUTION_ENABLED"] },
];

export function ReadinessView({ data, decisions }: { data: ExecutionReadinessResponse; decisions?: DeploymentDecisionSummary | null }) {
  const r = data.readiness;
  const fixture = data.dataSource === "demo";
  const byId = new Map(r.gates.map((g) => [g.id as string, g]));
  return (
    <div className="space-y-5">
      {fixture ? <div role="note" className="rounded-md border border-warn/30 bg-warn/[0.07] px-3 py-2 text-xs text-warn"><span className="mr-2 font-bold tracking-wider">DEMO · FIXTURE</span>A fictional launch. Nothing was ever signed or sent.</div> : null}

      <header className="rounded-lg border border-line-strong bg-surface p-4" aria-label="Readiness status">
        <p className="eyebrow">DEPLOYMENT READINESS</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={r.overall === "BLOCKED" ? "bad" : "info"} className="!px-2 !py-1 !text-xs">{r.overall === "BLOCKED" ? "BLOCKED" : "EXECUTION DISABLED"}</Badge>
          <Badge tone="neutral" className="!px-2 !py-1 !text-xs">REAL EXECUTION: {data.execution.label}</Badge>
          {data.execution.notices.map((n) => <Badge key={n} tone="neutral" className="!px-2 !py-1 !text-xs">{n}</Badge>)}
          <DataSourceBadge dataSource={data.dataSource} />
        </div>
        <p className="mt-3 text-sm">{r.note}</p>
        <p className="mt-2 text-xs text-faint">{r.summary.pass} passed · {r.summary.blocked} blocked · {r.summary.pending} pending · {r.summary.notApplicable} not applicable. Policy <code className="num">{r.policyHash.slice(0, 12)}…</code>{r.planHash ? <> · plan <code className="num">{r.planHash.slice(0, 12)}…</code></> : " · no plan can be built"}</p>
        <div className="mt-3"><button type="button" disabled aria-disabled="true" className="cursor-not-allowed rounded border border-line px-3 py-2 text-xs font-semibold tracking-wider text-faint">EXECUTION NOT ENABLED IN THIS BETA</button></div>
      </header>

      {GROUPS.map((grp) => (
        <section key={grp.title} className="rounded-lg border border-line bg-surface" aria-label={grp.title}>
          <div className="border-b border-line px-4 py-3"><h2 className="eyebrow !text-muted">{grp.title}</h2></div>
          <ul className="divide-y divide-line">
            {grp.ids.map((id) => {
              const g = byId.get(id);
              if (!g) return null;
              return (
                <li key={id} className="p-4 text-sm" data-gate={g.id} data-status={g.status}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{g.title}</span>
                    <span className="flex items-center gap-1.5"><Badge tone="neutral">{CATEGORY_LABEL[g.category] ?? g.category}</Badge><Badge tone={GATE_TONE[g.status] ?? "neutral"}>{g.status.replace("_", " ")}</Badge></span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{g.reason}</p>
                  {g.required ? <p className="mt-1 text-xs"><span className="font-semibold">Must be decided or done:</span> {g.required}</p> : null}
                  <p className="mt-1 text-[11px] text-faint">Source: {g.provenance}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {decisions ? (
        <>
          <section className="rounded-lg border border-line bg-surface" aria-label="Decisions">
            <div className="border-b border-line px-4 py-3"><h2 className="eyebrow !text-muted">DECISION RECORDS · {decisions.counts.decided} DECIDED · {decisions.counts.pending} PENDING · {decisions.counts.unapproved} WITHOUT PRODUCT APPROVAL</h2></div>
            <ul className="divide-y divide-line">
              {decisions.decisions.map((d) => (
                <li key={d.id} className="p-4 text-xs" data-decision={d.id} data-status={d.status} data-approval={d.approval.status} data-blocking={d.blocking ? "yes" : "no"}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{d.title}</span><span className="flex flex-wrap gap-1.5"><Badge tone="neutral">{CATEGORY_LABEL[d.category] ?? d.category}</Badge><Badge tone={d.status === "DECIDED" ? "good" : "demo"}>{d.status}</Badge><Badge tone={d.approval.status === "APPROVED" ? "good" : d.approval.status === "REJECTED" ? "bad" : "demo"}>{d.approval.status.replaceAll("_", " ")}</Badge><Badge tone="neutral">v{d.version}</Badge>{d.blocking ? <Badge tone="bad">BLOCKING</Badge> : <Badge tone="good">NOT BLOCKING</Badge>}</span></div>
                  <p className="mt-1 text-muted">{d.summary}</p>
                  <p className="mt-1"><span className="font-semibold">Value:</span> {d.value ? <code className="num break-all">{JSON.stringify(d.value)}</code> : <span className="text-faint">none: not decided</span>}</p>
                  {d.missing ? <p className="mt-1"><span className="font-semibold">Missing:</span> {d.missing}</p> : null}
                  {d.notes.length > 0 ? <ul className="mt-1 list-disc pl-5"><li className="list-none -ml-5 font-semibold">Product owner notes:</li>{d.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
                  {d.requires.length > 0 ? <ul className="mt-1 list-disc pl-5"><li className="list-none -ml-5 font-semibold">Must be pinned down:</li>{d.requires.map((r) => <li key={r}>{r}</li>)}</ul> : null}
                  <p className="mt-1 text-faint">Source: {d.provenance.replaceAll("_", " ")} · approver: {d.approval.approver ?? "none recorded"} · approved at: {d.approval.approvedAt ?? "not approved"}{d.approval.reference ? ` · reference: ${d.approval.reference}` : ""}</p>
                  <p className="mt-1 text-faint">Depends on: {d.dependsOn.length ? d.dependsOn.join(", ") : "nothing"} · applies to {d.environments.join(", ")} · changing it invalidates readiness: {d.invalidatesReadiness ? "yes" : "no"}</p>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-4 py-3 text-xs text-faint">Approval is recorded only by a reviewed change in the codebase. Nothing on this page can approve a decision, and an approval is not an on-chain implementation.</p>
          </section>
          <section className="rounded-lg border border-line bg-surface" aria-label="Milestones">
            <div className="border-b border-line px-4 py-3"><h2 className="eyebrow !text-muted">WHAT EACH DECISION BLOCKS</h2></div>
            <ul className="divide-y divide-line">
              {decisions.milestones.map((m) => (
                <li key={m.id} className="p-4 text-xs" data-milestone={m.id} data-unblocked={m.unblocked ? "yes" : "no"}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{m.title}</span><Badge tone={m.unblocked ? "good" : "bad"}>{m.unblocked ? "DECISIONS SETTLED" : "BLOCKED"}</Badge></div>
                  {m.blockedBy.length > 0 ? <p className="mt-1">Waiting on decisions: {m.blockedBy.join(", ")}</p> : null}
                  {m.blockedByMilestones.length > 0 ? <p className="mt-1">Waiting on earlier milestones: {m.blockedByMilestones.join(", ")}</p> : null}
                  <p className="mt-1 text-faint">Also needs engineering: {m.engineeringPrerequisites.join("; ")}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      <section className="rounded-lg border border-line bg-surface p-4 text-xs text-muted" aria-label="Disclosure">
        <p>Readiness is derived on the server from the stored launch, the charity registry and the decisions above. No flag from this page can change it. A passing gate is not an approval, and nothing here is legal or security approval. The configured fee split is a configuration, not an on-chain rule.</p>
      </section>
    </div>
  );
}
