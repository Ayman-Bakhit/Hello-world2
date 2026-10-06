import { percentToBps } from "@project-name/shared";

/** What the user chooses on the Tax screens. Everything optional: the server echoes what it actually used. */
export interface TaxQueryParams {
  taxYear?: number;
  method?: "FIFO" | "LIFO" | "HIFO";
  swapTreatment?: "DISPOSAL_AND_ACQUISITION" | "NOT_ASSESSED";
  shortTermRateBps?: number;
  longTermRateBps?: number;
  stateRateBps?: number;
}

export interface TaxFormDraft {
  year: string;
  method: "" | "FIFO" | "LIFO" | "HIFO";
  swap: "" | "DISPOSAL_AND_ACQUISITION" | "NOT_ASSESSED";
  shortRate: string;
  longRate: string;
  stateRate: string;
}

export const EMPTY_TAX_DRAFT: TaxFormDraft = { year: "", method: "", swap: "", shortRate: "", longRate: "", stateRate: "" };

/** Draft -> query. Rates are all-or-none (the API requires it); percent strings use exact decimal parsing, no floats. */
export function draftToQuery(d: TaxFormDraft): { ok: true; query: TaxQueryParams } | { ok: false; error: string } {
  const q: TaxQueryParams = {};
  if (d.year.trim()) {
    if (!/^\d{4}$/.test(d.year.trim())) return { ok: false, error: "Tax year must be 4 digits." };
    q.taxYear = Number(d.year.trim());
  }
  if (d.method) q.method = d.method;
  if (d.swap) q.swapTreatment = d.swap;
  const rates = [d.shortRate, d.longRate, d.stateRate].map((x) => x.trim());
  if (rates.some(Boolean)) {
    if (rates.some((x) => !x)) return { ok: false, error: "Enter all three rates, or leave all three empty." };
    try {
      const [s, l, st] = rates.map((x) => percentToBps(x));
      if ([s, l, st].some((b) => b === undefined || b < 0 || b > 10_000)) return { ok: false, error: "Rates must be between 0% and 100%." };
      q.shortTermRateBps = s!; q.longTermRateBps = l!; q.stateRateBps = st!;
    } catch {
      return { ok: false, error: "Rates must be percentages with at most 2 decimals." };
    }
  }
  return { ok: true, query: q };
}
