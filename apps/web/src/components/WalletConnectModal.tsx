"use client";

import { SIGN_IN_WALLET_NOTICE } from "@project-name/shared";
import { CANONICAL_WALLETS } from "@/lib/walletStandard";
import { shortAddress } from "@/lib/format";
import type { WalletProviderId } from "@/lib/types";
import { useWallet } from "@/state/wallet";
import { Badge } from "./Badge";
import { Button } from "./Button";

const MOCK_OPTIONS: Array<{ id: WalletProviderId; name: string }> = CANONICAL_WALLETS.map((c) => ({ id: c.id, name: c.name }));

/** Step indicator: makes CONNECTED and AUTHENTICATED visibly different things. */
function Steps({ step }: { step: 1 | 2 | 3 }) {
  const items = ["Choose wallet", "Sign message", "Authenticated"];
  return (
    <ol className="mb-4 flex items-center gap-2 text-[11px] font-semibold tracking-wide" aria-label="Sign-in steps">
      {items.map((t, i) => (
        <li key={t} aria-current={step === i + 1 ? "step" : undefined} className={step >= i + 1 ? "text-accent" : "text-faint"}>
          {i + 1}. {t}{i < 2 ? <span className="mx-1 text-faint">›</span> : null}
        </li>
      ))}
    </ol>
  );
}

