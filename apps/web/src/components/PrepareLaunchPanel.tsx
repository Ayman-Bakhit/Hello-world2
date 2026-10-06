"use client";

import type { Launch } from "@project-name/shared";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { describeApiError, type ApiErrorView } from "@/lib/api/errors";
import { formatUsd } from "@/lib/format";
import { effectiveCharityId, effectiveWalletId, toLaunchRequest, type StepContext } from "@/lib/launch";
import { useLaunch } from "@/state/launch";
import { useWallet } from "@/state/wallet";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { DataSourceBadge } from "./DataSource";
import { ApiErrorState } from "./states";

export function launchStatusBadge(status: Launch["status"]): { label: string; tone: "neutral" | "good" | "bad" } {
  return status === "review_passed" ? { label: "REVIEW PASSED", tone: "good" } : status === "review_failed" ? { label: "REVIEW FAILED", tone: "bad" } : { label: "DRAFT", tone: "neutral" };
}

/** Pure view of a saved launch configuration and its server review. States plainly that nothing is deployed. */
export function LaunchSummary({ launch }: { launch: Launch }) {
  const st = launchStatusBadge(launch.status);
  const r = launch.review;
  return (
    <div className="rounded-md border border-line bg-surface-2/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{launch.config.name}</span>
        <span className="num font-mono text-xs text-muted">{launch.config.symbol}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
        <Badge tone="neutral">NOT DEPLOYED</Badge>
        <DataSourceBadge dataSource={launch.dataSource} />
      </div>
      <p className="mt-1 text-xs text-faint">Configuration id {launch.id}. A saved configuration is a record only: no token, liquidity, contract, or fee routing exists.</p>
      {r ? (
        <div className="mt-3 space-y-2">
          <p className={`text-xs font-semibold ${r.passed ? "text-gain" : "text-loss"}`}>{r.passed ? "Server review passed this configuration." : "Server review found problems."}</p>
          {r.errors.length > 0 ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-loss">{r.errors.map((e) => <li key={`${e.field}-${e.message}`}>{e.message}</li>)}</ul> : null}
          {r.warnings.length > 0 ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-warn">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
          <p className="text-xs text-muted">
            {r.feeSplitLabel} (enforcement: {r.feeSplitEnforcement.replace("_", " ")}). Example $1,000.00 fee:{" "}
            {Object.entries(r.moneyFlowExampleCents).map(([k, v]) => `${k} ${formatUsd(BigInt(v), { cents: true })}`).join(" · ")}.
          </p>
          <p className="text-xs text-faint">Deployable: no. Deployment is not available in this build.</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">Not reviewed yet.</p>
      )}
    </div>
  );
}

/**
 * PREPARE LAUNCH: save the configuration (POST /api/launches) and run the server review
 * (POST /api/launches/:id/review). Neither deploys anything.
 */
export function PrepareLaunchPanel({ ctx, blocked }: { ctx: StepContext; blocked: boolean }) {
  const { config, savedLaunch, setSavedLaunch } = useLaunch();
  const wallet = useWallet();
  const [busy, setBusy] = useState<null | "save" | "review">(null);
  const [error, setError] = useState<ApiErrorView | null>(null);

  const fail = (e: unknown) => {
    const v = describeApiError(e);
    setError(v);
    if (v.kind === "unauthenticated") void wallet.refreshSession();
  };

  const save = () => {
    const creator = wallet.wallets.find((w) => w.id === effectiveWalletId(config.creatorWalletId, ctx));
    const reserve = wallet.wallets.find((w) => w.id === effectiveWalletId(config.reserveWalletId, ctx));
    if (!creator || !reserve) {
      setError({ kind: "validation", title: "CHECK YOUR INPUT", message: "Select a creator wallet and a reserve destination first.", retryable: false });
      return;
    }
    let body;
    try {
      body = toLaunchRequest(config, { creatorAddress: creator.address, reserveAddress: reserve.address, charityId: effectiveCharityId(config.charityId, ctx) });
    } catch {
      setError({ kind: "validation", title: "CHECK YOUR INPUT", message: "The fee split must total exactly 100% before saving.", retryable: false });
      return;
    }
    setBusy("save"); setError(null);
    api.createLaunch(body).then((l) => { setSavedLaunch(l); setBusy(null); }, (e: unknown) => { fail(e); setBusy(null); });
  };

  const review = () => {
    if (!savedLaunch) return;
    setBusy("review"); setError(null);
    api.reviewLaunch(savedLaunch.id).then((l) => { setSavedLaunch(l); setBusy(null); }, (e: unknown) => { fail(e); setBusy(null); });
  };

  const needsAuth = wallet.mode === "api" && !wallet.authenticated;
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">PREPARE LAUNCH</p>
        <Badge tone="neutral">NOTHING IS DEPLOYED</Badge>
      </div>
      <p className="mt-2 text-xs text-muted">Saving stores this configuration in your account. Reviewing asks the server to re-check it. Neither creates a token, liquidity, a contract, or any transaction.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={save} disabled={blocked || busy !== null || needsAuth}>{busy === "save" ? "SAVING…" : savedLaunch ? "SAVE AGAIN AS NEW" : "SAVE LAUNCH CONFIGURATION"}</Button>
        <Button onClick={review} disabled={!savedLaunch || busy !== null}>{busy === "review" ? "REVIEWING…" : "RUN SERVER REVIEW"}</Button>
      </div>
      {needsAuth ? <p className="mt-2 text-xs text-warn">Sign in with your wallet to save a configuration.</p> : null}
      {blocked ? <p className="mt-2 text-xs text-loss">Fix the problems above before saving.</p> : null}
      {error ? <div className="mt-3"><ApiErrorState error={error} /></div> : null}
      {savedLaunch ? <div className="mt-3"><LaunchSummary launch={savedLaunch} /></div> : null}
    </div>
  );
}
