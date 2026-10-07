import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import {
  DEMO_IDS, DEMO_WALLETS, DiscoverQuery, NO_LIVE_DATA, buildCharityList, buildDiscover, buildDonations, buildPortfolio, buildTax,
  buildTaxDetails, buildTaxReserve, buildTokenProof, buildTransactions, LaunchConfigSchema, type PortfolioResponse, type SyncStatusResponse, type TaxDetailsResponse, type TaxResponse, type TokenProof, type TransactionsResponse,
} from "@project-name/shared";
import { describe, expect, it } from "vitest";
import { charityFromApi } from "@/lib/adapters";
import { ApiClientError } from "@/lib/api/http";
import { describeApiError } from "@/lib/api/errors";
import type { Resource } from "@/lib/api/useResource";
import { createApiClient } from "@/lib/api/client";
import { DEFAULT_LAUNCH_CONFIG } from "@/mock";
import { stepErrors, toLaunchRequest, type StepContext } from "@/lib/launch";
import { walletGate } from "@/lib/useScopedWallet";
import { transparencyBadge } from "@/lib/transparency";
import { WalletContext } from "@/state/wallet";
import { makeWalletValue } from "@/state/testing";
import { AuthStatusPill, authStatusLabel } from "../AuthStatusPill";
import { LaunchListView } from "../LaunchList";
import { LaunchSummary } from "../PrepareLaunchPanel";
import { ApiErrorState, LoadingState, NoLiveData, ResourceView, UnauthenticatedState, UnavailableState } from "../states";
import { WalletMenu } from "../WalletMenu";
import { DISCOVER_FILTERS, DiscoverResults } from "./DiscoverScreen";
import { CharityDirectory, DonationHistory, donationStatusView } from "./GiveScreen";
import { SyncPanel } from "../SyncPanel";
import { PortfolioView, TransactionsSection } from "./PortfolioScreen";
import { TaxReserveView } from "./TaxReserveScreen";
import { TaxView } from "./TaxScreen";
import { TokenProofView } from "./TokenProofScreen";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const W = DEMO_IDS.wallets.trading;
const withWallet = (over: Parameters<typeof makeWalletValue>[0], el: ReactElement) => html(<WalletContext.Provider value={makeWalletValue(over)}>{el}</WalletContext.Provider>);
const res = <T,>(r: Resource<T>): Resource<T> & { reload: () => void } => ({ ...r, reload: () => undefined });
const apiErr = (status: number, code: string) => describeApiError(new ApiClientError(status, code, "m"));

describe("session / authentication display", () => {
  const ADDR = "5Kp4FZEgwGQf3RYiLXXtPPsLC8HBcqU2NgMig8c3cCwt";
  it("DISCONNECTED -> CONNECT WALLET, no address", () => {
    const out = withWallet({}, <WalletMenu />);
    expect(out).toContain("CONNECT WALLET");
    expect(out).not.toContain("AUTHENTICATED");
  });
  it("CONNECTED is never shown as AUTHENTICATED", () => {
    const out = withWallet({ status: "connected", connected: true, address: ADDR, walletName: "Phantom" }, <WalletMenu />);
    expect(out).toContain("CONNECTED");
    expect(out).toContain("5Kp4…CwCt".replace("CwCt", "3cCwt".slice(-4)));
    expect(out).not.toContain("AUTHENTICATED");
  });
  it("AUTHENTICATED shows the authenticated wallet, abbreviated", () => {
    const out = withWallet({ status: "authenticated", connected: true, authenticated: true, ready: true, address: ADDR, authenticatedAddress: ADDR }, <WalletMenu />);
    expect(out).toContain("AUTHENTICATED");
    expect(out).toContain("5Kp4…cCwt");
    expect(out).not.toContain(ADDR); // full address is not dumped into the shell
  });
  it("authenticated via cookie even when the extension is not connected", () => {
    const out = withWallet({ status: "authenticated", authenticated: true, ready: true, authenticatedAddress: ADDR, connected: false }, <WalletMenu />);
    expect(out).toContain("AUTHENTICATED");
  });
  it("status pill labels: the three explicit states; mock mode never says AUTHENTICATED", () => {
    expect(authStatusLabel({ mode: "api", connected: false, authenticated: false }).label).toBe("DISCONNECTED");
    expect(authStatusLabel({ mode: "api", connected: true, authenticated: false }).label).toBe("CONNECTED");
    expect(authStatusLabel({ mode: "api", connected: true, authenticated: true }).label).toBe("AUTHENTICATED");
    expect(authStatusLabel({ mode: "mock", connected: true, authenticated: false }).label).toBe("CONNECTED · DEMO");
    expect(withWallet({ authenticated: true, connected: true }, <AuthStatusPill />)).toContain("AUTHENTICATED");
    expect(withWallet({}, <AuthStatusPill />)).toContain("DISCONNECTED");
  });
  it("screens wait for the session check, then require authentication in api mode; mock mode is always ready", () => {
    expect(walletGate("api", false, false)).toBe("checking");
    expect(walletGate("api", true, false)).toBe("unauthenticated");
    expect(walletGate("api", true, true)).toBe("ready");
    expect(walletGate("mock", false, false)).toBe("ready");
  });
});

