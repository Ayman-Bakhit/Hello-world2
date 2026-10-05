"use client";

import { COPY } from "@project-name/shared";
import { effectiveWalletId, type StepContext } from "@/lib/launch";
import { shortAddress } from "@/lib/format";
import type { Charity, Wallet } from "@/lib/types";
import { useLaunch } from "@/state/launch";
import { Badge } from "./Badge";

export const inputCls = "w-full rounded border border-line-strong bg-canvas px-2.5 py-2 text-sm placeholder:text-faint";

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="eyebrow">{label}</label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1 text-[11px] text-faint">{hint}</p> : null}
    </div>
  );
}

export function WalletSelect({ id, value, wallets, ctx, onChange }: { id: string; value: string; wallets: Wallet[]; ctx: StepContext; onChange: (v: string) => void }) {
  return (
    <select id={id} className={inputCls} value={effectiveWalletId(value, ctx)} onChange={(e) => onChange(e.target.value)} disabled={wallets.length === 0}>
      {wallets.length === 0 ? <option value="">No wallet connected</option> : null}
      {wallets.map((w) => (
        <option key={w.id} value={w.id}>{w.label} · {shortAddress(w.address)}</option>
      ))}
    </select>
  );
}

export function CharityConfig({ charities }: { charities: Charity[] }) {
  const { config, update } = useLaunch();
  const verified = charities.filter((c) => c.verification === "verified");
  const selected = charities.find((c) => c.id === config.charityId);
  return (
    <div className="space-y-3">
      <Field label="Verified charity" htmlFor="charity-select" hint="Only admin-verified charities can receive fee routing. Unverified wallets are never selectable.">
        <select id="charity-select" className={inputCls} value={config.charityId} onChange={(e) => update({ charityId: e.target.value })}>
          {verified.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      {selected ? (
        <div className="rounded-md border border-line bg-surface-2/40 p-3 text-xs text-muted">
          <p className="font-semibold text-fg">{selected.name}</p>
          <p>{selected.category} · {selected.country}</p>
          <p className="mt-1 text-faint">Destination wallet: shown from the registry once it exists. <Badge tone="demo">DEMO</Badge></p>
        </div>
      ) : null}
      <p className="text-[11px] text-faint">{COPY.donation}</p>
    </div>
  );
}

export function ReserveConfig({ wallets, ctx }: { wallets: Wallet[]; ctx: StepContext }) {
  const { config, update } = useLaunch();
  return (
    <div className="space-y-3">
      <Field label="Tax reserve destination" htmlFor="reserve-select" hint="V1 simplification: the reserve share goes to an address you control and disclose publicly. It is not an automated vault, and the platform has no authority over it.">
        <WalletSelect id="reserve-select" value={config.reserveWalletId} wallets={wallets} ctx={ctx} onChange={(v) => update({ reserveWalletId: v })} />
      </Field>
      <p className="text-[11px] text-faint">Creator fees are income, not automatically deductible. The reserve is a planning tool, not a tax payment.</p>
    </div>
  );
}
