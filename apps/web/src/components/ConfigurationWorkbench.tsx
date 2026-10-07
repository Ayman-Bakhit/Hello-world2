"use client";

import { useRouter } from "next/navigation";
import { allErrors } from "@/lib/launch";
import { useLaunch } from "@/state/launch";
import { useWallet } from "@/state/wallet";
import type { Charity } from "@/lib/types";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { FeeSplitEditor } from "./FeeSplitEditor";
import { CharityConfig, ReserveConfig } from "./LaunchParts";
import { useStepContext } from "./LaunchWizard";

/** Focused view of the money-routing parts of the launch config. Shares state with the /launch wizard. */
export function ConfigurationWorkbench({ charities }: { charities: Charity[] }) {
  const { config, setStep } = useLaunch();
  const wallet = useWallet();
  const ctx = useStepContext(charities);
  const router = useRouter();
  const errors = allErrors(config, ctx, "reserve").filter((e) => ["fees", "charity", "reserve"].includes(e.step));

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <Card title="Fee split" right={<Badge tone="info">FIXED</Badge>}>
        <FeeSplitEditor />
      </Card>
      <div className="space-y-4">
        <Card title="Charity"><CharityConfig charities={charities} /></Card>
        <Card title="Tax reserve"><ReserveConfig wallets={wallet.wallets} ctx={ctx} /></Card>
        <Card title="Next">
          <Button variant="primary" className="w-full" disabled={errors.length > 0} onClick={() => { setStep("review"); router.push("/launch#wizard"); }}>
            CONTINUE TO REVIEW
          </Button>
          {errors.filter((e) => e.step !== "fees").map((e) => <p key={e.message} className="mt-2 text-xs text-loss">{e.message}</p>)}
          <p className="mt-3 text-[11px] text-faint">Other launch fields are completed in the wizard. The fee split is fixed in this version.</p>
        </Card>
      </div>
    </div>
  );
}