describe("reusable states", () => {
  it("loading, unauthenticated, unavailable, no-live-data render useful text", () => {
    expect(html(<LoadingState label="Loading portfolio" />)).toContain("Loading portfolio");
    const u = html(<UnauthenticatedState onConnect={() => undefined} />);
    expect(u).toContain("AUTHENTICATION REQUIRED");
    expect(u).toContain("CONNECT WALLET");
    expect(html(<UnavailableState message="x" />)).toContain("FEATURE COMING SOON");
    expect(html(<NoLiveData />)).toContain("NO LIVE DATA YET");
  });
  it("API error state shows safe text only, plus field messages for validation, and a retry only when retryable", () => {
    const v = describeApiError(new ApiClientError(400, "VALIDATION_ERROR", "x", { feeSplit: ["must total 10000"] }));
    expect(html(<ApiErrorState error={v} onRetry={() => undefined} />)).toContain("feeSplit: must total 10000");
    expect(html(<ApiErrorState error={v} onRetry={() => undefined} />)).not.toContain("RETRY");
    const r = describeApiError(new ApiClientError(429, "RATE_LIMITED", "x"));
    expect(html(<ApiErrorState error={r} onRetry={() => undefined} />)).toContain("RATE LIMITED");
    expect(html(<ApiErrorState error={r} onRetry={() => undefined} />)).toContain("RETRY");
    const s = describeApiError(new ApiClientError(500, "INTERNAL_ERROR", "stack at /srv/x.ts"));
    expect(html(<ApiErrorState error={s} />)).not.toContain("/srv/x.ts");
  });
  it("ResourceView: loading, 401, no-live-data, 404, 500, ok", () => {
    const render = (r: Resource<string>) => withWallet({}, <ResourceView resource={res(r)} noData={<NoLiveData title="NO LIVE PORTFOLIO DATA YET" />}>{(d) => <p>DATA:{d}</p>}</ResourceView>);
    expect(render({ status: "loading" })).toContain("aria-busy");
    expect(render({ status: "error", error: apiErr(401, "UNAUTHENTICATED") })).toContain("AUTHENTICATION REQUIRED");
    expect(render({ status: "error", error: apiErr(404, NO_LIVE_DATA) })).toContain("NO LIVE PORTFOLIO DATA YET");
    expect(render({ status: "error", error: apiErr(404, "NOT_FOUND") })).toContain("NOT FOUND");
    expect(render({ status: "error", error: apiErr(500, "INTERNAL_ERROR") })).toContain("TEMPORARILY UNAVAILABLE");
    expect(render({ status: "ok", data: "x" })).toContain("DATA:x");
  });
});

describe("portfolio and transactions: demo vs empty", () => {
  it("demo portfolio is labeled DEMO DATA with the demo-account explanation, and shows API numbers", () => {
    const p = buildPortfolio(W)!;
    const out = html(<PortfolioView portfolio={p} extras={{ tax: null, reserve: null, donations: null, walletCount: 3 }} />);
    expect(out).toContain("DEMO DATA");
    expect(out).toContain("belong to the demo account, not to any real wallet");
    expect(out).toContain("$34,235.00");
    expect(out).toContain("SOL");
    expect(out).toContain("—"); // missing extras are dashes, not guesses
    expect(out).not.toContain("LIVE DATA");
  });
  it("an authenticated wallet with no indexed data gets the empty state and none of the demo balances", () => {
    const out = withWallet({ authenticated: true, ready: true }, (
      <ResourceView resource={res({ status: "error", error: apiErr(404, NO_LIVE_DATA) })} noData={<NoLiveData title="NO LIVE PORTFOLIO DATA YET" message="Your wallet is authenticated, but nothing has been read from the blockchain for it yet. Press SYNC WALLET." />}>
        {() => <PortfolioView portfolio={buildPortfolio(W)!} extras={{ tax: null, reserve: null, donations: null, walletCount: 1 }} />}
      </ResourceView>
    ));
    expect(out).toContain("NO LIVE PORTFOLIO DATA YET");
    expect(out).toContain("Your wallet is authenticated, but nothing has been read from the blockchain for it yet. Press SYNC WALLET.");
    for (const demo of ["DEMO DATA", "$34,235", "BONK", "JUP", "SOL"]) expect(out, demo).not.toContain(demo);
  });
  it("demo transactions are labeled and use placeholder signatures; empty list says so", () => {
    const t = buildTransactions(W, 5, 0)!;
    const out = html(<TransactionsSection data={t} walletLabel="Trading" />);
    expect(out).toContain("DEMO DATA");
    expect(out).toContain("DEMO-SIG-");
    expect(out).not.toMatch(/solscan|explorer\.solana/i);
    const empty = html(<TransactionsSection data={{ ...t, transactions: [], dataSource: "database", pagination: { ...t.pagination, total: 0 } }} walletLabel="Trading" />);
    expect(empty).toContain("No transactions for this wallet.");
    expect(empty).not.toContain("DEMO DATA");
  });
});

