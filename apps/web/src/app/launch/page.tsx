import type { Metadata } from "next";
import { ButtonLink } from "@/components/Button";
import { LaunchWizard } from "@/components/LaunchWizard";
import { PageHeader } from "@/components/PageHeader";
import { DEMO_CHARITIES } from "@/mock";

export const metadata: Metadata = { title: "Launch" };

export default function LaunchPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Launch"
        title="Launch without hiding where the money goes."
        subtitle="Define your fee split. Publish it. Let everyone verify it. Deployment is mock only in this build."
        actions={<ButtonLink href="#wizard" variant="primary">CREATE TOKEN</ButtonLink>}
      />
      <LaunchWizard charities={DEMO_CHARITIES} />
    </div>
  );
}
