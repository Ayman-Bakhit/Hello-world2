import { formatAmount, formatDate, formatUsd } from "@/lib/format";
import type { TaxTreatment, Transaction, TxKind } from "@/lib/types";
import { Badge } from "./Badge";

const KIND: Record<TxKind, string> = {
  swap: "Swap",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  donation: "Donation",
  fee_in: "Creator fee",
};

const TREATMENT: Record<TaxTreatment, { label: string; tone: "info" | "neutral" | "demo" }> = {
  disposal: { label: "Potential taxable disposal", tone: "info" },
  income: { label: "Income (not modeled yet)", tone: "demo" },
  none: { label: "None", tone: "neutral" },
};

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
              <td className="num px-3 py-2.5 text-muted">{formatDate(t.occurredAt)}</td>
              <td className="px-3 py-2.5">{KIND[t.kind]}<span className="block text-xs text-faint">{t.walletLabel}</span></td>
              <td className="px-3 py-2.5 font-semibold">{t.assetSymbol}</td>
              <td className="num px-3 py-2.5 text-right">{formatAmount(t.amount, t.decimals, 2)}</td>
              <td className="num px-3 py-2.5 text-right">{formatUsd(t.usdValueCents, { cents: true })}</td>
              <td className="px-3 py-2.5"><Badge tone={TREATMENT[t.taxTreatment].tone}>{TREATMENT[t.taxTreatment].label}</Badge></td>
              <td className="px-3 py-2.5">
                <span className="num font-mono text-xs text-faint" title="Placeholder. No explorer link: this transaction does not exist on any chain.">
                  {t.signature}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
