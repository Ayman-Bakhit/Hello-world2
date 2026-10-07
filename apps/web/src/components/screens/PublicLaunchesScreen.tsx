"use client";

import { LAUNCH_COPY, type PublicLaunch } from "@project-name/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { Badge } from "../Badge";
import { Card } from "../Card";
import { DemoDataNotice } from "../DataSource";
import { EmptyState } from "../EmptyState";
import { PublicLaunchView, launchStatusBadge } from "../LaunchSummary";
import { PageHeader } from "../PageHeader";
import { ResourceView } from "../states";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pure list view: read-only summaries that link to the public detail page. */
export function PublicLaunchListView({ launches }: { launches: PublicLaunch[] }) {
  if (launches.length === 0) {
    return <EmptyState badge="NONE" title="NO PUBLIC LAUNCH CONFIGURATIONS" description="No creator has published a configuration yet. Published configurations are read-only records: none is deployed." />;
  }
  return (
    <ul className="divide-y divide-line">
      {launches.map((l) => {
        const st = launchStatusBadge(l.status);
        return (
          <li key={l.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="break-words font-semibold">{l.name}</span>
                <span className="num font-mono text-xs text-muted">{l.symbol}</span>
                <Badge tone={st.tone}>{st.label}</Badge>
                {l.labels.map((x) => <Badge key={x} tone={x === "DEMO DATA" ? "demo" : "neutral"}>{x}</Badge>)}
              </div>
              <Link className="text-xs text-accent underline underline-offset-2" href={`/launches/view?id=${encodeURIComponent(l.id)}`}>VIEW CONFIGURATION</Link>
            </div>
            <p className="mt-1 text-xs text-faint">Charity: {l.charity?.name ?? "not found"} · fingerprint <span className="num font-mono">{l.fingerprint.slice(0, 12)}…</span></p>
          </li>
        );
      })}
    </ul>
  );
}

export function PublicLaunchesScreen(): ReactNode {
  const res = useResource("public-launches", () => api.getPublicLaunches({ limit: 50 }));
  return (
    <div>
      <PageHeader eyebrow="Launch" title="Public launch configurations" subtitle={`Read-only. Every entry is CONFIGURED, ${LAUNCH_COPY.notDeployed}, ${LAUNCH_COPY.notVerified}. ${LAUNCH_COPY.deploymentDisabled}`} />
      <Card title="Published configurations">
        <ResourceView resource={res} loadingLabel="Loading launch configurations">
          {(d) => (
            <>
              <DemoDataNotice dataSource={d.launches.some((l) => l.dataSource === "demo") ? "demo" : "database"} message="Demo launch configurations are fictional. Nothing is deployed." />
              <PublicLaunchListView launches={d.launches} />
            </>
          )}
        </ResourceView>
      </Card>
    </div>
  );
}

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const valid = UUID.test(id);
  const res = useResource(`public-launch:${valid ? id : "none"}`, valid ? () => api.getPublicLaunch(id) : null);
  if (!valid) return <EmptyState badge="NOT FOUND" title="NO SUCH CONFIGURATION" description="Open a published configuration from the list." />;
  return (
    <ResourceView resource={res} loadingLabel="Loading launch configuration">
      {(l) => (
        <Card title="Launch configuration" right={<Badge tone="neutral">READ-ONLY</Badge>}>
          <DemoDataNotice dataSource={l.dataSource} message="A fictional demo configuration. Nothing is deployed." />
          <PublicLaunchView launch={l} />
        </Card>
      )}
    </ResourceView>
  );
}

export function PublicLaunchScreen(): ReactNode {
  return (
    <div>
      <PageHeader eyebrow="Launch" title="Launch configuration" subtitle="A read-only view of a configuration its creator published. It is not a deployed token." />
      <Suspense fallback={null}><Detail /></Suspense>
      <p className="mt-4 text-xs"><Link className="text-accent underline underline-offset-2" href="/launches">All public configurations</Link></p>
    </div>
  );
}
