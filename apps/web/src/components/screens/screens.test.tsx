import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import {
  DEMO_IDS, DEMO_WALLETS, DiscoverQuery, NO_LIVE_DATA, buildCharityList, buildDiscover, buildDonations, buildPortfolio, buildTax,
  buildTaxReserve, buildTokenProof, buildTransactions, LaunchConfigSchema, type TokenProof,
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
      <ResourceView resource={res({ status: "error", error: apiErr(404, NO_LIVE_DATA) })} noData={<NoLiveData title="NO LIVE PORTFOLIO DATA YET" message="Your wallet is authenticated, but blockchain indexing has not been connected yet." />}>
        {() => <PortfolioView portfolio={buildPortfolio(W)!} extras={{ tax: null, reserve: null, donations: null, walletCount: 1 }} />}
      </ResourceView>
    ));
    expect(out).toContain("NO LIVE PORTFOLIO DATA YET");
    expect(out).toContain("Your wallet is authenticated, but blockchain indexing has not been connected yet.");
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
    const out = html(<TaxView tax={buildTax(W)} reserve={buildTaxReserve(W, null, "demo")} transactions={buildTransactions(W, 100, 0)!} walletLabel="Trading" />);
    for (const s of ["Estimated tax exposure", "Estimated realized gains", "Estimated realized losses", "Tax planning estimate", "Estimated tax reserve", "DEMO DATA", "$18,420", "qualified tax professional", "not a tax bill"]) expect(out, s).toContain(s);
    expect(out.toLowerCase()).not.toMatch(/your tax bill|guaranteed|loophole/);
  });
  it("tax view without reserve data shows dashes instead of inventing a reserve", () => {
    const out = html(<TaxView tax={buildTax(W)} reserve={null} transactions={null} walletLabel="Trading" />);
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
    expect(out).toContain("VERIFIED (DEMO DATA)");
    expect(out).toContain("PENDING REVIEW");
    expect(out).toContain("Demo record");
  });
  it("a charity is only 'verified' if the API says so AND a wallet is verified", () => {
    const base = buildCharityList()[0]!;
    expect(charityFromApi({ ...base, wallets: base.wallets.map((w) => ({ ...w, verificationStatus: "pending" as const })) }).verification).toBe("pending");
    expect(charityFromApi({ ...base, verificationStatus: "rejected" }).verification).toBe("rejected");
    expect(charityFromApi({ ...base, dataSource: "database" }).verificationNote).toMatch(/admin review/);
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
