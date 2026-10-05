import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { TaxReserveCard } from "@/components/TaxReserveCard";
import { TaxReserveControls } from "@/components/TaxReserveControls";
import { DEMO_TAX_ESTIMATE as E, DEMO_TAX_RESERVE as R } from "@/mock";

export const metadata: Metadata = { title: "Tax Reserve" };

export default function TaxReservePage() {
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Tax" title="TAX RESERVE" subtitle="A voluntary, user-controlled USDC reserve set against your estimated tax exposure." />
      <TaxReserveCard reserveCents={R.reserveCents} exposureCents={E.exposureCents} />
      <TaxReserveControls
        reserveCents={R.reserveCents}
        exposureCents={E.exposureCents}
        realizedNetGainsCents={E.realizedGainsCents - E.realizedLossesCents}
        vaultLabel={R.vaultLabel}
        initialRule={R.rule}
      />
    </div>
  );
}
