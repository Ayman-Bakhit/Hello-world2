import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { WalletConnectPanel } from "@/components/WalletConnectModal";
import { Card } from "@/components/Card";

export const metadata: Metadata = { title: "Connect wallet" };

export default function ConnectPage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader eyebrow="Wallet" title="Connect wallet" subtitle="Non-custodial. Your wallet signs; we never hold keys." />
      <Card><WalletConnectPanel /></Card>
    </div>
  );
}
