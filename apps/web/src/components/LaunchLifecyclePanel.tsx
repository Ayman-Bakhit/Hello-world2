"use client";

import { LAUNCH_COPY, availableLaunchActions, type LaunchHistory } from "@project-name/shared";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { describeApiError, type ApiErrorView } from "@/lib/api/errors";
import { effectiveCharityId, effectiveWalletId, toLaunchRequest, type StepContext } from "@/lib/launch";
import { useLaunch } from "@/state/launch";
import { useWallet } from "@/state/wallet";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { HistoryList, LaunchSummary } from "./LaunchSummary";
import { ApiErrorState } from "./states";

type Busy = null | "save" | "configure" | "review" | "ready" | "cancel";

/**
 * The configuration lifecycle: SAVE DRAFT -> VALIDATE -> SUBMIT FOR REVIEW -> MARK READY. Every status comes from the server; this
 * panel only asks for named actions. None of them creates a token, a mint, liquidity or any transaction.
 */
export function LaunchLifecyclePanel({ ctx, blocked }: { ctx: StepContext; blocked: boolean }) {
  const { config, savedLaunch, setSavedLaunch, dirty, markSaved } = useLaunch();
  const wallet = useWallet();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<ApiErrorView | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [publish, setPublish] = useState(false);
  const [history, setHistory] = useState<LaunchHistory | null>(null);

  const status = savedLaunch?.status ?? null;
  const can = availableLaunchActions(status, dirty);
  const needsAuth = wallet.mode === "api" && !wallet.authenticated;

  const fail = (e: unknown) => {
    const v = describeApiError(e);
    setError(v);
    if (v.kind === "unauthenticated") void wallet.refreshSession();
  };
  const run = (what: Exclude<Busy, null>, f: () => Promise<import("@project-name/shared").Launch>, after?: () => void) => {
    setBusy(what); setError(null); setHistory(null);
    f().then((l) => { setSavedLaunch(l); after?.(); setBusy(null); }, (e: unknown) => { fail(e); setBusy(null); });
  };

  const save = () => {
    const creator = wallet.wallets.find((w) => w.id === effectiveWalletId(config.creatorWalletId, ctx));
    const reserve = wallet.wallets.find((w) => w.id === effectiveWalletId(config.reserveWalletId, ctx));
    if (!creator || !reserve) {
      setError({ kind: "validation", title: "CHECK YOUR INPUT", message: "Select a creator wallet and a tax reserve allocation destination first.", retryable: false });
      return;
    }
    const body = toLaunchRequest(config, { creatorAddress: creator.address, reserveAddress: reserve.address, charityId: effectiveCharityId(config.charityId, ctx) });
    run("save", () => (savedLaunch ? api.updateLaunch(savedLaunch.id, body) : api.createLaunch(body)), () => { markSaved(); setConfirmed(false); });
  };

  const showHistory = () => {
    if (!savedLaunch) return;
    api.getLaunchHistory(savedLaunch.id).then(setHistory, fail);
  };

  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">LAUNCH CONFIGURATION</p>
        <Badge tone="neutral">NOTHING IS DEPLOYED</Badge>
      </div>
      <p className="mt-2 text-xs text-muted">Saving stores this configuration in your account. Validating and submitting for review ask the server to re-check it. None of these steps creates a token, a mint, liquidity, a contract or any transaction, and your wallet is never asked to sign.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={save} disabled={blocked || busy !== null || needsAuth || !(savedLaunch ? can.save : true)}>
          {busy === "save" ? "SAVING…" : savedLaunch ? "SAVE CHANGES" : "SAVE DRAFT"}
        </Button>
        <Button onClick={() => run("configure", () => api.configureLaunch(savedLaunch!.id))} disabled={!can.configure || busy !== null}>{busy === "configure" ? "VALIDATING…" : "VALIDATE CONFIGURATION"}</Button>
        <Button onClick={() => run("review", () => api.reviewLaunch(savedLaunch!.id))} disabled={!can.review || busy !== null}>{busy === "review" ? "SUBMITTING…" : "SUBMIT FOR REVIEW"}</Button>
        {savedLaunch && can.cancel ? <Button variant="ghost" onClick={() => run("cancel", () => api.cancelLaunch(savedLaunch.id))} disabled={busy !== null}>CANCEL CONFIGURATION</Button> : null}
        {savedLaunch ? <Button variant="ghost" onClick={showHistory}>HISTORY</Button> : null}
      </div>
      {dirty && savedLaunch ? <p className="mt-2 text-xs text-warn">You have unsaved changes. Saving returns the configuration to DRAFT, so it must be validated and reviewed again.</p> : null}
      {needsAuth ? <p className="mt-2 text-xs text-warn">Sign in with your wallet to save a configuration.</p> : null}
      {blocked ? <p className="mt-2 text-xs text-loss">Fix the problems above before saving.</p> : null}

      {savedLaunch && can.ready ? (
        <fieldset className="mt-4 rounded-md border border-accent/40 p-3">
          <legend className="px-1 text-xs font-semibold">Mark ready for deployment</legend>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I have reviewed this exact configuration (fingerprint <span className="num font-mono">{savedLaunch.fingerprint.slice(0, 12)}…</span>). I understand READY is not deployed: no token is created.</span></label>
          <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
            <span>Make this configuration publicly viewable (read-only, no wallet addresses).</span></label>
          <Button variant="primary" className="mt-3" disabled={!confirmed || busy !== null} onClick={() => run("ready", () => api.readyLaunch(savedLaunch.id, { fingerprint: savedLaunch.fingerprint, confirmed: true, publish }))}>
            {busy === "ready" ? "MARKING…" : "MARK READY FOR DEPLOYMENT"}
          </Button>
        </fieldset>
      ) : null}

      {error ? <div className="mt-3"><ApiErrorState error={error} /></div> : null}
      {savedLaunch ? <div className="mt-3"><LaunchSummary launch={savedLaunch} /></div> : null}
      {history ? <div className="mt-3"><HistoryList history={history} /></div> : null}
      {savedLaunch?.status === "READY" ? <p className="mt-3 text-xs font-semibold text-warn">{LAUNCH_COPY.deploymentDisabled}</p> : null}
    </div>
  );
}
