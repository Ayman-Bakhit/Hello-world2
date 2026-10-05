import type { Metadata } from "next";
import { ConfigurationWorkbench } from "@/components/ConfigurationWorkbench";
import { PageHeader } from "@/components/PageHeader";
import { DEMO_CHARITIES } from "@/mock";

export const metadata: Metadata = { title: "Launch configuration" };

export default function LaunchConfigurationPage() {
  return (
    <div>
      <PageHeader eyebrow="Launch" title="Launch configuration" subtitle="Define exactly where creator fees go. The four shares must total exactly 100% (10,000 basis points)." />
      <ConfigurationWorkbench charities={DEMO_CHARITIES} />
    </div>
  );
}
