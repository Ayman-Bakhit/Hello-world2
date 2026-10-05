import type { Metadata } from "next";
import { DemoDataBanner } from "@/components/DemoDataBanner";
import { GiveClient } from "@/components/GiveClient";
import { PageHeader } from "@/components/PageHeader";
import { DEMO_CHARITIES, DEMO_DONATIONS, DEMO_GIVING_RULES, DEMO_TAX_ESTIMATE as E } from "@/mock";

export const metadata: Metadata = { title: "Give" };

export default function GivePage() {
  return (
    <div>
      <PageHeader
        eyebrow="Give"
        title="Turn part of your crypto activity into measurable impact."
        subtitle="Donate transparently and keep a permanent record of your contributions."
        actions={<DemoDataBanner variant="chip" />}
      />
      <GiveClient charities={DEMO_CHARITIES} donations={DEMO_DONATIONS} realizedNetGainsCents={E.realizedGainsCents - E.realizedLossesCents} rules={DEMO_GIVING_RULES} />
    </div>
  );
}