function MockPanel({ onDone }: { onDone?: () => void }) {
  const { connect } = useWallet();
  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Badge tone="demo">DEMO CONNECTION</Badge>
        <span className="text-xs text-muted">No wallet extension is contacted. Not authenticated.</span>
      </div>
      <ul className="space-y-2">
        {MOCK_OPTIONS.map((o) => (
          <li key={o.id}>
            <button type="button" onClick={() => { connect(o.id); onDone?.(); }} className="flex w-full items-center justify-between rounded-md border border-line-strong bg-surface-2 px-4 py-3 text-left transition-colors hover:border-accent/60">
              <span><span className="block text-sm font-semibold">{o.name}</span><span className="block text-xs text-muted">mock connection</span></span>
              <span className="text-xs font-semibold tracking-wider text-accent">CONNECT</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] text-faint">Real wallet sign-in is enabled with NEXT_PUBLIC_API_MODE=api (see docs/FRONTEND.md).</p>
    </div>
  );
}

function ChooseWallet() {
  const { detected, connect, status, error } = useWallet();
  const connecting = status === "connecting";
  const canonical = CANONICAL_WALLETS.map((c) => ({ ...c, found: detected.find((d) => d.canonicalId === c.id) }));
  const others = detected.filter((d) => d.canonicalId === null);
  return (
    <div>
      <ul className="space-y-2">
        {canonical.map((c) => (
          <li key={c.id}>
            {c.found ? (
              <button type="button" disabled={connecting} onClick={() => connect(c.found!.name)} className="flex w-full items-center justify-between rounded-md border border-line-strong bg-surface-2 px-4 py-3 text-left transition-colors hover:border-accent/60 disabled:opacity-50">
                <span><span className="block text-sm font-semibold">{c.name}</span><span className="block text-xs text-gain">Detected</span></span>
                <span className="text-xs font-semibold tracking-wider text-accent">{connecting ? "CONNECTING…" : "CONNECT"}</span>
              </button>
            ) : (
              <div className="flex w-full items-center justify-between rounded-md border border-line px-4 py-3">
                <span><span className="block text-sm font-semibold text-muted">{c.name}</span><span className="block text-xs text-faint">Not detected in this browser</span></span>
                <a href={c.installUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold tracking-wider text-muted underline underline-offset-2 hover:text-fg">INSTALL</a>
              </div>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 ? (
        <>
          <p className="eyebrow mb-2 mt-4">Other Wallet Standard wallets</p>
          <ul className="space-y-2">
            {others.map((o) => (
              <li key={o.name}>
                <button type="button" disabled={connecting} onClick={() => connect(o.name)} className="flex w-full items-center justify-between rounded-md border border-line-strong bg-surface-2 px-4 py-3 text-left hover:border-accent/60 disabled:opacity-50">
                  <span className="text-sm font-semibold">{o.name}</span>
                  <span className="text-xs font-semibold tracking-wider text-accent">CONNECT</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {error ? <p role="alert" className="mt-3 rounded border border-loss/40 bg-loss/10 p-2 text-xs text-loss">{error}</p> : null}
    </div>
  );
}

function SignStep() {
  const { address, walletName, status, challenge, error, signIn, signOut } = useWallet();
  const signing = status === "signing";
  return (
    <div>
      <div className="rounded-md border border-warn/30 bg-warn/[0.07] p-3">
        <div className="flex items-center gap-2"><Badge tone="demo">CONNECTED</Badge><span className="text-xs text-warn">Not authenticated yet</span></div>
        <p className="num mt-2 font-mono text-xs text-muted">{walletName} · {address ? shortAddress(address) : ""}</p>
        <p className="mt-2 text-xs text-muted">A wallet connection alone is not proof that you own this wallet. Signing a message is.</p>
      </div>
      <p className="mt-4 text-sm">{SIGN_IN_WALLET_NOTICE}</p>
      <p className="mt-1 text-xs text-faint">We never ask for your seed phrase or private key. This signature cannot be submitted to any chain.</p>
      {challenge ? (
        <div className="mt-3">
          <p className="eyebrow mb-1">Message to sign</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-line bg-canvas p-2 font-mono text-[11px] text-muted">{challenge.message}</pre>
          <p className="mt-2 text-xs text-accent" aria-live="polite">Check your wallet to approve the signature request.</p>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-3 rounded border border-loss/40 bg-loss/10 p-2 text-xs text-loss">{error}</p> : null}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={() => void signIn()} disabled={signing}>{signing ? "WAITING FOR WALLET…" : "SIGN MESSAGE"}</Button>
        <Button variant="ghost" onClick={() => void signOut()} disabled={signing}>USE ANOTHER WALLET</Button>
      </div>
    </div>
  );
}

/** Shared by the modal and the /connect page. */
export function WalletConnectPanel({ onDone }: { onDone?: () => void }) {
  const { mode, status, authenticated, authenticatedAddress, signOut } = useWallet();
  if (mode === "mock") return <MockPanel {...(onDone ? { onDone } : {})} />;
  const step: 1 | 2 | 3 = authenticated ? 3 : status === "disconnected" || status === "connecting" ? 1 : 2;
  return (
    <div>
      <Steps step={step} />
      {step === 1 ? <ChooseWallet /> : null}
      {step === 2 ? <SignStep /> : null}
      {step === 3 ? (
        <div>
          <div className="flex items-center gap-2"><Badge tone="good">AUTHENTICATED</Badge></div>
          <p className="num mt-2 font-mono text-xs text-muted">{authenticatedAddress ? shortAddress(authenticatedAddress) : ""}</p>
          <p className="mt-2 text-xs text-muted">The server verified your signature. Your session is held in an HttpOnly cookie that this page cannot read.</p>
          <Button className="mt-4" onClick={() => void signOut()}>LOG OUT</Button>
        </div>
      ) : null}
      <ul className="mt-5 space-y-1.5 text-xs text-muted">
        <li>Your keys stay yours.</li>
        <li>Your transactions stay verifiable.</li>
        <li>We don&apos;t ask for seed phrases or private keys. Never enter them anywhere.</li>
      </ul>
    </div>
  );
}

export function WalletConnectModal() {
  const { modalOpen, closeModal } = useWallet();
  if (!modalOpen) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onKeyDown={(e) => { if (e.key === "Escape") closeModal(); }}>
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={closeModal} />
      <div role="dialog" aria-modal="true" aria-labelledby="wc-title" className="rise relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-line-strong bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="wc-title" className="text-base font-semibold">Connect wallet</h2>
          <button type="button" onClick={closeModal} className="text-xs text-muted hover:text-fg" autoFocus>ESC</button>
        </div>
        <WalletConnectPanel />
      </div>
    </div>
  );
}
