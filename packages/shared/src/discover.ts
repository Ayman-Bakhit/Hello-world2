import { splitAmount } from "./feesplit";
import type { DiscoverQuery } from "./api/schemas";
import { DEMO_TOKENS, TRANSPARENCY_CHECK_KEYS, type DemoToken } from "./demo/fixtures";

/** Pure filter + sort over a token list. Ranks only on the real fields supplied; invents nothing. */

export const checksReported = (t: DemoToken) => Object.values(t.checks).filter(Boolean).length;
export const allChecksReported = (t: DemoToken) => checksReported(t) === TRANSPARENCY_CHECK_KEYS.length;
export const charityGeneratedCents = (t: DemoToken) => splitAmount(t.lifetimeFeesCents, t.feeSplit).charity;

const usd = (whole: string) => BigInt(whole) * 100n;
const cmp = <T>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

export const SORT_RULES: Record<DiscoverQuery["sort"], string> = {
  volume: "24h traded volume, high to low.",
  liquidity: "Disclosed pool liquidity, high to low.",
  holders: "Holder count, high to low. Count alone says nothing about distribution.",
  marketCap: "Market capitalization, high to low.",
  newest: "Launch date, newest first.",
  trending: "7-day change in traded volume. No wash-trade filtering exists yet, so this ranking is unfiltered.",
  charity: "Lifetime fees routed to the charity bucket, high to low.",
  lowestCreatorConcentration: "Creator-held share of supply, low to high.",
};

export function discoverTokens(tokens: DemoToken[], q: DiscoverQuery): { items: DemoToken[]; total: number } {
  let r = tokens.filter((t) => {
    if (q.minMarketCap && t.marketCapCents < usd(q.minMarketCap)) return false;
    if (q.maxMarketCap && t.marketCapCents > usd(q.maxMarketCap)) return false;
    if (q.minLiquidity && t.liquidityCents < usd(q.minLiquidity)) return false;
    if (q.minVolume && t.volume24hCents < usd(q.minVolume)) return false;
    if (q.minHolders !== undefined && t.holders < q.minHolders) return false;
    if (q.verifiedTransparency === "true" && !allChecksReported(t)) return false;
    if (q.verifiedTransparency === "false" && allChecksReported(t)) return false;
    return true;
  });
  const key: Record<DiscoverQuery["sort"], (a: DemoToken, b: DemoToken) => number> = {
    volume: (a, b) => cmp(b.volume24hCents, a.volume24hCents),
    liquidity: (a, b) => cmp(b.liquidityCents, a.liquidityCents),
    holders: (a, b) => cmp(b.holders, a.holders),
    marketCap: (a, b) => cmp(b.marketCapCents, a.marketCapCents),
    newest: (a, b) => cmp(Date.parse(b.launchedAt), Date.parse(a.launchedAt)),
    trending: (a, b) => cmp(b.volume7dChangeBps, a.volume7dChangeBps),
    charity: (a, b) => cmp(charityGeneratedCents(b), charityGeneratedCents(a)),
    lowestCreatorConcentration: (a, b) => cmp(a.creatorAllocationBps, b.creatorAllocationBps),
  };
  r = [...r].sort((a, b) => key[q.sort](a, b) || a.symbol.localeCompare(b.symbol));
  return { items: r.slice(q.offset, q.offset + q.limit), total: r.length };
}

export { DEMO_TOKENS };
