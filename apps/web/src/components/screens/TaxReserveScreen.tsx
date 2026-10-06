"use client";

import { COPY, type TaxReserveResponse } from "@project-name/shared";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api/client";
import { describeApiError, type ApiErrorView } from "@/lib/api/errors";
import { useResource } from "@/lib/api/useResource";
import { formatUsd } from "@/lib/format";
import { useScopedWallet } from "@/lib/useScopedWallet";
import { useWallet } from "@/state/wallet";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Card } from "../Card";
import { DataSourceBadge, DemoDataNotice } from "../DataSource";
import { PageHeader } from "../PageHeader";
import { ApiErrorState, AuthRequired, LoadingState, NoLiveData, ResourceView, UnavailableState } from "../states";
import { TaxReserveCard } from "../TaxReserveCard";
import { WalletPicker } from "./WalletPicker";

const input = "num w-full rounded border border-line-strong bg-canvas px-2.5 py-1.5 text-sm";

/**
 * Reserve TARGET editor. It stores a number in the database through POST /api/tax-reserve/:walletId/target.
 * There is no fund movement anywhere in this screen or in the API behind it.
 */
export function TargetForm({ current, onSave, saving, error }: { current: TaxReserveResponse["target"]; onSave: (req: { targetType: "percentage"; targetPercentage: string } | { targetType: "amount"; targetAmount: string }) => void; saving: boolean; error: ApiErrorView | null }) {
  const [kind, setKind] = useState<"percentage" | "amount">(current?.targetType ?? "percentage");
  const [percent, setPercent] = useState(current?.targetPercentage ?? "30");
  const [amount, setAmount] = useState(current?.targetAmount ?? "10000.00");
  return (
    <Card title="Reserve target" right={<Badge tone="info">STORED, NO FUNDS MOVE</Badge>}>
      <fieldset>
        <legend className="sr-only">Reserve rule</legend>
        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm">
            <input type="radio" name="rule" checked={kind === "percentage"} onChange={() => setKind("percentage")} className="mt-1" />
            <span className="flex-1">Reserve a percentage of realized gains
              <span className="mt-1.5 flex items-center gap-2">
                <input aria-label="Percent of realized gains" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} className={`${input} !w-24`} disabled={kind !== "percentage"} />
                <span className="text-xs text-muted">%</span>
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="radio" name="rule" checked={kind === "amount"} onChange={() => setKind("amount")} className="mt-1" />
            <span className="flex-1">Maintain a fixed target
              <span className="mt-1.5 flex items-center gap-2">
                <span className="text-xs text-muted">$</span>
                <input aria-label="Reserve target in USDC" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${input} !w-32`} disabled={kind !== "amount"} />
              </span>
            </span>
          </label>
        </div>
      </fieldset>
      <Button variant="primary" className="mt-4" disabled={saving} onClick={() => onSave(kind === "percentage" ? { targetType: "percentage", targetPercentage: percent.trim() } : { targetType: "amount", targetAmount: amount.trim() })}>
        {saving ? "SAVING…" : "SAVE TARGET"}
      </Button>
      {error ? <div className="mt-3"><ApiErrorState error={error} /></div> : null}
      <p className="mt-3 text-xs text-faint">Saving changes a number in your account settings. It does not move, convert, or lock any funds, and your wallet is never asked to sign anything here.</p>
    </Card>
  );
}

/** Pure view of the reserve plus the controls. */
export function TaxReserveView({ data, onSave, saving, saveError, savedNotice }: { data: TaxReserveResponse; onSave: Parameters<typeof TargetForm>[0]["onSave"]; saving: boolean; saveError: ApiErrorView | null; savedNotice: boolean }) {
  const exposure = BigInt(data.estimatedTaxExposureCents);
  return (
    <div className="space-y-4">
      <DemoDataNotice dataSource={data.reserveDataSource} message="The reserve balance and exposure are fictional demo numbers. The target below is a saved setting only; no funds are involved." />
      <TaxReserveCard reserveCents={BigInt(data.currentReserveCents)} exposureCents={exposure} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Move funds" right={<Badge tone="neutral">UNAVAILABLE</Badge>}>
          <div className="flex flex-wrap gap-2">
            <Button disabled title="Not available yet">ADD FUNDS</Button>
            <Button disabled title="Not available yet">WITHDRAW</Button>
          </div>
          <div className="mt-3"><UnavailableState compact message="Funding or withdrawing a reserve from this app is not built. No transaction can be created or signed here." /></div>
          <p className="mt-3 text-xs text-faint">The reserve is designed to be a user-controlled account. The platform will never hold it or move it for you.</p>
        </Card>
        <TargetForm key={data.target?.updatedAt ?? "none"} current={data.target} onSave={onSave} saving={saving} error={saveError} />
      </div>
      <Card title="Current target" right={<DataSourceBadge dataSource={data.targetDataSource} />}>
        {data.target ? (
          <p className="text-sm">
            {data.target.targetType === "percentage" ? `${data.target.targetPercentage}% of realized gains` : `${data.target.targetAmount} ${data.currency} fixed`}
            {data.resolvedTargetCents ? <span className="ml-2 num text-muted">= {formatUsd(BigInt(data.resolvedTargetCents))}</span> : null}
          </p>
        ) : (
          <p className="text-sm text-muted">No target set yet.</p>
        )}
        {savedNotice ? <p role="status" className="mt-2 text-xs text-gain">Target saved.</p> : null}
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-faint">{data.disclaimer.map((d) => <li key={d}>{d}</li>)}</ul>
        <p className="mt-2 text-xs text-faint">{COPY.taxPlanning}s are not tax advice.</p>
      </Card>
    </div>
  );
}

function Body({ walletId, wallets, onSelect }: { walletId: string; wallets: Parameters<typeof WalletPicker>[0]["wallets"]; onSelect: (id: string) => void }) {
  const w = useWallet();
  const res = useResource(`reserve-screen:${walletId}`, () => api.getTaxReserve(walletId), () => void w.refreshSession());
  const [latest, setLatest] = useState<TaxReserveResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiErrorView | null>(null);
  const [saved, setSaved] = useState(false);

  const save: Parameters<typeof TargetForm>[0]["onSave"] = (req) => {
    setSaving(true); setSaveError(null); setSaved(false);
    api.setTaxReserveTarget(walletId, req).then(
      (r) => { setLatest(r); setSaved(true); setSaving(false); },
      (e: unknown) => {
        const v = describeApiError(e);
        setSaveError(v); setSaving(false);
        if (v.kind === "unauthenticated") void w.refreshSession();
      },
    );
  };

  return (
    <>
      <WalletPicker wallets={wallets} selectedId={walletId} onSelect={onSelect} />
      <ResourceView resource={res} loadingLabel="Loading tax reserve" noData={<NoLiveData title="NO LIVE TAX RESERVE DATA YET" message="Your wallet is authenticated, but no live reserve or tax data exists yet. Tax estimation for real wallets is not available, and nothing here moves funds." />}>
        {(d) => <TaxReserveView data={latest ?? d} onSave={save} saving={saving} saveError={saveError} savedNotice={saved} />}
      </ResourceView>
    </>
  );
}

export function TaxReserveScreen(): ReactNode {
  const scope = useScopedWallet();
  return (
    <div>
      <PageHeader eyebrow="Tax" title="TAX RESERVE" subtitle="A voluntary, user-controlled USDC reserve set against your estimated tax exposure." />
      {scope.gate === "checking" ? <LoadingState label="Checking session" /> : null}
      {scope.gate === "unauthenticated" ? <AuthRequired /> : null}
      {scope.gate === "ready" ? (
        <ResourceView resource={scope.walletsState} loadingLabel="Loading wallets">
          {() => scope.wallet ? <Body key={scope.wallet.id} walletId={scope.wallet.id} wallets={scope.wallets} onSelect={scope.select} /> : <NoLiveData title="NO WALLETS" message="No wallets are linked to this account." />}
        </ResourceView>
      ) : null}
    </div>
  );
}
