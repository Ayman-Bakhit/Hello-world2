"use client";

import { COPY, type SetTaxReserveTargetRequest, type TaxReserveResponse } from "@project-name/shared";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api/client";
import { describeApiError, type ApiErrorView } from "@/lib/api/errors";
import { useResource } from "@/lib/api/useResource";
import type { TaxQueryParams } from "@/lib/taxQuery";
import { useScopedWallet } from "@/lib/useScopedWallet";
import { TaxInputsForm } from "../TaxParts";
import { useWallet } from "@/state/wallet";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Card } from "../Card";
import { DemoDataNotice } from "../DataSource";
import { PageHeader } from "../PageHeader";
import { AuthRequired, LoadingState, NoLiveData, ResourceView, UnavailableState } from "../states";
import { ReserveFigures, ReserveStatusBanner, TargetEditor } from "../TaxReservePanels";
import { WalletPicker } from "./WalletPicker";

/** Pure view of the reserve plus the controls. */
export function TaxReserveView({ data, onSave, saving, saveError, savedNotice }: { data: TaxReserveResponse; onSave: (req: SetTaxReserveTargetRequest) => void; saving: boolean; saveError: ApiErrorView | null; savedNotice: boolean }) {
  return (
    <div className="space-y-4">
      <DemoDataNotice dataSource={data.dataSource} message="The tax estimate and the reserve balance are fictional demo numbers. The target below is a saved setting only; no funds are involved." />
      <ReserveStatusBanner data={data} />
      <ReserveFigures data={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Reserve funding" right={<Badge tone="neutral">NOT ENABLED</Badge>}>
          <div className="flex flex-wrap gap-2">
            <Button disabled title="Not available yet">ADD FUNDS</Button>
            <Button disabled title="Not available yet">WITHDRAW</Button>
          </div>
          <p className="mt-3 text-sm font-semibold text-warn">{data.funding.message}</p>
          <div className="mt-2"><UnavailableState compact message="No transaction can be created or signed here. The reserve balance will only ever come from independently verifiable transaction data." /></div>
        </Card>
        <TargetEditor key={`${data.userTarget.updatedAt ?? "none"}:${data.userTarget.enabled}`} data={data} onSave={onSave} saving={saving} error={saveError} />
      </div>
      {savedNotice ? <p role="status" className="text-xs text-gain">Target saved. This is a setting only.</p> : null}
      <Card title="About this page">
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-faint">{data.disclaimer.map((d) => <li key={d}>{d}</li>)}</ul>
        <p className="mt-2 text-xs text-faint">{COPY.taxPlanning}s are not tax advice. Consult a tax professional.</p>
      </Card>
    </div>
  );
}

function Body({ walletId, wallets, onSelect }: { walletId: string; wallets: Parameters<typeof WalletPicker>[0]["wallets"]; onSelect: (id: string) => void }) {
  const w = useWallet();
  const [q, setQ] = useState<TaxQueryParams>({});
  const [rev, setRev] = useState(0);
  const res = useResource(`reserve-screen:${walletId}:${JSON.stringify(q)}:${rev}`, () => api.calculateTaxReserve(walletId, q), () => void w.refreshSession());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiErrorView | null>(null);
  const [saved, setSaved] = useState(false);

  const save = (req: SetTaxReserveTargetRequest) => {
    setSaving(true); setSaveError(null); setSaved(false);
    api.setTaxReserveTarget(walletId, req).then(
      // re-run the calculation with the rates already entered: the save response itself carries no rates
      () => { setSaved(true); setSaving(false); setRev((n) => n + 1); },
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
      <ResourceView resource={res} loadingLabel="Loading tax reserve" noData={<NoLiveData title="NO LIVE TAX RESERVE DATA YET" message="Your wallet is authenticated, but no reserve or tax data is available for it yet. Nothing here moves funds." />}>
        {(d) => (
          <>
            <TaxReserveView data={d} onSave={save} saving={saving} saveError={saveError} savedNotice={saved} />
            {d.dataSource === "chain" ? <div className="mt-4"><TaxInputsForm onApply={(x) => { setSaved(false); setQ(x); }} showMethod={false} /></div> : null}
          </>
        )}
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
