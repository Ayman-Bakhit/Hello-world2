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
        title="Configure a launch without hiding where the money goes."
        subtitle="Configure a launch, review it and mark it ready. This build records configuration only: nothing is deployed, no token or liquidity is created, and no funds move."
        actions={<><ButtonLink href="#wizard" variant="primary">CONFIGURE LAUNCH</ButtonLink><ButtonLink href="/launches" variant="secondary">PUBLIC CONFIGURATIONS</ButtonLink></>}
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
      <PageHeader eyebrow="Launch" title="Launch configuration" subtitle="Where launch fees are configured to go. The split is fixed at 60/15/15/10 in this version and is a validated configuration, not an on-chain rule. Nothing is deployed." />
      <ResourceView resource={charities} loadingLabel="Loading charities">
        {(list) => <ConfigurationWorkbench charities={list.map(charityFromApi)} />}
      </ResourceView>
    </div>
  );
}
