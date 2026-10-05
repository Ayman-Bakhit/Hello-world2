"use client";

import { COPY, percentOfGains, percentToBps } from "@project-name/shared";
import { useState } from "react";
import { formatDate, formatUsd, parseUsdToCents } from "@/lib/format";
import type { Charity, Donation } from "@/lib/types";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { CharityCard } from "./CharityCard";
import { SigningDialog } from "./SigningDialog";

const input = "num rounded border border-line-strong bg-canvas px-2.5 py-1.5 text-sm";

export function GiveClient({
  charities,
  donations,
  realizedNetGainsCents,
  rules,
}: {
  charities: Charity[];
  donations: Donation[];
  realizedNetGainsCents: bigint;
  rules: readonly string[];
}) {
  const firstVerified = charities.find((c) => c.verification === "verified")?.id ?? "";
  const [charityId, setCharityId] = useState(firstVerified);
  const [mode, setMode] = useState<"fixed" | "percent">("fixed");
  const [fixed, setFixed] = useState("100");
  const [percent, setPercent] = useState("5");
  const [dialog, setDialog] = useState(false);

  const donated = (id: string) =>
    donations.filter((d) => d.charityId === id && d.status === "confirmed").reduce((s, d) => s + d.amountCents, 0n);
  const totalGiven = donations.filter((d) => d.status === "confirmed").reduce((s, d) => s + d.amountCents, 0n);

  const charity = charities.find((c) => c.id === charityId);
  const amount = (() => {
    if (mode === "fixed") return parseUsdToCents(fixed);
    try {
      const bps = percentToBps(percent);
      if (bps <= 0 || bps > 10_000) return null;
      const v = percentOfGains(realizedNetGainsCents, bps);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  })();
  const nameOf = (id: string) => charities.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {charities.map((c) => (
          <CharityCard key={c.id} charity={c} donatedCents={donated(c.id)} selected={c.id === charityId} onSelect={setCharityId} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Donate" right={<Badge tone="demo">DEMO · NO FUNDS MOVE</Badge>}>
          <p className="text-sm text-muted">To: <span className="text-fg">{charity?.name ?? "Select a verified charity"}</span></p>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Amount type">
            <Button variant={mode === "fixed" ? "primary" : "secondary"} onClick={() => setMode("fixed")}>FIXED AMOUNT</Button>
            <Button variant={mode === "percent" ? "primary" : "secondary"} onClick={() => setMode("percent")}>% OF REALIZED GAINS</Button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {mode === "fixed" ? (
              <>
                <span className="text-sm text-muted">$</span>
                <input aria-label="Donation amount in USD" inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} className={`${input} w-32`} />
              </>
            ) : (
              <>
                <input aria-label="Percent of realized gains" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} className={`${input} w-24`} />
                <span className="text-sm text-muted">% of {formatUsd(realizedNetGainsCents)} realized net gains</span>
              </>
            )}
          </div>
          <p className="num mt-3 text-lg font-semibold">{amount === null ? "Enter a valid amount" : formatUsd(amount, { cents: true })}</p>
          <Button variant="primary" className="mt-3" disabled={amount === null || !charity || charity.verification !== "verified"} onClick={() => setDialog(true)}>
            DONATE
          </Button>
          <p className="mt-4 text-xs text-muted">{COPY.donation}</p>
          <p className="mt-1 text-xs text-faint">
            {COPY.donationNote}{" "}
            <a className="text-accent underline underline-offset-2" href={COPY.irsCharity} target="_blank" rel="noopener noreferrer">IRS: charitable organizations</a>
          </p>
        </Card>

        <Card title="Giving rules">
          <ul className="space-y-2">
            {rules.map((r) => (
              <li key={r} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
                {r}
                <Badge tone="neutral">EXAMPLE</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-faint">
            Recurring rules are not active. When built, each automatic donation will require your explicit authorization
            and a signature from your wallet.
          </p>
          <div className="mt-4 border-t border-line pt-3">
            <p className="eyebrow">Total donated (confirmed, demo)</p>
            <p className="num mt-1 text-xl font-semibold">{formatUsd(totalGiven)}</p>
          </div>
        </Card>
      </div>

      <Card title="Donation history" right={<Badge tone="demo">DEMO DATA</Badge>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Date", "Charity", "Amount", "Status", "Receipt", ""].map((h) => (
                  <th key={h} scope="col" className="eyebrow px-3 py-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {donations.map((d) => (
                <tr key={d.id} className="border-b border-line/60 last:border-0">
                  <td className="num px-3 py-2.5 text-muted">{formatDate(d.occurredAt)}</td>
                  <td className="px-3 py-2.5">{nameOf(d.charityId)}</td>
                  <td className="num px-3 py-2.5">{formatUsd(d.amountCents, { cents: true })} {d.assetSymbol}</td>
                  <td className="px-3 py-2.5"><Badge tone={d.status === "confirmed" ? "good" : "demo"}>{d.status}</Badge></td>
                  <td className="num px-3 py-2.5 font-mono text-xs text-faint">{d.receiptRef}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-3 text-[11px] font-semibold tracking-wider text-faint">
                      {["VIEW TRANSACTION", "VIEW RECEIPT", "EXPORT"].map((a) => (
                        <span key={a} aria-disabled title="Available once real donations are recorded." className="cursor-not-allowed">{a}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {dialog && amount !== null && charity ? (
        <SigningDialog
          title={`Donate to ${charity.name}`}
          onClose={() => setDialog(false)}
          rows={[
            { label: "Asset", value: "USDC" },
            { label: "Amount", value: formatUsd(amount, { cents: true }) },
            { label: "Destination", value: `${charity.name} (demo wallet, verification not implemented)` },
            { label: "Network", value: "Solana (demo, not connected)" },
            { label: "Estimated network fee", value: "~0.000005 SOL (illustrative)" },
            { label: "Protocol fee", value: "$0.00 (none in this demo)" },
            { label: "Slippage", value: "n/a (no swap)" },
            { label: "Program", value: "SPL Token (illustrative)" },
            { label: "Expected result", value: "Receipt recorded. Potentially deductible; consult a tax professional." },
          ]}
        />
      ) : null}
    </div>
  );
}
