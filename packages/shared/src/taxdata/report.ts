import { formatUnits } from "../chain/units";
import { centsToDecimal } from "./manual";
import type { ManualBasisReview, RealizedSlice, TaxCalcResult, TaxEvent, TaxStatus } from "./types";

/**
 * Tax REPORT: a read-only view over the existing calculation (`computeTax`). It adds NO tax logic: every number is
 * a sum of realized slices the engine already produced. It is an ESTIMATE for planning and review. It is not a filing,
 * not a return, not verified, and it makes no claim about any jurisdiction's rules.
 */
export const REPORT_VERSION = "1";

/** Tax year boundary (initial implementation): the UTC calendar year, [Jan 1 00:00:00 UTC, next Jan 1 00:00:00 UTC), by DISPOSAL time. */
export const yearBoundary = (taxYear: number) => ({
  kind: "UTC_CALENDAR_YEAR" as const,
  from: new Date(Date.UTC(taxYear, 0, 1)).toISOString(),
  toExclusive: new Date(Date.UTC(taxYear + 1, 0, 1)).toISOString(),
  basis: "disposal time (UTC)" as const,
});

export interface ReportRequirement {
  kind: string;
  severity: "blocks_total" | "incomplete" | "info";
  message: string;
  count: number;
}

export interface ReportDisposal {
  id: string;
  taxYear: number;
  asset: string;
  mint: string | null;
  decimals: number;
  quantityRaw: string;
  quantity: string;
  acquiredAt: string;
  disposedAt: string;
  costBasisCents: string;
  proceedsCents: string;
  gainLossCents: string;
  holdingPeriod: "SHORT_TERM" | "LONG_TERM";
  accountingMethod: string;
  disposalSignature: string;
  disposalWalletId: string;
  acquisitionSignature: string | null;
  acquisitionWalletId: string;
  /** CHAIN = derived from an indexed transaction; USER_PROVIDED = cost basis the user entered */
  acquisitionSource: "CHAIN" | "USER_PROVIDED";
  disposalSource: "CHAIN";
  manualBasisId: string | null;
  proceedsValuation: "PRICE" | "COUNTER_LEG" | null;
  proceedsPriceSource: string | null;
  proceedsPriceObservedAt: string | null;
  proceedsPriceConfidence: "FIXTURE" | "OBSERVED" | null;
  costPriceSource: string | null;
  costPriceObservedAt: string | null;
  costPriceConfidence: "FIXTURE" | "OBSERVED" | null;
  feeLamports: string | null;
  confidence: "ESTIMATED";
  verifiedOnChain: false;
  reportStatus: TaxStatus;
}

export interface ReportUnresolved {
  id: string;
  signature: string;
  walletId: string;
  timestamp: string | null;
  kind: string;
  asset: string;
  mint: string | null;
  quantityRaw: string;
  status: string;
  missing: string[];
  reason: string;
  origin: "CHAIN" | "USER_PROVIDED";
  manualBasisId: string | null;
}

export interface ReportManualRecord {
  id: string;
  asset: string;
  mint: string | null;
  quantityRaw: string;
  acquiredAt: string;
  costBasisCents: string;
  reviewState: string;
  includedInCalculation: boolean;
  linkedTransferEventId: string | null;
  disposalSlicesUsing: number;
}

