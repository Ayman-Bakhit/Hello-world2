"use client";

import Link from "next/link";
import { useState } from "react";
import type { Launch } from "@project-name/shared";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { formatDateTime } from "@/lib/format";
import { useLaunch } from "@/state/launch";
import { useWallet } from "@/state/wallet";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { HistoryList, launchStatusBadge, LaunchSummary } from "./LaunchSummary";
import { AuthRequired, ResourceView } from "./states";

function Detail({ id }: { id: string }) {
  const res = useResource(`launch:${id}`, () => api.getLaunch(id));
  const [showHistory, setShowHistory] = useState(false);
  const hist = useResource(`launch-history:${id}:${showHistory}`, showHistory ? () => api.getLaunchHistory(id) : null);
  return (
    <div className="space-y-3">
      <ResourceView resource={res} loadingLabel="Loading configuration">{(l) => <LaunchSummary launch={l} />}</ResourceView>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => setShowHistory((v) => !v)}>{showHistory ? "HIDE HISTORY" : "HISTORY"}</Button>
        <Link className="text-xs text-accent underline underline-offset-2" href={`/launch/proof?id=${encodeURIComponent(id)}`}>TOKEN PROOF</Link>
      </div>
      {showHistory ? <ResourceView resource={hist} loadingLabel="Loading history">{(h) => <HistoryList history={h} />}</ResourceView> : null}
    </div>
  );
}

/** Pure list view. Empty means empty: nothing is invented. */
export function LaunchListView({ launches, openId, onToggle }: { launches: Launch[]; openId: string | null; onToggle: (id: string) => void }) {
  if (launches.length === 0) {
    return <EmptyState badge="NONE YET" title="NO SAVED CONFIGURATIONS" description="Configure a launch above and save a draft to see it here. Saved configurations are records only." />;
  }
  return (
    <ul className="divide-y divide-line">
      {launches.map((l) => {
        const st = launchStatusBadge(l.status);
        return (
          <li key={l.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{l.config.name}</span>
                <span className="num font-mono text-xs text-muted">{l.config.symbol}</span>
                <Badge tone={st.tone}>{st.label}</Badge>
                <Badge tone="neutral">NOT DEPLOYED</Badge>
                <span className="num font-mono text-[11px] text-faint">{l.fingerprint.slice(0, 10)}…</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-faint">
                <span className="num">{formatDateTime(l.createdAt)}</span>
                <Button variant="ghost" onClick={() => onToggle(l.id)} aria-expanded={openId === l.id}>{openId === l.id ? "HIDE" : "VIEW"}</Button>
              </div>
            </div>
            {openId === l.id ? <div className="mt-3"><Detail id={l.id} /></div> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function LaunchList() {
  const wallet = useWallet();
  const { savedLaunch } = useLaunch();
  const [open, setOpen] = useState<string | null>(null);
  const needsAuth = wallet.mode === "api" && wallet.sessionChecked && !wallet.authenticated;
  const key = `launches:${wallet.authenticatedAddress ?? "mock"}:${savedLaunch?.id ?? ""}:${savedLaunch?.updatedAt ?? ""}`;
  const res = useResource(key, wallet.mode === "api" && !wallet.authenticated ? null : () => api.getLaunches({ limit: 50 }), () => void wallet.refreshSession());
  return (
    <Card title="Your launch configurations" className="mt-8">
      {needsAuth ? <AuthRequired message="Sign in to see your saved launch configurations." /> : (
        <ResourceView resource={res} loadingLabel="Loading configurations">
          {(d) => <LaunchListView launches={d.launches} openId={open} onToggle={(id) => setOpen((o) => (o === id ? null : id))} />}
        </ResourceView>
      )}
    </Card>
  );
}