describe("tax and tax reserve", () => {
  it("tax view uses qualified language, shows API disclaimer, labels demo, never says tax bill", () => {
    const out = html(<TaxView tax={buildTax(W)} reserve={buildTaxReserve(W, null, "demo")} details={buildTaxDetails(W)} />);
    for (const s of ["Estimated tax exposure", "Estimated realized gains", "Estimated realized losses", "Tax planning estimate", "Estimated tax reserve", "DEMO DATA", "$18,420", "qualified tax professional", "not a tax bill"]) expect(out, s).toContain(s);
    expect(out.toLowerCase()).not.toMatch(/your tax bill|guaranteed|loophole/);
  });
  it("tax view without reserve data shows dashes instead of inventing a reserve", () => {
    const out = html(<TaxView tax={buildTax(W)} reserve={null} details={null} />);
    expect(out).toContain("No live reserve data");
  });
  it("reserve screen: ADD FUNDS and WITHDRAW are disabled and marked unavailable; no signing UI; target is a stored setting", () => {
    const d = buildTaxReserve(W, { targetType: "percentage", percentBps: 3000, targetCents: null, updatedAt: "2026-01-01T00:00:00.000Z" }, "database");
    const out = html(<TaxReserveView data={d} onSave={() => undefined} saving={false} saveError={null} savedNotice={false} />);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>ADD FUNDS/);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>WITHDRAW/);
    expect(out).toContain("UNAVAILABLE");
    expect(out).toContain("No transaction can be created or signed here");
    expect(out).toContain("STORED, NO FUNDS MOVE");
    expect(out).toContain("30% of realized gains");
    expect(out).not.toContain("WHAT YOU ARE SIGNING");
    expect(out).toContain("DEMO DATA"); // balance is a fixture
  });
  it("reserve target save errors render as field messages", () => {
    const err = describeApiError(new ApiClientError(400, "VALIDATION_ERROR", "x", { targetPercentage: ["must be a percent above 0 and at most 100 with at most 2 decimals"] }));
    const out = html(<TaxReserveView data={buildTaxReserve(W, null, "demo")} onSave={() => undefined} saving={false} saveError={err} savedNotice={false} />);
    expect(out).toContain("targetPercentage: must be a percent above 0");
  });
});

describe("give: charity information vs actual donation", () => {
  const charities = buildCharityList().map(charityFromApi);
  it("verification and demo status come from the API record", () => {
    const out = html(<CharityDirectory charities={charities} donations={null} />);
    expect(out).toContain("VERIFIED (FIXTURE, NOT REAL-WORLD)");
    expect(out).toContain("PENDING REVIEW");
    expect(out).toContain("not a real-world verification");
    expect(out).toContain("Verification status");
    expect(out).toContain("Verification source");
    expect(out).toContain("Last reviewed");
    expect(out).toContain("Evidence");
  });
  it("a charity is only 'VERIFIED' if the API says so AND a wallet is verified", () => {
    const base = buildCharityList()[0]!;
    expect(charityFromApi({ ...base, wallets: base.wallets.map((w) => ({ ...w, verificationStatus: "pending" as const })) }).verification).toBe("PENDING_REVIEW");
    expect(charityFromApi({ ...base, verificationState: "SUSPENDED" }).verification).toBe("SUSPENDED");
    expect(charityFromApi({ ...base, dataSource: "database", verificationSource: "ADMIN_REVIEW" }).verificationNote).toMatch(/not a guarantee/);
    expect(charityFromApi(base).verificationNote).toMatch(/not a real-world verification/);
  });
  it("demo donations are DEMO RECORDS, not on-chain, and confirmed total stays $0", () => {
    const d = buildDonations(W)!;
    const out = html(<DonationHistory data={d} charities={charities} />);
    expect(out).toContain("DEMO DATA");
    expect(out).toContain("DEMO RECORD · NOT ON-CHAIN");
    expect(out).not.toContain("CONFIRMED ON-CHAIN");
    expect(out).toContain("$0"); // confirmed total
    expect(html(<CharityDirectory charities={charities} donations={d} />)).toContain("Demo records");
  });
  it("empty donations -> NO DONATIONS YET, no filler", () => {
    const empty = { ...buildDonations(W)!, donations: [], demoTotalCents: "0", dataSource: "database" as const };
    const out = html(<DonationHistory data={empty} charities={charities} />);
    expect(out).toContain("NO DONATIONS YET");
    expect(out).not.toContain("DEMO DATA");
    expect(out).not.toContain("DEMO RECORD");
  });
  it("status wording: only 'confirmed' claims on-chain", () => {
    expect(donationStatusView("confirmed").label).toBe("CONFIRMED ON-CHAIN");
    for (const s of ["demo", "pending", "failed"] as const) expect(donationStatusView(s).label).not.toBe("CONFIRMED ON-CHAIN");
  });
});

