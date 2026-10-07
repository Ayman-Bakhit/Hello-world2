"use client";

import { LAUNCH_COPY, percentToBps } from "@project-name/shared";
import { cn } from "@/lib/cn";
import { formatPercentBps } from "@/lib/format";
import { allErrors, effectiveWalletId, LAST_REACHABLE_STEP, LAUNCH_STEPS, stepErrors, type LaunchStepId, type StepContext } from "@/lib/launch";
import type { Charity } from "@/lib/types";
import { useLaunch } from "@/state/launch";
import { useWallet } from "@/state/wallet";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { FeeSplitEditor } from "./FeeSplitEditor";
import { CharityConfig, Field, inputCls, ReserveConfig, WalletSelect } from "./LaunchParts";
import { LaunchLifecyclePanel } from "./LaunchLifecyclePanel";
import { ReadyBanner } from "./LaunchSummary";
import { RiskPanel, type Row } from "./RiskPanel";
import { UnavailableState } from "./states";

const IDS = LAUNCH_STEPS.map((s) => s.id);

export function useStepContext(charities: Charity[]): StepContext {
  const { ready, wallets } = useWallet();
  return {
    walletConnected: ready,
    verifiedCharityIds: charities.filter((c) => c.verification === "VERIFIED").map((c) => c.id),
    walletIds: wallets.map((w) => w.id),
  };
}

function reviewRows(c: ReturnType<typeof useLaunch>["config"]): Row[] {
  const alloc = (() => { try { return percentToBps(c.creatorAllocationPercent); } catch { return 0; } })();
  return [
    { label: "Mint authority", value: c.mintAuthority === "disabled" ? "Disabled after mint" : "Held by creator (disclosed)", level: c.mintAuthority === "disabled" ? "ok" : "watch" },
    { label: "Freeze authority", value: c.freezeAuthority === "disabled" ? "Disabled" : "Held by creator (disclosed)", level: c.freezeAuthority === "disabled" ? "ok" : "watch" },
    { label: "Creator allocation", value: formatPercentBps(alloc), level: alloc > 2000 ? "watch" : "info" },
    { label: "Top 10 concentration", value: "Unknown until launch", level: "info" },
    { label: "Liquidity", value: `$${c.liquidityUsdc} USDC · ${Number(c.liquidityLockDays) > 0 ? `lock ${c.liquidityLockDays}d (not enforced in demo)` : "no lock"}`, level: Number(c.liquidityLockDays) > 0 ? "info" : "watch" },
    { label: "Admin privileges", value: "No contract exists yet. Cannot be evaluated.", level: "info" },
  ];
}

