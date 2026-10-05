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
  const { config, setFeeDraft, setStep } = useLaunch();
  const wallet = useWallet();
  const ctx = useStepContext(charities);
  const router = useRouter();
  const errors = allErrors(config, ctx, "reserve").filter((e) => ["fees", "charity", "reserve"].includes(e.step));
  const feeOnly = errors.filter((e) => e.step === "fees");

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <Card title="Fee split" right={<Badge tone="demo">DEMO</Badge>}>
        <FeeSplitEditor drafts={config.feeDrafts} onChange={setFeeDraft} />
      </Card>
      <div className="space-y-4">
        <Card title="Charity"><CharityConfig charities={charities} /></Card>
        <Card title="Tax reserve"><ReserveConfig wallets={wallet.wallets} ctx={ctx} /></Card>
        <Card title="Next">
          <Button variant="primary" className="w-full" disabled={errors.length > 0} onClick={() => { setStep("review"); router.push("/launch#wizard"); }}>
            CONTINUE TO REVIEW
          </Button>
          {feeOnly.length > 0 ? <p className="mt-2 text-xs text-loss">Blocked: the fee split must total exactly 100%.</p> : null}
          {errors.filter((e) => e.step !== "fees").map((e) => <p key={e.message} className="mt-2 text-xs text-loss">{e.message}</p>)}
          <p className="mt-3 text-[11px] text-faint">Review and deploy stay disabled until the fee split is valid. Other launch fields are completed in the wizard.</p>
        </Card>
      </div>
    </div>
  );
}
