/** Exact integer <-> decimal-string helpers for token amounts. No floats. */

/** 1500000n, 6 -> "1.5". Negative values keep their sign. */
export function formatUnits(raw: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) throw new Error("invalid decimals");
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  if (decimals === 0) return `${neg ? "-" : ""}${abs}`;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** value (micro-USD per whole token) -> USD cents for `raw` base units, rounded down. */
export function valueCents(raw: bigint, decimals: number, priceMicroUsd: bigint): bigint {
  return (raw * priceMicroUsd) / 10n ** BigInt(decimals) / 10_000n;
}

/**
 * JSON.parse that keeps integers beyond 2^53 exact (as BigInt). Lamport balances of large accounts exceed
 * Number.MAX_SAFE_INTEGER; a plain JSON.parse would silently round them. Requires Node 21+ (reviver source text).
 */
export function parseJsonLossless(text: string): unknown {
  const reviver = (_k: string, v: unknown, ctx?: { source?: string }) =>
    typeof v === "number" && Number.isInteger(v) && !Number.isSafeInteger(v) && ctx?.source ? BigInt(ctx.source) : v;
  return JSON.parse(text, reviver as unknown as (this: unknown, key: string, value: unknown) => unknown);
}

/** Inverse of parseJsonLossless: BigInt values are written as exact JSON integers. */
export function stringifyLossless(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? (JSON as unknown as { rawJSON(s: string): unknown }).rawJSON(v.toString()) : v));
}
