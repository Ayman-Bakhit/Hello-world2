/**
 * Fee split math. All allocations are integer basis points (1 bp = 0.01%).
 * The four buckets must sum to exactly 10_000. No floats, ever.
 */

export const TOTAL_BPS = 10_000;

export const FEE_BUCKETS = ["creator", "taxReserve", "charity", "protocol"] as const;
export type FeeBucket = (typeof FEE_BUCKETS)[number];
export type FeeSplitBps = Record<FeeBucket, number>;

export type FeeSplitError =
  | { code: "NOT_INTEGER"; bucket: FeeBucket }
  | { code: "NEGATIVE"; bucket: FeeBucket }
  | { code: "SUM_MISMATCH"; sum: number };

export function validateFeeSplit(split: FeeSplitBps): FeeSplitError[] {
  const errors: FeeSplitError[] = [];
  let sum = 0;
  for (const bucket of FEE_BUCKETS) {
    const v = split[bucket];
    if (!Number.isSafeInteger(v)) errors.push({ code: "NOT_INTEGER", bucket });
    else if (v < 0) errors.push({ code: "NEGATIVE", bucket });
    else sum += v;
  }
  if (errors.length === 0 && sum !== TOTAL_BPS) errors.push({ code: "SUM_MISMATCH", sum });
  return errors;
}

export function assertValidFeeSplit(split: FeeSplitBps): void {
  const errors = validateFeeSplit(split);
  if (errors.length > 0) throw new Error(`Invalid fee split: ${JSON.stringify(errors)}`);
}

/** Convert a human percent string like "60" or "12.5" to bps. Rejects >2 decimals. */
export function percentToBps(percent: string): number {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(percent.trim())) {
    throw new Error(`Invalid percent: ${percent}`);
  }
  const [whole, frac = ""] = percent.trim().split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function bpsToPercentString(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps < 0) throw new Error("Invalid bps");
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, "0");
  return frac === "00" ? `${whole}` : `${whole}.${frac}`;
}

/**
 * Split an amount (smallest unit, bigint) across buckets. Each bucket gets
 * floor(amount * bps / 10000); the remainder (dust) goes to the protocol
 * bucket so the parts always sum to the input. Deterministic and documented
 * so on-chain logic can mirror it exactly.
 */
export function splitAmount(amount: bigint, split: FeeSplitBps): Record<FeeBucket, bigint> {
  assertValidFeeSplit(split);
  if (amount < 0n) throw new Error("Negative amount");
  const out = {} as Record<FeeBucket, bigint>;
  let allocated = 0n;
  for (const b of FEE_BUCKETS) {
    out[b] = (amount * BigInt(split[b])) / BigInt(TOTAL_BPS);
    allocated += out[b];
  }
  out.protocol += amount - allocated;
  return out;
}

/** Governance label shown in UI. Must reflect actual contract behavior. */
export type SplitMutability = "IMMUTABLE" | "ADMIN_CONTROLLED";
