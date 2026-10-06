import { formatAmount, formatDate, formatUsd } from "@/lib/format";
import type { TaxTreatment, Transaction, TxKind } from "@/lib/types";
import { Badge } from "./Badge";

const KIND: Record<TxKind, string> = {
  swap: "Swap",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  donation: "Donation",
  fee_in: "Creator fee",
  transfer: "SOL transfer",
  token_receipt: "Token received",
  token_send: "Token sent",
  fee: "Network fee only",
  unknown: "Unclassified",
};

const TREATMENT: Record<TaxTreatment, { label: string; tone: "info" | "neutral" | "demo" }> = {
  disposal: { label: "Potential taxable disposal", tone: "info" },
  income: { label: "Income (not modeled yet)", tone: "demo" },
  none: { label: "None", tone: "neutral" },
  not_assessed: { label: "NOT ASSESSED", tone: "neutral" },
};

const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s);
/** SOL / demo symbols are short; anything longer is a mint address and is shortened for display. */
const assetLabel = (s: string) => (s.length > 12 ? short(s) : s);

export function TransactionTable({ rows }: { rows: Transaction[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {["Date", "Type", "Asset", "Amount", "USD value", "Tax treatment", "Signature"].map((h, i) => (
              <th key={h} scope="col" className={`eyebrow px-3 py-2 font-normal ${i === 3 || i === 4 ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/50">
              <td className="num px-3 py-2.5 text-muted">{t.occurredAt ? formatDate(t.occurredAt) : "Unknown"}</td>
              <td className="px-3 py-2.5">
                <span title={t.live?.reason ?? undefined}>{KIND[t.kind]}</span>
                {t.live?.status === "failed" ? <span className="ml-2"><Badge tone="bad">FAILED</Badge></span> : null}
                <span className="block text-xs text-faint">{t.walletLabel}</span>
              </td>
              <td className={`px-3 py-2.5 font-semibold ${t.assetSymbol.length > 12 ? "font-mono text-xs" : ""}`} title={t.assetSymbol.length > 12 ? t.assetSymbol : undefined}>{assetLabel(t.assetSymbol)}</td>
              <td className="num px-3 py-2.5 text-right">
                {t.live && t.amount === 0n ? <span className="text-faint">no asset movement</span> : (t.live && t.amount > 0n ? "+" : "") + formatAmount(t.amount, t.decimals, 4)}
                {t.live?.feeLamports && t.live.feeLamports > 0n ? <span className="block text-xs text-faint">fee {formatAmount(t.live.feeLamports, 9, 6)} SOL</span> : null}
              </td>
              <td className="num px-3 py-2.5 text-right">{t.usdValueCents === null ? <span className="text-xs text-faint">PRICE UNAVAILABLE</span> : formatUsd(t.usdValueCents, { cents: true })}</td>
              <td className="px-3 py-2.5"><Badge tone={TREATMENT[t.taxTreatment].tone}>{TREATMENT[t.taxTreatment].label}</Badge></td>
              <td className="px-3 py-2.5">
                {t.live ? (
                  t.live.explorerUrl ? (
                    <a href={t.live.explorerUrl} target="_blank" rel="noopener noreferrer" className="num font-mono text-xs text-b-creator underline-offset-2 hover:underline" title={t.signature}>
                      {short(t.signature)}
                    </a>
                  ) : (
                    <span className="num font-mono text-xs text-faint" title={t.signature}>{short(t.signature)}</span>
                  )
                ) : (
                  <span className="num font-mono text-xs text-faint" title="Placeholder. No explorer link: this transaction does not exist on any chain.">
                    {t.signature}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