export interface TaxReport {
  reportVersion: string;
  /** Generation metadata is the ONLY part that differs between two runs over the same inputs. */
  meta: { generatedAt: string };
  label: "ESTIMATED_TAX_REPORT";
  walletId: string;
  taxYear: number;
  yearBoundary: ReturnType<typeof yearBoundary>;
  accountingMethod: string;
  swapTreatment: string;
  feePolicy: string;
  status: TaxStatus;
  /** null when status is UNAVAILABLE */
  summary: {
    /** null only for the demo fixture, which has no itemized proceeds or cost basis */
    proceedsCents: string | null; costBasisCents: string | null; gainLossCents: string; shortTermGainLossCents: string; longTermGainLossCents: string;
    shortTermProceedsCents: string | null; longTermProceedsCents: string | null; disposalCount: number;
  } | null;
  counts: { unresolvedEvents: number; dataRequiredEvents: number; unknownEvents: number; matchedTransfers: number; duplicatesIgnored: number };
  requirements: ReportRequirement[];
  manualBasis: { included: boolean; disclosure: string | null; records: ReportManualRecord[]; recordsUnderReview: number };
  priceProvenance: { sources: string[]; observations: { asset: string; source: string; observedAt: string; confidence: "FIXTURE" | "OBSERVED"; priceMicroUsd: string; events: number }[]; note: string };
  provenance: { dataSource: "chain" | "demo"; verifiedOnChain: false; chainDataNote: string; priceNote: string; userProvidedNote: string };
  limits: { transactionCap: number; transactionsTruncated: boolean; maxRows: number; rowsExceeded: boolean };
  disposals: ReportDisposal[];
  unresolvedEvents: ReportUnresolved[];
  fingerprint: string;
  /** sha256 over the canonical report excluding `meta` (set by the caller). Equal inputs => equal hash. */
  reportHash: string;
  disclaimer: string[];
}

export interface ReportInput {
  result: TaxCalcResult;
  walletId: string;
  fingerprint: string;
  generatedAt: string;
  limits: { transactionCap: number; transactionsTruncated: boolean; maxRows: number };
  dataSource?: "chain" | "demo";
}

const iso = (t: number | null) => (t === null ? null : new Date(t * 1000).toISOString());
const label = (a: string) => (a === "native" ? "SOL" : a);
const mintOf = (a: string) => (a === "native" ? null : a);
const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);
const px = (e: TaxEvent | undefined) => (e?.price ? { source: `${e.price.source}${e.price.confidence === "FIXTURE" ? " (fixture)" : ""}`, observedAt: iso(e.price.observedAt)!, confidence: e.price.confidence } : null);

export const REPORT_DISCLAIMER = [
  "Estimated tax report for planning and review. It is not a tax return, a filing, or a statement of what you owe.",
  "Figures are derived from indexed wallet data that is not independently verified, from prices that may be fixtures or absent, and from cost basis you may have provided yourself.",
  "Tax treatment depends on your jurisdiction and circumstances. Review with a qualified tax professional.",
];

/**
 * Builds the report from a calculation result. `status` is the engine's status, made WORSE (never better) when the report
 * itself had to be limited. Rows are sorted so equal inputs always give byte-identical output.
 */
