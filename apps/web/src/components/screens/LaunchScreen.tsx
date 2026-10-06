"use client";

import type { ReactNode } from "react";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { charityFromApi } from "@/lib/adapters";
import { ButtonLink } from "../Button";
import { ConfigurationWorkbench } from "../ConfigurationWorkbench";
import { LaunchList } from "../LaunchList";
import { LaunchWizard } from "../LaunchWizard";
import { PageHeader } from "../PageHeader";
import { ResourceView } from "../states";

export function LaunchScreen(): ReactNode {
  const charities = useResource("launch-charities", () => api.getCharities());
  return (
    <div>
      <PageHeader
        eyebrow="Launch"
        title="Launch without hiding where the money goes."
        subtitle="Define your fee split. Publish it. Let everyone verify it. This build is PREPARE LAUNCH only: configurations are saved and reviewed, nothing is deployed."
        actions={<ButtonLink href="#wizard" variant="primary">PREPARE LAUNCH</ButtonLink>}
      />
      <ResourceView resource={charities} loadingLabel="Loading charities">
        {(list) => <LaunchWizard charities={list.map(charityFromApi)} />}
      </ResourceView>
      <LaunchList />
    </div>
  );
}

export function LaunchConfigurationScreen(): ReactNode {
  const charities = useResource("launch-charities-config", () => api.getCharities());
  return (
    <div>
      <PageHeader eyebrow="Launch" title="Launch configuration" subtitle="Define exactly where creator fees go. The four shares must total exactly 100% (10,000 basis points). Preparation only: nothing is deployed." />
      <ResourceView resource={charities} loadingLabel="Loading charities">
        {(list) => <ConfigurationWorkbench charities={list.map(charityFromApi)} />}
      </ResourceView>
    </div>
  );
}
