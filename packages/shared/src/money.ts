/** USD string helpers. Integer cents only; no floats. */

/** "4,220" or "0.5" -> cents. Positive, at most 2 decimals; otherwise null. */
export function parseUsdToCents(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0") || "0");
  return cents > 0n ? cents : null;
}

/** 1000000n -> "10000.00" */
export function centsToUsdString(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  return `${neg ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}