export function buildTaxReport(i: ReportInput): TaxReport {
  const r = i.result;
  const byId = new Map(r.events.map((e) => [e.id, e]));
  const inYear = (s: RealizedSlice) => new Date(s.disposedAt * 1000).getUTCFullYear() === r.taxYear;
  const slices = r.realized.filter(inYear).sort((a, b) => a.disposedAt - b.disposedAt || a.disposalEventId.localeCompare(b.disposalEventId) || a.lotEventId.localeCompare(b.lotEventId));
  const rowsExceeded = slices.length > i.limits.maxRows;
  const kept = rowsExceeded ? slices.slice(0, i.limits.maxRows) : slices;

  const requirements: ReportRequirement[] = r.requirements.map((x) => ({ ...x }));
  if (i.limits.transactionsTruncated) requirements.push({ kind: "LIMIT", severity: "blocks_total", count: 1, message: `More transactions exist than the supported limit (${i.limits.transactionCap}). The report covers only part of the history and must not be relied on.` });
  if (rowsExceeded) requirements.push({ kind: "LIMIT", severity: "blocks_total", count: slices.length - i.limits.maxRows, message: `There are more realized disposals (${slices.length}) than this report lists (${i.limits.maxRows}). Rows were NOT silently dropped from the totals; the listing is capped and the report is not complete.` });
  const limited = i.limits.transactionsTruncated || rowsExceeded;
  const status: TaxStatus = r.status === "UNAVAILABLE" ? "UNAVAILABLE" : limited ? "DATA_REQUIRED" : r.status;

  const summary = r.status === "UNAVAILABLE" ? null : {
    proceedsCents: sum(slices.map((s) => s.proceedsCents)).toString(),
    costBasisCents: sum(slices.map((s) => s.costBasisCents)).toString(),
    gainLossCents: sum(slices.map((s) => s.gainLossCents)).toString(),
    shortTermGainLossCents: sum(slices.filter((s) => s.holdingPeriod === "SHORT_TERM").map((s) => s.gainLossCents)).toString(),
    longTermGainLossCents: sum(slices.filter((s) => s.holdingPeriod === "LONG_TERM").map((s) => s.gainLossCents)).toString(),
    shortTermProceedsCents: sum(slices.filter((s) => s.holdingPeriod === "SHORT_TERM").map((s) => s.proceedsCents)).toString(),
    longTermProceedsCents: sum(slices.filter((s) => s.holdingPeriod === "LONG_TERM").map((s) => s.proceedsCents)).toString(),
    disposalCount: slices.length,
  };

  const disposals: ReportDisposal[] = kept.map((s) => {
    const d = byId.get(s.disposalEventId), l = byId.get(s.lotEventId);
    const pp = px(d), cp = px(l);
    return {
      id: `${s.disposalEventId}|${s.lotEventId}`, taxYear: r.taxYear, asset: label(s.asset), mint: mintOf(s.asset), decimals: s.decimals, quantityRaw: s.quantity.toString(), quantity: formatUnits(s.quantity, s.decimals),
      acquiredAt: iso(s.acquiredAt)!, disposedAt: iso(s.disposedAt)!, costBasisCents: s.costBasisCents.toString(), proceedsCents: s.proceedsCents.toString(), gainLossCents: s.gainLossCents.toString(),
      holdingPeriod: s.holdingPeriod, accountingMethod: r.method, disposalSignature: s.disposalSignature, disposalWalletId: s.walletId,
      acquisitionSignature: s.acquisitionSignature.startsWith("manual:") ? null : s.acquisitionSignature, acquisitionWalletId: s.sourceWalletIdOfLot,
      acquisitionSource: s.acquisitionOrigin, disposalSource: "CHAIN", manualBasisId: s.manualBasisId,
      proceedsValuation: d?.valuation ?? null, proceedsPriceSource: pp?.source ?? null, proceedsPriceObservedAt: pp?.observedAt ?? null, proceedsPriceConfidence: pp?.confidence ?? null,
      costPriceSource: cp?.source ?? null, costPriceObservedAt: cp?.observedAt ?? null, costPriceConfidence: cp?.confidence ?? null,
      feeLamports: s.feeLamports === null ? null : s.feeLamports.toString(), confidence: "ESTIMATED", verifiedOnChain: false, reportStatus: status,
    };
  });

  const unresolvedEvents: ReportUnresolved[] = r.events
    .filter((e) => e.status === "UNRESOLVED" || e.status === "DATA_REQUIRED")
    .sort((a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity) || a.id.localeCompare(b.id))
    .map((e) => ({
      id: e.id, signature: e.signature.startsWith("manual:") ? "" : e.signature, walletId: e.walletId, timestamp: iso(e.timestamp), kind: e.kind, asset: label(e.asset), mint: mintOf(e.asset),
      quantityRaw: e.quantity.toString(), status: e.status, missing: [...e.missing], reason: e.reason, origin: e.origin, manualBasisId: e.manualBasisId,
    }));

  const reviews = new Map<string, ManualBasisReview>(r.manualBasisReview.map((m) => [m.manualBasisId, m]));
  const records: ReportManualRecord[] = r.events.filter((e) => e.kind === "MANUAL_BASIS").sort((a, b) => a.id.localeCompare(b.id)).map((e) => {
    const rv = reviews.get(e.manualBasisId!);
    return {
      id: e.manualBasisId!, asset: label(e.asset), mint: mintOf(e.asset), quantityRaw: e.quantity.toString(), acquiredAt: iso(e.timestamp)!, costBasisCents: (e.usdValueCents ?? 0n).toString(),
      reviewState: rv?.state ?? "OK", includedInCalculation: e.status === "READY", linkedTransferEventId: rv?.linkedEventId ?? null,
      disposalSlicesUsing: r.realized.filter((s) => s.manualBasisId === e.manualBasisId).length,
    };
  });
  const includedRecords = records.filter((x) => x.includedInCalculation);

  const obs = new Map<string, { asset: string; source: string; observedAt: string; confidence: "FIXTURE" | "OBSERVED"; priceMicroUsd: string; events: number }>();
  for (const e of r.events) {
    if (!e.price) continue;
    const src = `${e.price.source}${e.price.confidence === "FIXTURE" ? " (fixture)" : ""}`;
    const k = `${e.asset}|${e.price.source}|${e.price.observedAt}|${e.price.priceMicroUsd}`;
    const o = obs.get(k);
    if (o) o.events++;
    else obs.set(k, { asset: label(e.asset), source: src, observedAt: iso(e.price.observedAt)!, confidence: e.price.confidence, priceMicroUsd: e.price.priceMicroUsd.toString(), events: 1 });
  }
  const observations = [...obs.values()].sort((a, b) => a.asset.localeCompare(b.asset) || a.observedAt.localeCompare(b.observedAt) || a.source.localeCompare(b.source));

  const report: TaxReport = {
    reportVersion: REPORT_VERSION, meta: { generatedAt: i.generatedAt }, label: "ESTIMATED_TAX_REPORT", walletId: i.walletId, taxYear: r.taxYear, yearBoundary: yearBoundary(r.taxYear),
    accountingMethod: r.method, swapTreatment: r.swapTreatment, feePolicy: r.feePolicy, status, summary,
    counts: { unresolvedEvents: r.counts.unresolved, dataRequiredEvents: r.counts.dataRequired, unknownEvents: r.counts.UNKNOWN, matchedTransfers: r.counts.matched, duplicatesIgnored: r.counts.duplicatesIgnored },
    requirements,
    manualBasis: {
      included: includedRecords.length > 0, disclosure: includedRecords.length > 0 ? "Includes user-provided tax data." : null, records,
      recordsUnderReview: records.filter((x) => !x.includedInCalculation).length,
    },
    priceProvenance: {
      sources: [...new Set(observations.map((o) => o.source))].sort(), observations,
      note: observations.some((o) => o.confidence === "FIXTURE") ? "Includes FIXTURE prices (test data). They are not market data and are not verified." : "Prices are observations from the configured source and are not independently verified.",
    },
    provenance: {
      dataSource: i.dataSource ?? "chain", verifiedOnChain: false,
      chainDataNote: "Transactions were read from an RPC node by the indexer and are not independently verified.",
      priceNote: "A price is a claim by a named source at a time. Missing prices are never replaced by zero or by an assumed value.",
      userProvidedNote: "Records marked USER_PROVIDED are the user's own statement. They are not read from, or verified against, any blockchain, exchange or document.",
    },
    limits: { transactionCap: i.limits.transactionCap, transactionsTruncated: i.limits.transactionsTruncated, maxRows: i.limits.maxRows, rowsExceeded },
    disposals, unresolvedEvents, fingerprint: i.fingerprint, reportHash: "", disclaimer: REPORT_DISCLAIMER,
  };
  return report;
}