describe("launch: preparation only", () => {
  const creator = DEMO_WALLETS[1]!.address;
  const ctx: StepContext = { walletConnected: true, verifiedCharityIds: [DEMO_IDS.charities.c1], walletIds: ["w2"] };
  const filled = { ...DEFAULT_LAUNCH_CONFIG, name: "Example", symbol: "EXMPL" };

  it("wizard state maps to a valid API request; the fee split is the shared validator's", () => {
    const req = toLaunchRequest(filled, { creatorAddress: creator, reserveAddress: creator, charityId: DEMO_IDS.charities.c1 });
    expect(LaunchConfigSchema.safeParse(req).success).toBe(true);
    expect(req.feeSplit).toEqual({ creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 });
    expect(req.decimals).toBe(6);
    expect(() => toLaunchRequest({ ...filled, feeDrafts: { ...filled.feeDrafts, creator: "60.01" } }, { creatorAddress: creator, reserveAddress: creator, charityId: "x" })).toThrow();
  });
  it("default charity means 'first verified'; an explicit unverified charity is an error", () => {
    expect(stepErrors("charity", filled, ctx)).toEqual([]);
    expect(stepErrors("charity", { ...filled, charityId: DEMO_IDS.charities.c4 }, ctx)).toHaveLength(1);
  });
  it("saved launch summary says NOT DEPLOYED, not deployable, 'Configured fee split', and never 'immutable'", async () => {
    const c = createApiClient({ mode: "mock" });
    const l = await c.createLaunch(toLaunchRequest(filled, { creatorAddress: creator, reserveAddress: creator, charityId: DEMO_IDS.charities.c1 }));
    const reviewed = await c.reviewLaunch(l.id);
    const out = html(<LaunchSummary launch={reviewed} />);
    for (const s of ["NOT DEPLOYED", "REVIEW PASSED", "Configured fee split", "Deployable: no", "no token, liquidity, contract, or fee routing exists", "DEMO DATA"]) expect(out, s).toContain(s);
    expect(out.toLowerCase()).not.toContain("immutable");
    expect(html(<LaunchSummary launch={l} />)).toContain("Not reviewed yet.");
  });
  it("failed review shows server errors", async () => {
    const c = createApiClient({ mode: "mock" });
    const l = await c.createLaunch(toLaunchRequest(filled, { creatorAddress: creator, reserveAddress: creator, charityId: DEMO_IDS.charities.c4 }));
    const out = html(<LaunchSummary launch={await c.reviewLaunch(l.id)} />);
    expect(out).toContain("REVIEW FAILED");
    expect(out).toContain("Charity is not verified");
  });
  it("empty launch list is an empty state", () => {
    expect(html(<LaunchListView launches={[]} openId={null} onToggle={() => undefined} />)).toContain("NO SAVED CONFIGURATIONS");
  });
});

describe("token proof: verification state comes from the API", () => {
  it("demo token: DEMO DATA banner, no 'VERIFIED TRANSPARENCY', no contract claim", () => {
    const proof = buildTokenProof("demo")!;
    const out = html(<TokenProofView proof={proof} summary={null} />);
    expect(out).toContain("BLOCKCHAIN VERIFICATION NOT YET CONNECTED");
    expect(out).toContain("DEMO DATA");
    expect(out).toContain("FICTIONAL TOKEN");
    expect(out).toContain("ALL 9 CHECKS REPORTED · DEMO");
    expect(out).not.toContain("VERIFIED TRANSPARENCY");
    expect(out).toContain("Not deployed. This is a demo token.");
    expect(out).toContain("Configured fee split");
    expect(out).toContain("NOT VERIFIED ON-CHAIN");
    expect(out.toLowerCase()).not.toMatch(/immutable|"safe"|anti-rug/);
  });
  it("VERIFIED TRANSPARENCY appears only when the API reports verifiedOnChain (synthetic proof)", () => {
    const live: TokenProof = { ...buildTokenProof("demo")!, verifiedOnChain: true, dataSource: "chain" };
    const out = html(<TokenProofView proof={live} summary={null} />);
    expect(out).toContain("VERIFIED TRANSPARENCY");
    expect(out).toContain("LIVE DATA");
    expect(out).not.toContain("BLOCKCHAIN VERIFICATION NOT YET CONNECTED");
    // reported-but-not-verified never earns the badge, whatever the check count is
    expect(transparencyBadge({ reported: 9, total: 9, verifiedOnChain: false, dataSource: "demo" }).label).toBe("ALL 9 CHECKS REPORTED · DEMO");
    expect(transparencyBadge({ reported: 4, total: 9, verifiedOnChain: true, dataSource: "chain" }).label).toBe("4/9 CHECKS REPORTED");
  });
});

