"use client";

import Link from "next/link";
import { useState } from "react";
import { FEE_BUCKETS, percentToBps } from "@project-name/shared";
import { cn } from "@/lib/cn";
import { BUCKET_COLOR, BUCKET_LABEL, parseFeeDrafts } from "@/lib/feeDrafts";
import { formatPercentBps } from "@/lib/format";
import { allErrors, effectiveWalletId, LAUNCH_STEPS, stepErrors, type LaunchStepId, type StepContext } from "@/lib/launch";
import { TRANSPARENCY_CHECKS, type Charity } from "@/lib/types";
import { useLaunch } from "@/state/launch";
import { useWallet } from "@/state/wallet";
import { AllocationBar } from "./AllocationBar";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { FeeSplitEditor } from "./FeeSplitEditor";
import { CharityConfig, Field, inputCls, ReserveConfig, WalletSelect } from "./LaunchParts";
import { RiskPanel, type Row } from "./RiskPanel";

const IDS = LAUNCH_STEPS.map((s) => s.id);

export function useStepContext(charities: Charity[]): StepContext {
  const { connected, wallets } = useWallet();
  return {
    walletConnected: connected,
    verifiedCharityIds: charities.filter((c) => c.verification === "verified").map((c) => c.id),
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
  const { config, update, setFeeDraft, step, setStep, mockDeployed, setMockDeployed } = useLaunch();
  const wallet = useWallet();
  const ctx = useStepContext(charities);
  const [published, setPublished] = useState(false);

  const idx = IDS.indexOf(step);
  const firstInvalid = IDS.slice(0, IDS.indexOf("review")).findIndex((id) => stepErrors(id, config, ctx).length > 0);
  const maxIdx = firstInvalid >= 0 ? firstInvalid : mockDeployed ? IDS.length - 1 : IDS.indexOf("deploy");
  const errors = stepErrors(step, config, ctx);
  const blocked = allErrors(config, ctx);
  const canNext = errors.length === 0 && idx < IDS.length - 1 && !(step === "deploy" && !mockDeployed);
  const go = (to: LaunchStepId) => { if (IDS.indexOf(to) <= maxIdx) setStep(to); };
  const next = () => { const n = IDS[idx + 1]; if (n) setStep(n); };
  const prev = () => { const p = IDS[idx - 1]; if (p) setStep(p); };

  const feeResult = parseFeeDrafts(config.feeDrafts);

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

      <Card title={`Step ${idx + 1} of ${IDS.length} · ${LAUNCH_STEPS[idx]?.title}`} right={<Badge tone="demo">MOCK ONLY</Badge>}>
        {step === "connect" ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted">The creator wallet signs launch transactions. In this build the connection is a demo and nothing is signed.</p>
            {wallet.connected ? (
              <p className="text-gain">Demo wallet connected: {wallet.wallets.map((w) => w.label).join(", ")}</p>
            ) : (
              <Button variant="primary" onClick={wallet.openModal}>CONNECT WALLET</Button>
            )}
          </div>
        ) : null}

        {step === "create" ? (
          <div className="space-y-4 text-sm">
            <p className="text-muted">Chain: Solana. Tokens will use standard SPL Token / Token-2022 created through audited libraries. No custom token logic.</p>
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
              <Field label="Image" htmlFor="t-image" hint="Demo: the file is not uploaded or stored; only its name is kept in this tab.">
                <input id="t-image" type="file" accept="image/png,image/jpeg,image/webp" className="text-xs text-muted" onChange={(e) => update({ imageName: e.target.files?.[0]?.name ?? "" })} />
              </Field>
            </div>
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
          <FeeSplitEditor drafts={config.feeDrafts} onChange={setFeeDraft} />
        ) : null}

        {step === "charity" ? <CharityConfig charities={charities} /> : null}
        {step === "reserve" ? <ReserveConfig wallets={wallet.wallets} ctx={ctx} /> : null}

        {step === "review" ? (
          <div className="space-y-5">
            {blocked.length > 0 ? (
              <div role="alert" className="rounded-md border border-loss/40 bg-loss/10 p-3 text-xs text-loss">
                <p className="mb-1 font-semibold">Configuration is incomplete. Deployment is blocked.</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {blocked.map((b) => (
                    <li key={`${b.step}-${b.message}`}>{b.message} <button type="button" className="underline" onClick={() => setStep(b.step)}>Fix</button></li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-gain">All checks passed for this demo configuration.</p>
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
              <p className="eyebrow mb-2">WHERE THE MONEY GOES</p>
              <AllocationBar segments={FEE_BUCKETS.map((b) => ({ label: BUCKET_LABEL[b], bps: feeResult.split?.[b] ?? 0, colorClass: BUCKET_COLOR[b] }))} />
              <ul className="mt-2 text-sm">
                {FEE_BUCKETS.map((b) => (
                  <li key={b} className="flex justify-between py-0.5"><span className="text-muted">{BUCKET_LABEL[b]}</span><span className="num">{feeResult.split ? formatPercentBps(feeResult.split[b], { digits: 2 }) : "—"}</span></li>
                ))}
                <li className="flex justify-between border-t border-line pt-1 font-semibold"><span>Total</span><span className="num">{feeResult.totalBps === null ? "—" : formatPercentBps(feeResult.totalBps, { digits: 2 })}</span></li>
              </ul>
              <p className="mt-2 text-xs text-warn">DEMO CONFIGURATION — ON-CHAIN ENFORCEMENT NOT IMPLEMENTED. Split mutability is undetermined because no contract exists.</p>
            </div>
            <RiskPanel title="RISK INDICATORS" rows={reviewRows(config)} />
          </div>
        ) : null}

        {step === "deploy" ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted">Mock deploy only. No transaction is built, signed, or sent, and no contract is created.</p>
            <Button variant="primary" onClick={() => setMockDeployed(true)} disabled={blocked.length > 0}>RUN MOCK DEPLOY</Button>
            {mockDeployed ? (
              <dl className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-4">
                {[["Network", "None"], ["Transaction", "None"], ["Contract", "None"], ["Cost", "$0.00"]].map(([k, v]) => (
                  <div key={k}><dt className="eyebrow">{k}</dt><dd className="mt-0.5">{v}</dd></div>
                ))}
              </dl>
            ) : null}
          </div>
        ) : null}

        {step === "verify" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">After a real deployment, each check below is read from the chain, not typed by the creator. None can run yet.</p>
            <ul className="divide-y divide-line rounded-md border border-line">
              {TRANSPARENCY_CHECKS.map(([k, label]) => (
                <li key={k} className="flex items-center justify-between px-3 py-2 text-sm">{label}<Badge tone="neutral">NOT CONNECTED</Badge></li>
              ))}
            </ul>
          </div>
        ) : null}

        {step === "publish" ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted">Publishing creates a public proof page. See a sample page for a fictional token:</p>
            <Link href="/token/demo" className="text-accent underline underline-offset-2">/token/demo (sample, not your token)</Link>
            <div><Button variant="primary" onClick={() => setPublished(true)}>PUBLISH (DEMO)</Button></div>
            {published ? <p className="text-warn">Nothing was published. This is a demo; no page, token, or contract was created.</p> : null}
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
            {step === "review" ? "CONTINUE TO MOCK DEPLOY" : "CONTINUE"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
