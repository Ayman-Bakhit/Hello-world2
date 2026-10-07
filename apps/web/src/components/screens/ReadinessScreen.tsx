"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { useWallet } from "@/state/wallet";
import { EmptyState } from "../EmptyState";
import { PageHeader } from "../PageHeader";
import { ReadinessView } from "../ReadinessView";
import { AuthRequired, ResourceView } from "../states";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const valid = UUID.test(id);
  const wallet = useWallet();
  const needsAuth = wallet.mode === "api" && wallet.sessionChecked && !wallet.authenticated;
  const blocked = !valid || (wallet.mode === "api" && !wallet.authenticated);
  const key = `${wallet.authenticatedAddress ?? "mock"}:${valid ? id : "none"}`;
  const readiness = useResource(`readiness:${key}`, blocked ? null : () => api.getExecutionReadiness(id), () => void wallet.refreshSession());
  const decisions = useResource(`readiness-decisions:${key}`, blocked ? null : () => api.getDeploymentDecisionSummary(id));
  if (!valid) return <EmptyState badge="NOT FOUND" title="NO SUCH LAUNCH" description="Open deployment readiness from one of your launch configurations." />;
  if (needsAuth) return <AuthRequired message="Sign in to see deployment readiness for your launch configuration." />;
  return (
    <ResourceView resource={readiness} loadingLabel="Evaluating readiness">
      {(d) => <ReadinessView data={d} decisions={decisions.status === "ok" ? decisions.data : null} />}
    </ResourceView>
  );
}

export function ReadinessScreen(): ReactNode {
  return (
    <div>
      <PageHeader eyebrow="Launch" title="Deployment readiness" subtitle="Every prerequisite before a real transaction could ever be executed, and what is still undecided. Real execution is disabled. No transactions sent. No funds moved. No private keys stored." />
      <Suspense fallback={null}><Detail /></Suspense>
      <p className="mt-4 flex gap-4 text-xs"><Link className="text-accent underline underline-offset-2" href="/launch">Back to launch</Link></p>
    </div>
  );
}
