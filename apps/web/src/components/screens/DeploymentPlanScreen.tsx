"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { useWallet } from "@/state/wallet";
import { DeploymentReviewView } from "../DeploymentReviewView";
import { EmptyState } from "../EmptyState";
import { PageHeader } from "../PageHeader";
import { AuthRequired, ResourceView } from "../states";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const valid = UUID.test(id);
  const wallet = useWallet();
  const needsAuth = wallet.mode === "api" && wallet.sessionChecked && !wallet.authenticated;
  const blocked = !valid || (wallet.mode === "api" && !wallet.authenticated);
  const res = useResource(`deployment-plan:${wallet.authenticatedAddress ?? "mock"}:${valid ? id : "none"}`, blocked ? null : () => api.getDeploymentPlan(id), () => void wallet.refreshSession());
  if (!valid) return <EmptyState badge="NOT FOUND" title="NO SUCH LAUNCH" description="Open a deployment plan from one of your READY launch configurations." />;
  if (needsAuth) return <AuthRequired message="Sign in to review the deployment plan for your launch configuration." />;
  return <ResourceView resource={res} loadingLabel="Building deployment plan">{(d) => <DeploymentReviewView data={d} />}</ResourceView>;
}

export function DeploymentPlanScreen(): ReactNode {
  return (
    <div>
      <PageHeader eyebrow="Launch" title="Deployment plan" subtitle="What your wallet would be asked to sign, who would receive what, and what the chain should look like afterward. NOT DEPLOYED. NOT SIGNED. NO FUNDS MOVED. Execution is not enabled in this beta." />
      <Suspense fallback={null}><Detail /></Suspense>
      <p className="mt-4 text-xs"><Link className="text-accent underline underline-offset-2" href="/launch">Back to launch</Link></p>
    </div>
  );
}
