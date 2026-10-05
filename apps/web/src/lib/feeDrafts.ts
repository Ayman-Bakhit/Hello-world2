import {
  FEE_BUCKETS,
  TOTAL_BPS,
  bpsToPercentString,
  percentToBps,
  splitAmount,
  validateFeeSplit,
  type FeeBucket,
  type FeeSplitBps,
} from "@project-name/shared";

export const BUCKET_LABEL: Record<FeeBucket, string> = {
  creator: "Creator",
  taxReserve: "Tax Reserve",
  charity: "Charity",
  protocol: "Protocol",
};

export type FeeDrafts = Record<FeeBucket, string>;

export interface FeeDraftResult {
  /** non-null only when every draft parsed AND the shared validator accepts the split */
  split: FeeSplitBps | null;
  /** sum of parsed buckets, null if any draft failed to parse */
  totalBps: number | null;
  messages: string[];
}

/** All math is delegated to @project-name/shared; this only maps UI text to bps and error text. */
export function parseFeeDrafts(drafts: FeeDrafts): FeeDraftResult {
  const parsed: Partial<FeeSplitBps> = {};
  const messages: string[] = [];
  for (const b of FEE_BUCKETS) {
    try {
      parsed[b] = percentToBps(drafts[b]);
    } catch {
      messages.push(`${BUCKET_LABEL[b]}: enter a percent from 0 to 100 with at most 2 decimals.`);
    }
  }
  if (messages.length > 0) return { split: null, totalBps: null, messages };

  const split = parsed as FeeSplitBps;
  const total = FEE_BUCKETS.reduce((s, b) => s + split[b], 0);
  const errors = validateFeeSplit(split);
  for (const e of errors) {
    if (e.code === "SUM_MISMATCH") {
      const diff = Math.abs(TOTAL_BPS - e.sum);
      messages.push(
        `Total is ${bpsToPercentString(e.sum)}% (${e.sum} bps). It must be exactly 100% (${TOTAL_BPS} bps). ` +
          `${e.sum > TOTAL_BPS ? "Remove" : "Add"} ${bpsToPercentString(diff)}%.`,
      );
    } else {
      messages.push(`${BUCKET_LABEL[e.bucket]}: invalid value (${e.code}).`);
    }
  }
  return { split: errors.length === 0 ? split : null, totalBps: total, messages };
}

export function draftsFromSplit(split: FeeSplitBps): FeeDrafts {
  return {
    creator: bpsToPercentString(split.creator),
    taxReserve: bpsToPercentString(split.taxReserve),
    charity: bpsToPercentString(split.charity),
    protocol: bpsToPercentString(split.protocol),
  };
}

/** Example distribution of a $1,000.00 fee, using the shared splitAmount. */
export function sampleDistribution(split: FeeSplitBps): Record<FeeBucket, bigint> {
  return splitAmount(100_000n, split);
}

export const BUCKET_COLOR: Record<FeeBucket, string> = {
  creator: "bg-b-creator",
  taxReserve: "bg-b-tax",
  charity: "bg-b-charity",
  protocol: "bg-b-protocol",
};
