"use client";

import type { Wallet } from "@project-name/shared";
import { shortAddress } from "@/lib/format";

/** Shown only when the account has more than one wallet (the demo account has three). */
export function WalletPicker({ wallets, selectedId, onSelect }: { wallets: Wallet[]; selectedId: string | undefined; onSelect: (id: string) => void }) {
  if (wallets.length < 2) return null;
  return (
    <div className="mb-4 flex items-center gap-2">
      <label htmlFor="wallet-picker" className="eyebrow">Wallet</label>
      <select id="wallet-picker" value={selectedId} onChange={(e) => onSelect(e.target.value)} className="rounded border border-line-strong bg-canvas px-2 py-1 text-xs">
        {wallets.map((w) => <option key={w.id} value={w.id}>{w.label ?? "Wallet"} · {shortAddress(w.address)}</option>)}
      </select>
    </div>
  );
}
