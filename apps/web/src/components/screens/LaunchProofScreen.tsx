"use client";

import { DEMO_IDS, PROOF_SCENARIOS, PROOF_SCENARIO_LETTER, type ProofScenario } from "@project-name/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { api } from "@/lib/api/client";
import { API_MODE } from "@/lib/api/config";
import { useResource } from "@/lib/api/useResource";
import { useWallet } from "@/state/wallet";
import { EmptyState } from "../EmptyState";
import { LaunchProofView } from "../LaunchProofView";
import { PageHeader } from "../PageHeader";
import { AuthRequired, ResourceView } from "../states";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBTITLE = "Configured values describe the intended launch configuration. They are not blockchain proof. Verified Transparency is shown only when required objective checks pass.";

function OwnerDetail() {
  const id = useSearchParams().get("id") ?? "";
  const valid = UUID.test(id);
  const wallet = useWallet();
  const needsAuth = wallet.mode === "api" && wallet.sessionChecked && !wallet.authenticated;
  const blocked = !valid || (wallet.mode === "api" && !wallet.authenticated);
  const res = useResource(`launch-proof:${wallet.authenticatedAddress ?? "mock"}:${valid ? id : "none"}`, blocked ? null : () => api.getLaunchProof(id), () => void wallet.refreshSession());
  if (!valid) return <EmptyState badge="NOT FOUND" title="NO SUCH LAUNCH" description="Open a token proof from one of your launch configurations." />;
  if (needsAuth) return <AuthRequired message="Sign in to see the token proof for your launch configuration." />;
  return <ResourceView resource={res} loadingLabel="Loading token proof">{(p) => <LaunchProofView proof={p} />}</ResourceView>;
}

export function LaunchProofScreen(): ReactNode {
  return (
    <div>
      <PageHeader eyebrow="Launch" title="Token proof" subtitle={SUBTITLE} />
      <Suspense fallback={null}><OwnerDetail /></Suspense>
      <p className="mt-4 text-xs"><Link className="text-accent underline underline-offset-2" href="/launch">Back to launch</Link></p>
    </div>
  );
}

/** Mock mode only: pick which labeled FIXTURE scenario the demo launch shows. Never rendered against a real API. */
function ScenarioPicker({ current, onPick }: { current: ProofScenario; onPick: (s: ProofScenario) => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Fixture scenario">
      <span className="eyebrow">FIXTURE SCENARIO</span>
      {PROOF_SCENARIOS.map((s) => (
        <button key={s} type="button" aria-pressed={s === current} onClick={() => onPick(s)}
          className={`rounded border px-2 py-1 ${s === current ? "border-accent text-accent" : "border-line text-muted hover:text-fg"}`}>
          {PROOF_SCENARIO_LETTER[s]} · {s.replaceAll("_", " ")}
        </button>
      ))}
    </div>
  );
}

function PublicDetail() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id") ?? "";
  const valid = UUID.test(id);
  const raw = params.get("scenario") ?? "";
  const scenario: ProofScenario = (PROOF_SCENARIOS as readonly string[]).includes(raw) ? (raw as ProofScenario) : "FULL_MATCH";
  const showPicker = API_MODE !== "api" && id === DEMO_IDS.launch;
  const res = useResource(`public-launch-proof:${valid ? id : "none"}:${showPicker ? scenario : ""}`, valid ? () => api.getPublicLaunchProof(id, showPicker ? scenario : undefined) : null);
  if (!valid) return <EmptyState badge="NOT FOUND" title="NO SUCH PROOF" description="Open a token proof from a published launch configuration." />;
  return (
    <>
      {showPicker ? <ScenarioPicker current={scenario} onPick={(s) => router.replace(`/launches/proof?id=${encodeURIComponent(id)}&scenario=${s}`)} /> : null}
      <ResourceView resource={res} loadingLabel="Loading token proof">{(p) => <LaunchProofView proof={p} />}</ResourceView>
    </>
  );
}

export function PublicLaunchProofScreen(): ReactNode {
  return (
    <div>
      <PageHeader eyebrow="Token proof" title="Token proof" subtitle={`${SUBTITLE} Public view: private wallet details are not shown.`} />
      <Suspense fallback={null}><PublicDetail /></Suspense>
      <p className="mt-4 text-xs"><Link className="text-accent underline underline-offset-2" href="/launches">All public configurations</Link></p>
    </div>
  );
}