describe("discover", () => {
  it("every UI filter maps to valid API parameters", () => {
    expect(DISCOVER_FILTERS.map((f) => f.label)).toEqual(["New", "Trending", "Highest Volume", "Highest Liquidity", "Most Holders", "Most Charity Generated", "Lowest Creator Concentration", "Recently Launched", "Verified Transparency"]);
    for (const f of DISCOVER_FILTERS) {
      const q = { ...f.params, verifiedTransparency: f.params.verifiedTransparency === undefined ? undefined : String(f.params.verifiedTransparency) };
      expect(DiscoverQuery.safeParse(q).success, f.id).toBe(true);
    }
  });
  it("filters return the API's own ranking (no client-side re-ranking)", async () => {
    const c = createApiClient({ mode: "mock" });
    const first = async (id: string) => (await c.getDiscover(DISCOVER_FILTERS.find((f) => f.id === id)!.params)).tokens.map((t) => t.symbol);
    expect(await first("new")).toEqual(["LNTN", "FNDM"]);
    expect((await first("verified")).sort()).toEqual(["HRBR", "ORCH"]);
    expect((await first("volume"))[0]).toBe("ORCH");
    expect((await first("concentration"))[0]).toBe("ORCH");
    expect((await first("charity"))[0]).toBe("ORCH");
  });
  it("results are labeled demo with the ranking rule and no fake social proof; empty results say so", () => {
    const d = buildDiscover(DiscoverQuery.parse({ sort: "trending" }));
    const out = html(<DiscoverResults data={d} />);
    expect(out).toContain("Ranking rule:");
    expect(out).toContain("unfiltered");
    expect(out).toContain("DEMO DATA");
    expect(out).not.toContain("VERIFIED TRANSPARENCY");
    expect(out.toLowerCase()).not.toMatch(/followers|likes|trending now|🔥|🚀/);
    const empty = html(<DiscoverResults data={{ ...d, tokens: [] }} />);
    expect(empty).toContain("NO TOKENS MATCH");
  });
});

// ---------- live (indexed) data ----------
const MINT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const livePortfolio = (over: Partial<PortfolioResponse> = {}, price: { micro: string; cents: string } | null = null): PortfolioResponse => ({
  walletId: DEMO_IDS.wallets.trading, totalValueCents: null, partialValueCents: null, costBasisCents: null, realizedPnlCents: null, unrealizedPnlCents: null,
  valuation: { status: "unavailable", pricedAssets: 0, unpricedAssets: 2 },
  source: { kind: "solana_rpc", cluster: "devnet", slot: 123, observedAt: "2026-10-06T00:00:00.000Z", lastSyncedAt: "2026-10-06T00:00:00.000Z", holdingsComplete: true },
  assets: [
    { kind: "native", mint: null, symbol: "SOL", name: "Solana", decimals: 9, balance: "2500000000", quantity: "2.5", tokenAccounts: 0,
      priceMicroUsd: price?.micro ?? null, valuation: price ? "priced" : "price_unavailable", price: price ? { source: "fake", observedAt: "2026-10-06T00:00:00.000Z" } : null,
      valueCents: price?.cents ?? null, costBasisCents: null, unrealizedPnlCents: null, realizedPnlCents: null, allocationBps: null, isFictionalToken: false,
      metadata: { status: "not_applicable", name: null, symbol: null, uri: null, source: null, verified: false }, observedSlot: 123, observedAt: "2026-10-06T00:00:00.000Z" },
    { kind: "spl", mint: MINT, symbol: null, name: null, decimals: 6, balance: "1234567", quantity: "1.234567", tokenAccounts: 1,
      priceMicroUsd: null, valuation: "price_unavailable", price: null, valueCents: null, costBasisCents: null, unrealizedPnlCents: null, realizedPnlCents: null, allocationBps: null, isFictionalToken: false,
      metadata: { status: "resolved", name: "<img src=x onerror=alert(1)>", symbol: "USDC", uri: null, source: "metaplex_onchain", verified: false }, observedSlot: 123, observedAt: "2026-10-06T00:00:00.000Z" },
  ],
  dataSource: "chain", verifiedOnChain: false, ...over,
});
const noExtras = { tax: null, reserve: null, donations: null, walletCount: 1 };