/** Key-sorted JSON so equal reports serialize identically. */
export function stableStringify(v: unknown, space = 0): string {
  const norm = (x: unknown): unknown => (Array.isArray(x) ? x.map(norm) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, y]) => [k, norm(y)])) : x);
  return JSON.stringify(norm(v), null, space);
}

/** The text a hash must cover: the whole report except generation metadata and the hash itself. */
export function canonicalReport(r: TaxReport): string {
  const { meta: _m, reportHash: _h, ...rest } = r;
  void _m; void _h;
  return stableStringify(rest);
}

// ---------- CSV ----------
export const CSV_COLUMNS = [
  "report_status", "tax_year", "asset", "mint", "quantity", "quantity_raw", "acquisition_timestamp", "disposal_timestamp", "cost_basis_usd", "proceeds_usd", "gain_loss_usd",
  "holding_period", "accounting_method", "disposal_transaction", "disposal_wallet_id", "acquisition_transaction", "acquisition_wallet_id", "acquisition_source", "disposal_source",
  "manual_basis_id", "proceeds_valuation", "proceeds_price_source", "proceeds_price_observed_at", "proceeds_price_confidence", "cost_price_source", "cost_price_observed_at",
  "cost_price_confidence", "fee_lamports", "confidence", "verified_on_chain", "report_fingerprint",
] as const;

