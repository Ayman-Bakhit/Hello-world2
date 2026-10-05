/** Display formatting. Integer math for money; Number() is used only for compact display. */

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function formatUsd(cents: bigint, opts: { cents?: boolean; signed?: boolean } = {}): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const rounded = opts.cents ? abs : ((abs + 50n) / 100n) * 100n;
  const dollars = rounded / 100n;
  const rem = rounded % 100n;
  const body = `$${group(dollars.toString())}${opts.cents ? "." + rem.toString().padStart(2, "0") : ""}`;
  if (rounded === 0n) return body;
  return (neg ? "-" : opts.signed ? "+" : "") + body;
}

export function formatCompactUsd(cents: bigint): string {
  const n = Number(cents < 0n ? -cents : cents) / 100;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  return formatUsd(cents);
}

/** bps -> percent string with 0, 1 or 2 decimals. 7709 -> "77.1%". */
export function formatPercentBps(bps: number, opts: { digits?: 0 | 1 | 2; signed?: boolean } = {}): string {
  const digits = opts.digits ?? 1;
  const neg = bps < 0;
  const abs = Math.abs(Math.round(bps));
  let body: string;
  if (digits === 2) {
    body = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  } else if (digits === 1) {
    const tenths = Math.round(abs / 10);
    body = `${Math.floor(tenths / 10)}.${tenths % 10}`;
  } else {
    body = String(Math.round(abs / 100));
  }
  const zero = Number(body) === 0;
  const sign = zero ? "" : neg ? "-" : opts.signed ? "+" : "";
  return `${sign}${body}%`;
}

/** micro-USD per token -> "$142.50" or "$0.000016". */
export function formatPrice(priceMicro: bigint): string {
  if (priceMicro >= 1_000_000n) {
    return formatUsd(priceMicro / 10_000n, { cents: true });
  }
  const raw = priceMicro.toString().padStart(7, "0");
  const frac = raw.slice(-6).replace(/0+$/, "").padEnd(4, "0");
  return `$0.${frac}`;
}

export function formatAmount(amount: bigint, decimals: number, maxFrac = 4): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fracFull = (amount % base).toString().padStart(decimals, "0");
  const frac = fracFull.slice(0, maxFrac).replace(/0+$/, "");
  return `${group(whole.toString())}${frac ? "." + frac : ""}`;
}

export function shortAddress(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Deterministic (UTC) so server and client renders match. */
export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
export function formatDateTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** "4220", "4,220.5" -> cents. Returns null for anything else (max 2 decimals, positive). */
export function parseUsdToCents(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0") || "0");
  return cents > 0n ? cents : null;
}
