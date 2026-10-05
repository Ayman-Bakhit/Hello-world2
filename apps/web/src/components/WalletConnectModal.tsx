"use client";

import { useWallet } from "@/state/wallet";
import type { WalletProviderId } from "@/lib/types";
import { Badge } from "./Badge";

const OPTIONS: Array<{ id: WalletProviderId; name: string; note: string }> = [
  { id: "phantom", name: "Phantom", note: "Solana" },
  { id: "solflare", name: "Solflare", note: "Solana" },
  { id: "backpack", name: "Backpack", note: "Solana" },
];

/** Shared by the modal and the /connect page. */
export function WalletConnectPanel({ onDone }: { onDone?: () => void }) {
  const { connect, connected } = useWallet();
  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Badge tone="demo">DEMO CONNECTION</Badge>
        <span className="text-xs text-muted">No wallet extension is contacted.</span>
      </div>
      <ul className="space-y-2">
        {OPTIONS.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => {
                connect(o.id);
                onDone?.();
              }}
              className="flex w-full items-center justify-between rounded-md border border-line-strong bg-surface-2 px-4 py-3 text-left transition-colors hover:border-accent/60"
            >
              <span>
                <span className="block text-sm font-semibold">{o.name}</span>
                <span className="block text-xs text-muted">{o.note} · mock connection</span>
              </span>
              <span className="text-xs font-semibold tracking-wider text-accent">{connected ? "RECONNECT" : "CONNECT"}</span>
            </button>
          </li>
        ))}
      </ul>
      <ul className="mt-5 space-y-1.5 text-xs text-muted">
        <li>Your keys stay yours.</li>
        <li>Your transactions stay verifiable.</li>
        <li>We don&apos;t ask for seed phrases or private keys. Never enter them anywhere.</li>
      </ul>
      <p className="mt-4 text-[11px] text-faint">
        Real connection (Wallet Standard, signed nonce, server-verified) is planned for Slice 2. Other Wallet Standard
        wallets will appear here then.
      </p>
    </div>
  );
}

export function WalletConnectModal() {
  const { modalOpen, closeModal } = useWallet();
  if (!modalOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") closeModal();
      }}
    >
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={closeModal} />
      <div role="dialog" aria-modal="true" aria-labelledby="wc-title" className="rise relative w-full max-w-md rounded-xl border border-line-strong bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="wc-title" className="text-base font-semibold">Connect wallet</h2>
          <button type="button" onClick={closeModal} className="text-xs text-muted hover:text-fg" autoFocus>
            ESC
          </button>
        </div>
        <WalletConnectPanel />
      </div>
    </div>
  );
}
