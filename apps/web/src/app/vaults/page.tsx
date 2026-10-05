import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "Vaults" };

export default function VaultsPage() {
  return (
    <div>
      <PageHeader eyebrow="Vaults" title="Vaults" subtitle="Every vault address, balance, and movement, publicly inspectable." />
      <EmptyState
        title="Vault overview is not built yet"
        description="Each vault will show balance, address, purpose, incoming and outgoing flows, and last activity, read from the chain. See Tax Reserve for the demo reserve flow."
        items={["TAX · user-controlled reserve", "CHARITY · verified charity wallets", "PROTOCOL · public treasury", "CREATOR · disclosed creator wallets", "LIQUIDITY · pool and lock status"]}
      />
    </div>
  );
}