describe("live portfolio view", () => {
  it("LIVE DATA label; no price means PRICE DATA UNAVAILABLE (never $0); balances are on-chain", () => {
    const out = html(<PortfolioView portfolio={livePortfolio()} extras={noExtras} />);
    expect(out).toContain("LIVE DATA");
    expect(out).toContain("PRICE DATA UNAVAILABLE");
    expect(out).toContain("PRICE UNAVAILABLE");
    expect(out).toContain("2.5");
    expect(out).not.toContain("$0.00");
    expect(out).not.toContain("DEMO DATA");
    expect(out).not.toMatch(/BONK|JUP|HRBR|FICTIONAL/);
  });
  it("SPL tokens are identified by mint; untrusted metadata is escaped, labeled UNVERIFIED, and never shown as the identity", () => {
    const out = html(<PortfolioView portfolio={livePortfolio()} extras={noExtras} />);
    expect(out).toContain("9xQe…VFin");
    expect(out).toContain("UNVERIFIED METADATA");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
  it("token without metadata shows METADATA UNAVAILABLE", () => {
    const p = livePortfolio();
    p.assets[1]!.metadata = { status: "unavailable", name: null, symbol: null, uri: null, source: null, verified: false };
    expect(html(<PortfolioView portfolio={p} extras={noExtras} />)).toContain("METADATA UNAVAILABLE");
  });
  it("partial pricing: partial sum is labeled and is not the total", () => {
    const p = livePortfolio({ partialValueCents: "30000", valuation: { status: "partial", pricedAssets: 1, unpricedAssets: 1 } }, { micro: "150000000", cents: "30000" });
    const out = html(<PortfolioView portfolio={p} extras={noExtras} />);
    expect(out).toContain("Partial: $300.00 from 1 of 2 assets with a price");
    expect(out).toContain("PRICE DATA UNAVAILABLE"); // headline total
    expect(out).toContain("$150.00"); // the SOL price is shown
  });
  it("incomplete holdings: INCOMPLETE warning shown", () => {
    const p = livePortfolio();
    p.source.holdingsComplete = false;
    expect(html(<PortfolioView portfolio={p} extras={noExtras} />)).toContain("INCOMPLETE");
    expect(html(<PortfolioView portfolio={livePortfolio()} extras={noExtras} />)).not.toContain("INCOMPLETE");
  });
  it("empty live wallet", () => {
    const out = html(<PortfolioView portfolio={livePortfolio({ assets: [], totalValueCents: "0", valuation: { status: "complete", pricedAssets: 0, unpricedAssets: 0 } })} extras={noExtras} />);
    expect(out).toContain("holds no SOL or tokens");
    expect(out).toContain("LIVE DATA");
  });
  it("P&L and cost basis are dashes for live wallets (no tax conclusions)", () => {
    const out = html(<PortfolioView portfolio={livePortfolio()} extras={noExtras} />);
    expect(out).toContain("Needs classified transactions");
    expect(out).not.toMatch(/taxable|owed|tax bill/i);
  });
});

describe("live transactions", () => {
  const tx = (over: Partial<TransactionsResponse["transactions"][number]> = {}): TransactionsResponse => ({
    walletId: W, dataSource: "chain", verifiedOnChain: false,
    pagination: { limit: 25, offset: 0, total: 1, nextOffset: null },
    window: { newestSlot: 5, oldestSlot: 5, historyComplete: false, hasGap: true, indexedCount: 1 },
    transactions: [{
      id: "1", signature: "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UNbmiMeFbvk", timestamp: null, type: "unknown",
      asset: "SOL", decimals: 9, amount: "-77", usdValueCents: null, taxTreatment: "not_assessed", source: "chain",
      explorerUrl: "https://explorer.solana.com/tx/5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UNbmiMeFbvk?cluster=devnet",
      status: "failed", feeLamports: "5000", slot: 5, classification: { kind: "unknown", reason: "why", version: "1" }, programIds: [], deltas: [], ...over,
    }],
  });
  it("shows type, FAILED status, fee, explorer link, NOT ASSESSED tax and unknown date/price honestly", () => {
    const out = html(<TransactionsSection data={tx()} walletLabel="Live" />);
    expect(out).toContain("LIVE DATA");
    expect(out).toContain("Unclassified");
    expect(out).toContain("FAILED");
    expect(out).toContain("NOT ASSESSED");
    expect(out).toContain("PRICE UNAVAILABLE");
    expect(out).toContain("Unknown");
    expect(out).toContain('href="https://explorer.solana.com/tx/');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("recent history only");
    expect(out).toContain("may be missing");
    expect(out).not.toMatch(/DEMO/);
  });
  it("refuses an explorer link that is not the Solana explorer", () => {
    const out = html(<TransactionsSection data={tx({ explorerUrl: "https://evil.example/tx/abc" })} walletLabel="Live" />);
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("<a ");
  });
});

describe("sync panel", () => {
  const st = (over: Partial<SyncStatusResponse> = {}): SyncStatusResponse => ({
    walletId: W, state: "never_synced", configured: true, cluster: "devnet", priceProvider: "none",
    limits: { initialTransactionLimit: 50, maxTransactionsPerSync: 100, minSyncIntervalSeconds: 30 }, lastRun: null, lastSuccessAt: null, window: null, nextAllowedAt: null, ...over,
  });
  it("never synced: SYNC WALLET, NO LIVE DATA YET, read-only note", () => {
    const out = html(<SyncPanel status={st()} syncing={false} error={null} onSync={() => undefined} />);
    expect(out).toContain("SYNC WALLET");
    expect(out).toContain("NO LIVE DATA YET");
    expect(out).toContain("nothing is signed or sent");
    expect(out).not.toContain('disabled=""');
  });
  it("syncing: INDEXING WALLET, button disabled and busy", () => {
    const out = html(<SyncPanel status={st({ state: "syncing" })} syncing onSync={() => undefined} error={null} />);
    expect(out).toContain("INDEXING WALLET");
    expect(out).toContain('disabled=""');
    expect(out).toContain('aria-busy="true"');
  });
  it("synced: REFRESH DATA and last-synced details", () => {
    const out = html(<SyncPanel status={st({ state: "synced", lastSuccessAt: "2026-10-06T00:00:00.000Z", window: { newestSlot: 1, oldestSlot: 1, historyComplete: true, hasGap: false, indexedCount: 3 } })} syncing={false} error={null} onSync={() => undefined} />);
    expect(out).toContain("REFRESH DATA");
    expect(out).toContain("3 transactions indexed (full history)");
  });
  it("failed and partial runs are shown with their reason", () => {
    expect(html(<SyncPanel status={st({ state: "failed", lastRun: { id: W, status: "failed", trigger: "manual", startedAt: "x", finishedAt: "x", slot: null, counts: {}, error: { code: "RPC_TIMEOUT", message: "RPC request timed out" } } })} syncing={false} error={null} onSync={() => undefined} />)).toContain("RPC_TIMEOUT");
  });
  it("indexing not configured: explained, button disabled", () => {
    const out = html(<SyncPanel status={st({ state: "indexing_unavailable", configured: false })} syncing={false} error={null} onSync={() => undefined} />);
    expect(out).toContain("not connected to a Solana RPC node");
    expect(out).toContain('disabled=""');
  });
  it("demo wallets get no sync controls", () => {
    expect(html(<SyncPanel status={st({ state: "unsupported_demo_wallet" })} syncing={false} error={null} onSync={() => undefined} />)).toBe("");
  });
});

// ---------- Slice 6: live tax view ----------
const liveTax = (over: Partial<TaxResponse> = {}): TaxResponse => ({
  ...buildTax(W), dataSource: "chain", verifiedOnChain: false, methodSource: "default", status: "PARTIAL", figuresComplete: false,
  estimatedRealizedGainsCents: "0", estimatedRealizedLossesCents: "0", estimatedShortTermNetCents: "0", estimatedLongTermNetCents: "0", estimatedTaxableEvents: 0,
  estimatedTaxExposureCents: null, assumptions: null,
  calculation: { engineVersion: "0.1.0", dataModelVersion: "1", feePolicy: "RECORDED_NOT_APPLIED", swapTreatment: "DISPOSAL_AND_ACQUISITION", inputFingerprint: "abcdef0123456789abcdef", counts: { BUY: 0, SELL: 0, TRANSFER_IN: 1, TRANSFER_OUT: 0, FEE: 0, UNKNOWN: 1, MANUAL_BASIS: 0, unresolved: 2, dataRequired: 0, matched: 0, duplicatesIgnored: 0 }, coverage: { synced: true, historyComplete: false, hasGap: false, holdingsComplete: true }, priceSources: [], walletsIncluded: 1 },
  requirements: [
    { kind: "TRANSFER_MATCH", severity: "incomplete", message: "Unresolved transfers", count: 1 },
    { kind: "CLASSIFICATION", severity: "incomplete", message: "UNKNOWN or unassessed", count: 1 },
    { kind: "RATES", severity: "info", message: "Tax rates were not supplied", count: 1 },
  ],
  ...over,
});
const ev = (o: Partial<TaxDetailsResponse["events"][number]> = {}): TaxDetailsResponse["events"][number] => ({
  origin: "CHAIN", manualBasisId: null,
  id: "e1", signature: "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UNbmiMeFbvk", walletId: "w", timestamp: "2024-01-02T00:00:00.000Z", kind: "SELL", status: "DATA_REQUIRED",
  asset: "SOL", mint: null, decimals: 9, quantity: "1000000000", usdValueCents: null, priceMicroUsd: null, priceSource: null, priceObservedAt: null, valuation: null, feeLamports: "5000", uncoveredQuantity: "0",
  classification: { kind: "swap", reason: "r", version: "1" }, reason: "PRICE DATA UNAVAILABLE for this asset at this time; no value is assumed.", missing: ["PRICE"], confidence: "NONE", matchedWith: null, candidates: [], ...o,
});
const liveDetails = (events: TaxDetailsResponse["events"]): TaxDetailsResponse => ({ walletId: W, taxYear: 2024, costBasisMethod: "FIFO", status: "PARTIAL", realized: [], events, manualBasisReview: [], truncated: false, note: null, dataSource: "chain", verifiedOnChain: false });

describe("live tax view", () => {
  it("PARTIAL: Tax data incomplete, exposure is a dash with RATES REQUIRED, never $0; method shown as default", () => {
    const out = html(<TaxView tax={liveTax()} reserve={null} details={liveDetails([])} />);
    expect(out).toContain("PARTIAL");
    expect(out).toContain("Tax data incomplete");
    expect(out).toContain("LIVE DATA (UNVERIFIED)");
    expect(out).toContain("FIFO (DEFAULT)");
    expect(out).toContain("RATES REQUIRED");
    expect(out).toContain("UNRESOLVED TRANSFERS (1)");
    expect(out).toContain("Fees are recorded, not added to cost basis");
    expect(out).toContain("not personalized tax advice");
    expect(out).not.toContain("DEMO DATA");
    expect(out).not.toMatch(/Estimated tax exposure<\/p><p[^>]*>\$0/);
  });
  it("DATA_REQUIRED: PRICE DATA UNAVAILABLE and DATA REQUIRED labels; figures carry the incomplete flag", () => {
    const t = liveTax({ status: "DATA_REQUIRED", requirements: [{ kind: "PRICE", severity: "blocks_total", message: "Price data unavailable", count: 2 }, { kind: "COST_BASIS", severity: "blocks_total", message: "cost basis missing", count: 1 }] });
    const out = html(<TaxView tax={t} reserve={null} details={liveDetails([ev()])} />);
    expect(out).toContain("DATA REQUIRED");
    expect(out).toContain("PRICE DATA UNAVAILABLE (2)");
    expect(out).toContain("DATA REQUIRED: COST BASIS (1)");
    expect(out).toContain("Tax data incomplete");
  });
  it("UNAVAILABLE: no figures at all, only dashes", () => {
    const t = liveTax({ status: "UNAVAILABLE", estimatedRealizedGainsCents: null, estimatedRealizedLossesCents: null, estimatedShortTermNetCents: null, estimatedLongTermNetCents: null, calculation: null, requirements: [{ kind: "SYNC", severity: "blocks_total", message: "Unavailable: no wallet has been synced yet.", count: 1 }] });
    const out = html(<TaxView tax={t} reserve={null} details={null} />);
    expect(out).toContain("Tax data unavailable");
    expect(out).not.toMatch(/\$\d/);
  });
  it("COMPLETE is only worded as an estimate and still says the chain data is unverified", () => {
    const t = liveTax({ status: "COMPLETE", figuresComplete: true, requirements: [], estimatedTaxExposureCents: "0" });
    const out = html(<TaxView tax={t} reserve={null} details={null} />);
    expect(out).toContain("COMPLETE (ESTIMATE)");
    expect(out).toContain("not independently verified");
  });
  it("events table lists UNKNOWN, unresolved and missing-price items with reasons; suggested matches are not applied", () => {
    const events = [
      ev({ id: "a", kind: "UNKNOWN", status: "UNRESOLVED", missing: ["CLASSIFICATION"], reason: "Left as UNKNOWN" }),
      ev({ id: "b", kind: "TRANSFER_IN", status: "UNRESOLVED", missing: ["TRANSFER_MATCH"], candidates: ["x"], reason: "Received from an unknown source." }),
      ev({ id: "c" }),
    ];
    const out = html(<TaxView tax={liveTax()} reserve={null} details={liveDetails(events)} />);
    expect(out).toContain("Needs attention (3)");
    expect(out).toContain("UNKNOWN");
    expect(out).toContain("suggested only, not applied");
    expect(out).toContain("PRICE DATA UNAVAILABLE");
  });
  it("no banned tax wording anywhere in the live view", () => {
    const out = html(<TaxView tax={liveTax()} reserve={null} details={liveDetails([ev()])} />);
    expect(out.toLowerCase()).not.toMatch(/guaranteed|loophole|tax-free|write-off|your tax bill/);
  });
  it("reserve view for a real wallet: estimate only, balance not read, incomplete warning, no demo numbers", () => {
    const d: ReturnType<typeof buildTaxReserve> = { ...buildTaxReserve(W, null, "database"), dataSource: "chain", status: "PARTIAL", currentReserveCents: null, reserveDataSource: null, estimatedTaxExposureCents: null, coverageBps: null, recommendedAdditionalReserveCents: null };
    const out = html(<TaxReserveView data={d} onSave={() => undefined} saving={false} saveError={null} savedNotice={false} />);
    expect(out).toContain("Estimated reserve requirement");
    expect(out).toContain("Not read from any chain yet");
    expect(out).toContain("Tax data incomplete");
    expect(out).toContain("Rates required");
    expect(out).not.toContain("$14,200");
    expect(out).not.toContain("DEMO DATA");
  });
});