const NUMERIC = /^-?\d{1,40}(\.\d{1,38})?$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/**
 * One CSV cell. Spreadsheet formula injection: any TEXT cell whose first character is = + - @ (or tab / carriage return)
 * is prefixed with an apostrophe so Excel/Sheets/LibreOffice treat it as text. Cells that are exactly a plain decimal
 * number (generated here from bigint math, e.g. a negative gain "-12.34") cannot form a formula and are left numeric.
 * Control characters are removed. RFC 4180 quoting applies when a cell has a comma, quote, CR or LF.
 */
export function csvCell(value: string | number | bigint | boolean | null | undefined, opts: { numeric?: boolean } = {}): string {
  if (value === null || value === undefined) return "";
  let s = String(value).replace(CONTROL, "");
  const isNumber = opts.numeric === true && NUMERIC.test(s);
  if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(r: TaxReport): string {
  const rows = r.disposals.map((d) => {
    const cells: [string | null, boolean][] = [
      [d.reportStatus, false], [String(d.taxYear), true], [d.asset, false], [d.mint, false], [d.quantity, true], [d.quantityRaw, true], [d.acquiredAt, false], [d.disposedAt, false],
      [centsToDecimal(BigInt(d.costBasisCents)), true], [centsToDecimal(BigInt(d.proceedsCents)), true], [signedCents(BigInt(d.gainLossCents)), true],
      [d.holdingPeriod, false], [d.accountingMethod, false], [d.disposalSignature, false], [d.disposalWalletId, false], [d.acquisitionSignature, false], [d.acquisitionWalletId, false],
      [d.acquisitionSource, false], [d.disposalSource, false], [d.manualBasisId, false], [d.proceedsValuation, false], [d.proceedsPriceSource, false], [d.proceedsPriceObservedAt, false],
      [d.proceedsPriceConfidence, false], [d.costPriceSource, false], [d.costPriceObservedAt, false], [d.costPriceConfidence, false], [d.feeLamports, true], [d.confidence, false],
      [String(d.verifiedOnChain), false], [r.fingerprint, false],
    ];
    return cells.map(([v, n]) => csvCell(v, { numeric: n })).join(",");
  });
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

function signedCents(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}${centsToDecimal(a)}`;
}

/** JSON export: the whole report, key-sorted, with the hash filled in by the caller. */
export const reportToJson = (r: TaxReport): string => stableStringify(r, 2) + "\n";

/** Filename from validated parts only: digits, enum values and hex. Nothing user-controlled reaches it. */
export function exportFilename(r: Pick<TaxReport, "taxYear" | "accountingMethod" | "fingerprint">, format: "csv" | "json"): string {
  const y = String(Math.trunc(r.taxYear)).replace(/\D/g, "").slice(0, 4);
  const m = r.accountingMethod.replace(/[^A-Z]/g, "").slice(0, 4).toLowerCase();
  const f = r.fingerprint.replace(/[^0-9a-f]/g, "").slice(0, 12);
  return `estimated-tax-report-${y}-${m}-${f}.${format}`;
}
