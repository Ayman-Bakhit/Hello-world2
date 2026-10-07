import { SetTaxReserveTargetRequest, parseUsdToCents, centsToUsdString } from "@project-name/shared";

export type TargetKind = "percentage" | "amount";
export interface TargetDraft { kind: TargetKind; percent: string; amount: string; enabled: boolean }

export type DraftResult =
  | { ok: true; request: SetTaxReserveTargetRequest; summary: string }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates a reserve-target draft with the SAME schema the API uses (digits only: no NaN, Infinity, exponent, sign or
 * separators; at most 2 decimals; above 0; USDC). `confirmed: true` is added only here, after the user confirms.
 * Nothing is converted through floating point: the summary is built from integer cents.
 */
export function validateTargetDraft(d: TargetDraft): DraftResult {
  const body = d.kind === "percentage"
    ? { targetType: "percentage" as const, targetPercentage: d.percent.trim(), currency: "USDC" as const, enabled: d.enabled, confirmed: true as const }
    : { targetType: "amount" as const, targetAmount: d.amount.trim(), currency: "USDC" as const, enabled: d.enabled, confirmed: true as const };
  const r = SetTaxReserveTargetRequest.safeParse(body);
  if (!r.success) {
    const field = d.kind === "percentage" ? "percent" : "amount";
    const issue = r.error.issues.find((i) => i.path[0] === "targetPercentage" || i.path[0] === "targetAmount") ?? r.error.issues[0];
    return { ok: false, errors: { [field]: d.kind === "percentage" ? "Enter a percent above 0 and at most 100, with at most 2 decimals." : issue?.message === "must be above 0" ? "Enter an amount above 0." : "Enter a USD amount with digits only and at most 2 decimals (up to 12 digits)." } };
  }
  const summary = d.kind === "percentage"
    ? `${d.percent.trim()}% of realized gains (USDC)`
    : `$${centsToUsdString(parseUsdToCents(d.amount)!)} USDC`;
  return { ok: true, request: r.data, summary: `${summary}${d.enabled ? "" : " (disabled)"}` };
}
