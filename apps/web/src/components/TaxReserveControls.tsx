"use client";

import { percentOfGains, percentToBps } from "@project-name/shared";
import { useState } from "react";
import { formatUsd, parseUsdToCents } from "@/lib/format";
import type { ReserveRule } from "@/lib/types";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { SigningDialog, type SigningRow } from "./SigningDialog";

const input = "num w-full rounded border border-line-strong bg-canvas px-2.5 py-1.5 text-sm";

export function TaxReserveControls({
  reserveCents,
  exposureCents,
  realizedNetGainsCents,
  vaultLabel,
  initialRule,
}: {
  reserveCents: bigint;
  exposureCents: bigint;
  realizedNetGainsCents: bigint;
  vaultLabel: string;
  initialRule: ReserveRule;
}) {
  const shortfall = exposureCents > reserveCents ? exposureCents - reserveCents : 0n;
  const [dialog, setDialog] = useState<"add" | "withdraw" | null>(null);
  const [amount, setAmount] = useState((Number(shortfall) / 100).toString());
  const [kind, setKind] = useState<ReserveRule["kind"]>(initialRule.kind);
  const [percent, setPercent] = useState(initialRule.kind === "FIXED_PERCENT" ? String(initialRule.bps / 100) : "30");
  const [target, setTarget] = useState(initialRule.kind === "MANUAL_TARGET" ? String(Number(initialRule.cents) / 100) : "10000");

  const cents = parseUsdToCents(amount);
  const bps = (() => { try { return percentToBps(percent); } catch { return null; } })();
  const percentTarget = bps !== null && bps <= 10_000 ? percentOfGains(realizedNetGainsCents, bps) : null;
  const manualTarget = parseUsdToCents(target);
  const ruleTarget = kind === "FIXED_PERCENT" ? percentTarget : manualTarget;

  const rows = (direction: "add" | "withdraw"): SigningRow[] => {
    const amt = cents ?? 0n;
    const after = direction === "add" ? reserveCents + amt : reserveCents - amt;
    return [
      { label: "Asset", value: "USDC" },
      { label: "Amount", value: formatUsd(amt, { cents: true }) },
      { label: direction === "add" ? "Destination" : "Source", value: vaultLabel },
      { label: "Network", value: "Solana (demo, not connected)" },
      { label: "Estimated network fee", value: "~0.000005 SOL (illustrative)" },
      { label: "Protocol fee", value: "$0.00 (none in this demo)" },
      { label: "Slippage", value: "n/a (no swap)" },
      { label: "Program", value: "SPL Token (illustrative)" },
      { label: "Expected result", value: `Reserve ${formatUsd(reserveCents)} → ${formatUsd(after < 0n ? 0n : after)}` },
    ];
  };

  const amountOk = cents !== null && (dialog !== "withdraw" || cents <= reserveCents);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Move funds" right={<Badge tone="demo">DEMO UI ONLY</Badge>}>
        <label htmlFor="reserve-amount" className="eyebrow">Amount (USDC)</label>
        <input id="reserve-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${input} mt-1.5`} />
        {cents === null ? <p className="mt-1 text-xs text-loss">Enter a positive amount with at most 2 decimals.</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" disabled={cents === null} onClick={() => setDialog("add")}>ADD FUNDS</Button>
          <Button disabled={cents === null || cents > reserveCents} onClick={() => setDialog("withdraw")}>WITHDRAW</Button>
        </div>
        <p className="mt-3 text-xs text-faint">
          The reserve is designed to be user-controlled: you approve every deposit and withdrawal with your own wallet.
          Nothing moves automatically, no tokens are converted without your consent, and this demo moves no funds.
        </p>
      </Card>

      <Card title="Adjust target">
        <fieldset>
          <legend className="sr-only">Reserve rule</legend>
          <div className="space-y-3">
            <label className="flex items-start gap-3 text-sm">
              <input type="radio" name="rule" checked={kind === "FIXED_PERCENT"} onChange={() => setKind("FIXED_PERCENT")} className="mt-1" />
              <span className="flex-1">
                Reserve a fixed percentage of realized gains
                <span className="mt-1.5 flex items-center gap-2">
                  <input aria-label="Percent of realized gains" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} className={`${input} !w-24`} disabled={kind !== "FIXED_PERCENT"} />
                  <span className="text-xs text-muted">% of realized net gains</span>
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input type="radio" name="rule" checked={kind === "MANUAL_TARGET"} onChange={() => setKind("MANUAL_TARGET")} className="mt-1" />
              <span className="flex-1">
                Maintain a manual target
                <span className="mt-1.5 flex items-center gap-2">
                  <span className="text-xs text-muted">$</span>
                  <input aria-label="Manual reserve target in USD" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className={`${input} !w-32`} disabled={kind !== "MANUAL_TARGET"} />
                </span>
              </span>
            </label>
          </div>
        </fieldset>
        <div className="mt-4 rounded-md border border-line bg-surface-2/40 p-3 text-sm">
          <p className="eyebrow">Resulting target</p>
          <p className="num mt-1 text-lg font-semibold">{ruleTarget === null ? "Invalid input" : formatUsd(ruleTarget)}</p>
          {kind === "FIXED_PERCENT" && percentTarget !== null ? (
            <p className="mt-1 text-xs text-muted">
              {percent}% of {formatUsd(realizedNetGainsCents)} realized net gains. Gains only; losses never create a negative target.
            </p>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-faint">Rule changes are not saved in this demo. Automatic funding would require your explicit authorization and signature.</p>
      </Card>

      {dialog ? (
        amountOk ? (
          <SigningDialog title={dialog === "add" ? "Add funds to tax reserve" : "Withdraw from tax reserve"} rows={rows(dialog)} onClose={() => setDialog(null)} />
        ) : null
      ) : null}
    </div>
  );
}
