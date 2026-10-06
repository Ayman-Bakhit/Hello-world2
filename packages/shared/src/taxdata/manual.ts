import { BASE58_PUBKEY, BASE58_SIGNATURE } from "../chain/types";
import { formatUnits } from "../chain/units";

/**
 * User-provided cost basis: strict, lossless parsing. Nothing is rounded: input that cannot be represented exactly is
 * REJECTED. The record is the user's statement. It is never "verified" and never presented as blockchain data.
 */

export const MANUAL_BASIS_REASONS = ["EXCHANGE_PURCHASE", "PRIOR_WALLET", "GIFT_RECEIVED", "INCOME_OR_REWARD", "OTHER"] as const;
export type ManualBasisReason = (typeof MANUAL_BASIS_REASONS)[number];
export const MANUAL_BASIS_SOURCE = "USER_PROVIDED" as const;
export const MANUAL_BASIS_CURRENCIES = ["USD"] as const;
/** Bitcoin's genesis block: no digital asset acquisition can predate it. */
export const EARLIEST_ACQUISITION = Date.UTC(2009, 0, 3) / 1000;
export const MANUAL_NOTES_MAX = 1000;
export const MANUAL_CHANGE_REASON_MAX = 300;

export class ManualBasisValidationError extends Error {
  constructor(public readonly fields: Record<string, string[]>) {
    super("manual basis validation failed");
    this.name = "ManualBasisValidationError";
  }
}

/** Plain text only: tabs/newlines allowed, other control characters and bidi overrides rejected (not stripped). */
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
export const isSafeText = (s: string): boolean => !UNSAFE_TEXT.test(s);

/** "1.5" with 9 decimals -> 1_500_000_000n. More fractional digits than `decimals`, or any non-canonical form, is rejected. */
export function decimalToRaw(s: string, decimals: number): bigint {
  const m = /^(0|[1-9]\d{0,38})(?:\.(\d{1,38}))?$/.exec(s);
  if (!m) throw new Error("must be a plain decimal number such as 1 or 0.25");
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error(`has more than ${decimals} decimal places; it would have to be rounded`);
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** "1234.56" -> 123456n. At most 2 decimals (no rounding), up to 15 integer digits. */
export function usdToCents(s: string): bigint {
  const m = /^(0|[1-9]\d{0,14})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error("must be a USD amount with at most 2 decimals, such as 1234.56");
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}

/** Strict ISO-8601 UTC with whole seconds, e.g. 2023-05-17T14:30:00Z. */
export function parseAcquisitionTime(s: string, nowUnix: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.000)?Z$/.exec(s);
  if (!m) throw new Error("must be a UTC time like 2023-05-17T14:30:00Z (whole seconds)");
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const ms = Date.UTC(y, mo - 1, d, h, mi, se);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || dt.getUTCHours() !== h || dt.getUTCMinutes() !== mi) throw new Error("is not a real calendar time");
  const t = ms / 1000;
  if (t < EARLIEST_ACQUISITION) throw new Error("is before 2009-01-03");
  if (t > nowUnix) throw new Error("is in the future");
  return t;
}

export interface ManualBasisFields {
  asset: string;
  decimals?: number | null | undefined;
  quantity: string;
  acquiredAt: string;
  costBasis: string;
  currency?: string;
  reason: string;
  signature?: string | null | undefined;
  notes?: string | null | undefined;
}
export interface NormalizedManualBasis {
  /** "native" or a mint */
  asset: string;
  decimals: number;
  quantityRaw: bigint;
  acquiredAt: number;
  costBasisCents: bigint;
  currency: "USD";
  reason: ManualBasisReason;
  signature: string | null;
  notes: string | null;
}

/**
 * Semantic validation. `knownDecimals` = decimals the system already knows for this asset (native = 9, or from the
 * indexed asset row); when null the caller must supply `decimals`. A supplied value that contradicts a known one is rejected.
 */
export function normalizeManualBasis(f: ManualBasisFields, ctx: { knownDecimals: number | null; nowUnix: number }): NormalizedManualBasis {
  const errs: Record<string, string[]> = {};
  const bad = (k: string, m: string) => { (errs[k] ??= []).push(m); };
  if (f.asset !== "native" && !BASE58_PUBKEY.safeParse(f.asset).success) bad("asset", 'must be "native" (SOL) or a token mint address');
  let decimals = ctx.knownDecimals;
  if (f.decimals !== undefined && f.decimals !== null) {
    if (!Number.isInteger(f.decimals) || f.decimals < 0 || f.decimals > 38) bad("decimals", "must be an integer from 0 to 38");
    else if (decimals !== null && decimals !== f.decimals) bad("decimals", `this asset has ${decimals} decimals, not ${f.decimals}`);
    else decimals = f.decimals;
  }
  if (decimals === null) bad("decimals", "decimals for this asset are not known yet: provide them");
  let quantityRaw = 0n;
  if (decimals !== null && !errs.decimals) {
    try {
      quantityRaw = decimalToRaw(f.quantity, decimals);
      if (quantityRaw <= 0n) bad("quantity", "must be greater than zero");
    } catch (e) { bad("quantity", (e as Error).message); }
  } else if (!/^\d/.test(f.quantity)) bad("quantity", "must be a positive number");
  let costBasisCents = 0n;
  try { costBasisCents = usdToCents(f.costBasis); } catch (e) { bad("costBasis", (e as Error).message); }
  let acquiredAt = 0;
  try { acquiredAt = parseAcquisitionTime(f.acquiredAt, ctx.nowUnix); } catch (e) { bad("acquiredAt", (e as Error).message); }
  if ((f.currency ?? "USD") !== "USD") bad("currency", "only USD is supported");
  if (!(MANUAL_BASIS_REASONS as readonly string[]).includes(f.reason)) bad("reason", `must be one of ${MANUAL_BASIS_REASONS.join(", ")}`);
  if (f.signature != null && !BASE58_SIGNATURE.safeParse(f.signature).success) bad("signature", "is not a valid transaction signature");
  if (f.notes != null) {
    if (f.notes.length > MANUAL_NOTES_MAX) bad("notes", `at most ${MANUAL_NOTES_MAX} characters`);
    if (!isSafeText(f.notes)) bad("notes", "contains control or direction-override characters");
  }
  if (Object.keys(errs).length > 0) throw new ManualBasisValidationError(errs);
  return {
    asset: f.asset, decimals: decimals!, quantityRaw, acquiredAt, costBasisCents, currency: "USD", reason: f.reason as ManualBasisReason,
    signature: f.signature ?? null, notes: f.notes && f.notes.length > 0 ? f.notes : null,
  };
}

/** Exact display helpers (no floats). */
export const rawToDecimal = (raw: bigint, decimals: number): string => formatUnits(raw, decimals);
export const centsToDecimal = (c: bigint): string => `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;
