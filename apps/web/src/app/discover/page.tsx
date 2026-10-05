import type { Metadata } from "next";
import { DemoDataBanner } from "@/components/DemoDataBanner";
import { DiscoverClient } from "@/components/DiscoverClient";
import { PageHeader } from "@/components/PageHeader";
import { DEMO_TOKENS } from "@/mock";

export const metadata: Metadata = { title: "Discover" };

export default function DiscoverPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Discover"
        title="Discover"
        subtitle="Ranked by disclosed, checkable data. Every ranking rule is shown. No paid placement and no hype scores."
        actions={<DemoDataBanner variant="chip" />}
      />
      <DiscoverClient tokens={DEMO_TOKENS} />
      <p className="mt-6 text-xs text-faint">All tokens here are fictional demo entries and do not exist on any chain. No social signals are shown.</p>
    </div>
  );
}