export function LaunchWizard({ charities }: { charities: Charity[] }) {
  const { config, update, step, setStep, savedLaunch, dirty } = useLaunch();
  const wallet = useWallet();
  const ctx = useStepContext(charities);

  const idx = IDS.indexOf(step);
  const firstInvalid = IDS.slice(0, IDS.indexOf("review")).findIndex((id) => stepErrors(id, config, ctx).length > 0);
  const maxIdx = firstInvalid >= 0 ? firstInvalid : IDS.indexOf(LAST_REACHABLE_STEP);
  const errors = stepErrors(step, config, ctx);
  const blocked = allErrors(config, ctx);
  const canNext = errors.length === 0 && idx < IDS.indexOf(LAST_REACHABLE_STEP);
  const go = (to: LaunchStepId) => { if (IDS.indexOf(to) <= maxIdx) setStep(to); };
  const next = () => { const n = IDS[idx + 1]; if (n) setStep(n); };
  const prev = () => { const p = IDS[idx - 1]; if (p) setStep(p); };

  return (
    <div id="wizard" className="scroll-mt-20">
      <ol className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Launch steps">
        {LAUNCH_STEPS.map((s, i) => {
          const reachable = i <= maxIdx;
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => go(s.id)}
                aria-current={s.id === step ? "step" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide",
                  s.id === step ? "border-accent/60 bg-accent/10 text-accent" : reachable ? "border-line-strong text-muted hover:text-fg" : "border-line text-faint/60",
                )}
              >
                <span className="num">{i + 1}</span>
                {s.title}
              </button>
            </li>
          );
        })}
      </ol>

      <Card title={`Step ${idx + 1} of ${IDS.length} · ${LAUNCH_STEPS[idx]?.title}`} right={<Badge tone="neutral">PREPARATION ONLY</Badge>}>
        {step === "connect" ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted">Your authenticated wallet is the creator wallet. This build prepares and reviews launch configurations only: nothing is deployed and your wallet is never asked to sign a launch transaction.</p>
            {wallet.ready ? (
              <p className="text-gain">{wallet.mode === "api" ? "Authenticated" : "Demo wallet connected"}: {wallet.wallets.map((w) => w.label).join(", ")}</p>
            ) : (
              <Button variant="primary" onClick={wallet.openModal}>CONNECT WALLET</Button>
            )}
          </div>
        ) : null}

        {step === "create" ? (
          <div className="space-y-4 text-sm">
            <p className="text-muted">Chain: Solana. A future deployment would use standard SPL Token / Token-2022 created through audited libraries. This build only records configuration.</p>
            <Field label="Network" htmlFor="t-network" hint="Recorded as configuration only. Nothing is deployed to any network.">
              <select id="t-network" className={inputCls} value={config.network} onChange={(e) => update({ network: e.target.value as "devnet" | "mainnet-beta" })}>
                <option value="devnet">devnet (default)</option>
                <option value="mainnet-beta">mainnet-beta</option>
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Mint authority" htmlFor="mint-auth" hint="Default: revoked, so supply cannot grow.">
                <select id="mint-auth" className={inputCls} value={config.mintAuthority} onChange={(e) => update({ mintAuthority: e.target.value as "disabled" | "creator" })}>
                  <option value="disabled">Disabled after mint (default)</option>
                  <option value="creator">Held by creator (disclosed)</option>
                </select>
              </Field>
              <Field label="Freeze authority" htmlFor="freeze-auth" hint="Default: none, so holders cannot be frozen.">
                <select id="freeze-auth" className={inputCls} value={config.freezeAuthority} onChange={(e) => update({ freezeAuthority: e.target.value as "disabled" | "creator" })}>
                  <option value="disabled">Disabled (default)</option>
                  <option value="creator">Held by creator (disclosed)</option>
                </select>
              </Field>
              <Field label="Update authority" htmlFor="update-auth" hint="Controls token metadata.">
                <select id="update-auth" className={inputCls} value={config.updateAuthority} onChange={(e) => update({ updateAuthority: e.target.value as "creator" | "disabled" })}>
                  <option value="creator">Creator wallet</option>
                  <option value="disabled">Disabled (metadata frozen)</option>
                </select>
              </Field>
            </div>
          </div>
        ) : null}

        {step === "info" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Token name" htmlFor="t-name"><input id="t-name" className={inputCls} maxLength={32} value={config.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Example Token" /></Field>
            <Field label="Symbol" htmlFor="t-symbol" hint="2 to 10 characters, A-Z and 0-9."><input id="t-symbol" className={inputCls} maxLength={10} value={config.symbol} onChange={(e) => update({ symbol: e.target.value.toUpperCase() })} placeholder="EXMPL" /></Field>
            <div className="sm:col-span-2">
              <Field label="Description" htmlFor="t-desc" hint={`${config.description.length}/280. Describe what the token is. Do not promise returns.`}>
                <textarea id="t-desc" rows={3} className={inputCls} maxLength={280} value={config.description} onChange={(e) => update({ description: e.target.value })} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <p className="text-[11px] text-faint">{LAUNCH_COPY.metadataNote} URLs are stored as text and never fetched by the server.</p>
            </div>
            <Field label="Image URL (optional)" htmlFor="t-image" hint="https only."><input id="t-image" className={inputCls} maxLength={500} value={config.imageUrl} onChange={(e) => update({ imageUrl: e.target.value })} placeholder="https://" /></Field>
            <Field label="Website (optional)" htmlFor="t-website" hint="http or https."><input id="t-website" className={inputCls} maxLength={500} value={config.website} onChange={(e) => update({ website: e.target.value })} placeholder="https://" /></Field>
            <Field label="Twitter link (optional)" htmlFor="t-twitter"><input id="t-twitter" className={inputCls} maxLength={500} value={config.twitter} onChange={(e) => update({ twitter: e.target.value })} placeholder="https://" /></Field>
            <Field label="Telegram link (optional)" htmlFor="t-telegram"><input id="t-telegram" className={inputCls} maxLength={500} value={config.telegram} onChange={(e) => update({ telegram: e.target.value })} placeholder="https://" /></Field>
            <Field label="Discord link (optional)" htmlFor="t-discord"><input id="t-discord" className={inputCls} maxLength={500} value={config.discord} onChange={(e) => update({ discord: e.target.value })} placeholder="https://" /></Field>
            <Field label="GitHub link (optional)" htmlFor="t-github"><input id="t-github" className={inputCls} maxLength={500} value={config.github} onChange={(e) => update({ github: e.target.value })} placeholder="https://" /></Field>
          </div>
        ) : null}

        {step === "supply" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Total supply" htmlFor="t-supply"><input id="t-supply" inputMode="numeric" className={`${inputCls} num`} value={config.totalSupply} onChange={(e) => update({ totalSupply: e.target.value })} /></Field>
            <Field label="Decimals" htmlFor="t-dec" hint="0 to 9."><input id="t-dec" inputMode="numeric" className={`${inputCls} num`} value={config.decimals} onChange={(e) => update({ decimals: e.target.value })} /></Field>
            <Field label="Creator allocation (% of supply)" htmlFor="t-alloc" hint="Shown publicly on the proof page."><input id="t-alloc" inputMode="decimal" className={`${inputCls} num`} value={config.creatorAllocationPercent} onChange={(e) => update({ creatorAllocationPercent: e.target.value })} /></Field>
            <Field label="Creator wallet" htmlFor="t-wallet" hint="Disclosed publicly. Team wallets must be disclosed."><WalletSelect id="t-wallet" value={config.creatorWalletId} wallets={wallet.wallets} ctx={ctx} onChange={(v) => update({ creatorWalletId: v })} /></Field>
          </div>
        ) : null}

        {step === "liquidity" ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Initial liquidity (USDC)" htmlFor="l-usdc"><input id="l-usdc" inputMode="numeric" className={`${inputCls} num`} value={config.liquidityUsdc} onChange={(e) => update({ liquidityUsdc: e.target.value })} /></Field>
            <Field label="Supply paired (% of supply)" htmlFor="l-supply"><input id="l-supply" inputMode="decimal" className={`${inputCls} num`} value={config.liquiditySupplyPercent} onChange={(e) => update({ liquiditySupplyPercent: e.target.value })} /></Field>
            <Field label="Lock (days, 0 = none)" htmlFor="l-lock" hint="Locks are not enforced in this demo."><input id="l-lock" inputMode="numeric" className={`${inputCls} num`} value={config.liquidityLockDays} onChange={(e) => update({ liquidityLockDays: e.target.value })} /></Field>
          </div>
        ) : null}

        {step === "fees" ? (
          <FeeSplitEditor />
        ) : null}

        {step === "charity" ? <CharityConfig charities={charities} /> : null}
        {step === "reserve" ? <ReserveConfig wallets={wallet.wallets} ctx={ctx} /> : null}

        {step === "review" ? (
          <div className="space-y-5">
            {blocked.length > 0 ? (
              <div role="alert" className="rounded-md border border-loss/40 bg-loss/10 p-3 text-xs text-loss">
                <p className="mb-1 font-semibold">Configuration is incomplete.</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {blocked.map((b) => (
                    <li key={`${b.step}-${b.message}`}>{b.message} <button type="button" className="underline" onClick={() => setStep(b.step)}>Fix</button></li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-gain">Client-side checks passed. The server re-validates everything when you save and validate.</p>
            )}
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              {[
                ["Token", `${config.name || "—"} (${config.symbol || "—"})`],
                ["Supply", `${config.totalSupply} · ${config.decimals} decimals`],
                ["Creator wallet", wallet.wallets.find((w) => w.id === effectiveWalletId(config.creatorWalletId, ctx))?.label ?? "—"],
                ["Mint authority", config.mintAuthority === "disabled" ? "Disabled" : "Creator"],
                ["Freeze authority", config.freezeAuthority === "disabled" ? "Disabled" : "Creator"],
                ["Update authority", config.updateAuthority === "creator" ? "Creator" : "Disabled"],
              ].map(([k, v]) => (
                <div key={k}><dt className="eyebrow">{k}</dt><dd className="num mt-0.5">{v}</dd></div>
              ))}
            </dl>
            <div>
              <p className="eyebrow mb-2">CONFIGURED ALLOCATIONS</p>
              <FeeSplitEditor />
            </div>
            <RiskPanel title="RISK INDICATORS" rows={reviewRows(config)} />
            <LaunchLifecyclePanel ctx={ctx} blocked={blocked.length > 0} />
          </div>
        ) : null}

        {step === "deploy" ? (
          <div className="space-y-3">
            {savedLaunch && savedLaunch.status === "READY" && !dirty ? <ReadyBanner /> : (
              <UnavailableState title="NOT READY" message={`Ready for deployment means this exact configuration was validated, reviewed and confirmed. ${savedLaunch ? `The current status is ${savedLaunch.status}${dirty ? " with unsaved changes" : ""}.` : "Nothing has been saved yet."} Go back to Review to continue.`} />
            )}
            <p className="text-xs font-semibold text-warn">{LAUNCH_COPY.deploymentDisabled}</p>
            <p className="text-xs text-muted">No token, mint, liquidity, contract or fee routing is created, and no transaction is sent. Verification and publishing on-chain come in a later release, which will compare the deployed state with this configuration&apos;s fingerprint.</p>
          </div>
        ) : null}

        {errors.length > 0 && step !== "fees" ? (
          <ul role="alert" className="mt-4 list-disc space-y-0.5 rounded-md border border-loss/40 bg-loss/10 p-3 pl-7 text-xs text-loss">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        ) : null}

        <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
          <Button variant="ghost" onClick={prev} disabled={idx === 0}>BACK</Button>
          <Button variant="primary" onClick={next} disabled={!canNext}>
            CONTINUE
          </Button>
        </div>
      </Card>
    </div>
  );
}
