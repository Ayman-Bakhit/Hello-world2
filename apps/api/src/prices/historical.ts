import type { PriceAt, PriceQuote } from "@project-name/shared";
import type { Pool } from "../db/pool";

/**
 * Historical USD prices for tax. REPLACEABLE: the tax service only sees `PriceAt` (a pure lookup).
 * Rules every provider follows: a price is "latest observation at or BEFORE the time, no older than maxAge" (no
 * look-ahead); a missing price is null, never zero; the source and observation time travel with the number.
 */
export interface HistoricalPriceProvider {
  readonly name: string;
  /** Loads what is needed for the given assets once, then answers lookups synchronously. */
  loadSeries(assets: string[]): Promise<PriceAt>;
}

export interface PricePoint {
  asset: string;
  /** unix seconds */
  observedAt: number;
  priceMicroUsd: bigint;
  source: string;
  confidence: "FIXTURE" | "OBSERVED";
}

export function pointLookup(points: PricePoint[], maxAgeSeconds: number): PriceAt {
  const byAsset = new Map<string, PricePoint[]>();
  for (const p of points) if (p.priceMicroUsd > 0n) byAsset.set(p.asset, [...(byAsset.get(p.asset) ?? []), p]);
  for (const list of byAsset.values()) list.sort((a, b) => a.observedAt - b.observedAt);
  return (asset, at): PriceQuote | null => {
    const list = byAsset.get(asset);
    if (!list) return null;
    let best: PricePoint | null = null;
    for (const p of list) {
      if (p.observedAt > at) break;
      best = p;
    }
    if (!best || at - best.observedAt > maxAgeSeconds) return null;
    return { asset, priceMicroUsd: best.priceMicroUsd, observedAt: best.observedAt, source: best.source, confidence: best.confidence };
  };
}

/** No price source: every lookup is "price unavailable". */
export class NoHistoricalPrices implements HistoricalPriceProvider {
  readonly name = "none";
  async loadSeries(): Promise<PriceAt> {
    return () => null;
  }
}

/** Deterministic fixture prices for tests and demos. Labeled FIXTURE all the way to the response. */
export class FixtureHistoricalPriceProvider implements HistoricalPriceProvider {
  readonly name = "fixture";
  constructor(private readonly points: Omit<PricePoint, "confidence" | "source">[], private readonly maxAgeSeconds = 3600, private readonly source = "fixture") {}
  async loadSeries(assets: string[]): Promise<PriceAt> {
    const set = new Set(assets);
    return pointLookup(this.points.filter((p) => set.has(p.asset)).map((p) => ({ ...p, source: this.source, confidence: "FIXTURE" as const })), this.maxAgeSeconds);
  }
}

/**
 * Reads `price_observations` (what the indexer stored from a configured price provider). Those are SPOT observations
 * taken at sync time, so a transaction only gets a price if one was observed shortly before it. That is deliberately
 * strict: most historical transactions will have no price until a real historical source exists.
 */
export class ObservationHistoricalPriceProvider implements HistoricalPriceProvider {
  readonly name = "price_observations";
  constructor(private readonly pool: Pool, private readonly maxAgeSeconds: number) {}
  async loadSeries(assets: string[]): Promise<PriceAt> {
    if (assets.length === 0) return () => null;
    const r = await this.pool.query(
      `SELECT a.address, extract(epoch from p.observed_at)::bigint AS at, p.price_micro_usd, p.provider, p.confidence
       FROM price_observations p JOIN assets a ON a.id = p.asset_id
       WHERE a.chain = 'solana' AND a.address = ANY($1::text[]) AND p.price_micro_usd > 0`,
      [assets],
    );
    return pointLookup(
      r.rows.map((x) => ({
        asset: x.address as string, observedAt: Number(x.at), priceMicroUsd: BigInt(x.price_micro_usd), source: x.provider as string,
        confidence: x.confidence === "fixture" ? ("FIXTURE" as const) : ("OBSERVED" as const),
      })),
      this.maxAgeSeconds,
    );
  }
}
