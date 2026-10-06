"use client";

import Link from "next/link";
import { useState } from "react";
import { shortAddress } from "@/lib/format";
import { useWallet } from "@/state/wallet";
import { Badge } from "./Badge";
import { Button } from "./Button";

export function WalletMenu() {
  const w = useWallet();
  const [open, setOpen] = useState(false);

  // Nothing connected and nobody authenticated.
  if (!w.connected && !w.authenticated) {
    return <Button variant="primary" onClick={w.openModal}>CONNECT WALLET</Button>;
  }

  const real = w.mode === "api";
  const label = real ? (w.authenticated ? "AUTHENTICATED" : "CONNECTED") : "DEMO";
  const shownAddress = (real ? (w.authenticatedAddress ?? w.address) : w.wallets[0]?.address) ?? "";
  const dot = real && w.authenticated ? "bg-gain" : "bg-warn";
  const close = () => setOpen(false);
  const item = "block w-full rounded px-2 py-1.5 text-left text-xs font-semibold tracking-wider text-muted hover:bg-surface-2 hover:text-fg";

  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-xs hover:border-muted/60">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="num font-mono">{shortAddress(shownAddress)}</span>
        <span className={`hidden text-[10px] font-semibold tracking-wider sm:inline ${real && w.authenticated ? "text-gain" : "text-warn"}`}>{label}</span>
      </button>
      {open ? (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-30 cursor-default" onClick={close} />
          <div role="menu" className="rise absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line-strong bg-surface p-3 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="eyebrow">Connected wallets</p>
              {real ? <Badge tone={w.authenticated ? "good" : "demo"}>{label}</Badge> : <Badge tone="demo">DEMO · NOT AUTHENTICATED</Badge>}
            </div>

            {real && !w.authenticated ? (
              <div className="rounded-md border border-warn/30 bg-warn/[0.07] p-2 text-xs text-warn">
                Connected is not authenticated. Sign a message to prove you own this wallet.
                <Button variant="primary" className="mt-2 w-full" onClick={() => { w.openModal(); close(); }}>SIGN IN WITH WALLET</Button>
              </div>
            ) : null}
            {real && w.addressMismatch ? (
              <p role="alert" className="mt-2 rounded border border-loss/40 bg-loss/10 p-2 text-xs text-loss">
                The connected wallet differs from the authenticated one. Log out and sign in again to switch.
              </p>
            ) : null}

            <ul className="mt-2 space-y-2">
              {(real ? (w.address ? [{ id: "connected", address: w.address, label: w.walletName ?? "Wallet" }] : []) : w.wallets).map((wallet, i) => (
                <li key={wallet.id} className="rounded-md border border-line p-2">
                  <p className="text-[11px] text-faint">Connected Wallet {i + 1}</p>
                  <p className="num font-mono text-xs text-muted">{shortAddress(wallet.address)}</p>
                  {real ? (
                    <p className="mt-1 text-xs text-muted">{wallet.label}</p>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-2">
                      <label className="sr-only" htmlFor={`label-${wallet.id}`}>Wallet label</label>
                      <input id={`label-${wallet.id}`} value={wallet.label} maxLength={24} onChange={(e) => w.labelWallet(wallet.id, e.target.value)} className="min-w-0 flex-1 rounded border border-line-strong bg-canvas px-2 py-1 text-xs" />
                      <button type="button" onClick={() => w.removeWallet(wallet.id)} className="text-[11px] font-semibold tracking-wider text-loss hover:underline">REMOVE</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {real ? (
              <p className="mt-2 text-[11px] text-faint">Adding wallets and labels needs wallet-linking endpoints that do not exist yet. Sign in with another wallet to use a separate account.</p>
            ) : (
              <Button className="mt-2 w-full" onClick={w.addWallet} disabled={!w.canAddWallet}>ADD WALLET</Button>
            )}

            <div className="mt-3 border-t border-line pt-2">
              <span className={`${item} cursor-not-allowed opacity-50`} aria-disabled>SETTINGS · soon</span>
              <Link href="/trust#security" onClick={close} className={item}>SECURITY</Link>
              <Link href="/trust#privacy" onClick={close} className={item}>PRIVACY</Link>
              <Link href="/documents" onClick={close} className={item}>EXPORT DATA</Link>
              <button type="button" onClick={() => { w.disconnect(); close(); }} className={`${item} text-loss hover:text-loss`}>
                {real ? "LOG OUT & DISCONNECT" : "DISCONNECT"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
