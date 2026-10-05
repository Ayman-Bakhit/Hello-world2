import { tokenCharityGeneratedCents, tokenChecksPassed } from "@/mock/tokens";
import type { Token } from "@/lib/types";

/** Fixed reference date so the demo is deterministic. A real build uses the current time. */
export const DEMO_REFERENCE_DATE = "2026-10-05T00:00:00Z";
const NEW_WINDOW_DAYS = 14;

export type FilterId =
  | "new" | "trending" | "volume" | "liquidity" | "holders" | "charity" | "concentration" | "recent" | "verified";

export interface DiscoverFilter {
  id: FilterId;
  label: string;
  /** Public ranking rule, shown in the UI. No hidden weighting. */
  rule: string;
  apply: (tokens: Token[]) => Token[];
}

const desc = <T,>(f: (t: Token) => T) => (a: Token, b: Token) => (f(a) < f(b) ? 1 : f(a) > f(b) ? -1 : 0);
const asc = <T,>(f: (t: Token) => T) => (a: Token, b: Token) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);
const ms = (iso: string) => Date.parse(iso);

export const FILTERS: DiscoverFilter[] = [
  {
    id: "new", label: "New",
    rule: `Launched within the last ${NEW_WINDOW_DAYS} days, newest first.`,
    apply: (t) => t.filter((x) => ms(DEMO_REFERENCE_DATE) - ms(x.launchedAt) <= NEW_WINDOW_DAYS * 86_400_000).sort(desc((x) => ms(x.launchedAt))),
  },
  {
    id: "trending", label: "Trending",
    rule: "Ranked by 7-day change in traded volume. Wash-trade filtering is not implemented in this demo, so treat as unfiltered.",
    apply: (t) => [...t].sort(desc((x) => x.volume7dChangeBps)),
  },
  { id: "volume", label: "Highest Volume", rule: "24h traded volume, high to low.", apply: (t) => [...t].sort(desc((x) => x.volume24hCents)) },
  { id: "liquidity", label: "Highest Liquidity", rule: "Disclosed pool liquidity, high to low.", apply: (t) => [...t].sort(desc((x) => x.liquidityCents)) },
  { id: "holders", label: "Most Holders", rule: "Holder count, high to low. Count alone says nothing about distribution.", apply: (t) => [...t].sort(desc((x) => x.holders)) },
  { id: "charity", label: "Most Charity Generated", rule: "Lifetime fees routed to the charity bucket, high to low.", apply: (t) => [...t].sort(desc(tokenCharityGeneratedCents)) },
  { id: "concentration", label: "Lowest Creator Concentration", rule: "Creator-held share of supply, low to high.", apply: (t) => [...t].sort(asc((x) => x.creatorAllocationBps)) },
  { id: "recent", label: "Recently Launched", rule: "Launch date, newest first.", apply: (t) => [...t].sort(desc((x) => ms(x.launchedAt))) },
  {
    id: "verified", label: "Verified Transparency",
    rule: "Demo: tokens reporting all 9 disclosure checks. A real VERIFIED TRANSPARENCY badge will require each check to be confirmed on-chain, which is not connected yet. It is about disclosure, not safety.",
    apply: (t) => t.filter((x) => tokenChecksPassed(x) === 9).sort(desc((x) => x.liquidityCents)),
  },
];

export const TOTAL_CHECKS = 9;
