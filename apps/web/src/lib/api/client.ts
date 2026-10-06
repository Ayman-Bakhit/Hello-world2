import {
  CharityList, DEMO_CHARITIES, DEMO_WALLETS, DiscoverQuery, DiscoverResponse, DonationsResponse, Launch, LaunchConfigSchema,
  LaunchList, PortfolioResponse, SetTaxReserveTargetRequest, TaxReserveResponse, TaxResponse, TokenList, TokenProof,
  TransactionsResponse, WEB_MOCK_ID_MAP, WalletList, buildCharityList, buildDiscover, buildDonations, buildPortfolio,
  buildTax, buildTaxReserve, buildTokenProof, buildTransactions, DEMO_TOKENS, reviewLaunchConfig, summarizeToken,
  targetFromRequest, type Charity, type LaunchConfig, type StoredTarget, type Wallet,
} from "@project-name/shared";
import type { z } from "zod";
import { API_BASE_URL, API_MODE, type ApiMode } from "./config";
import { ApiClientError, requestJson } from "./http";
import { zodToClientError } from "./zodError";

/**
 * Typed API client. Same function signatures in both modes, and the same response types (validated
 * with the shared zod schemas), so the UI can switch from mock to API without changes.
 *
 *  - mock: builds responses locally from shared demo fixtures. No network. dataSource is "demo".
 *  - api:  calls the Fastify API. Protected endpoints need a session token (setSessionToken).
 *
 * Any bearer token (dev/API use only) is kept in memory: nothing is persisted by this layer. Browsers authenticate with an HttpOnly cookie.
 */

export { ApiClientError } from "./http";

export interface ClientOptions {
  mode?: ApiMode;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  getToken?: () => string | null;
}

let sessionToken: string | null = null;
export const setSessionToken = (t: string | null): void => { sessionToken = t; };

export type DiscoverParams = Partial<{
  sort: DiscoverQuery["sort"]; minMarketCap: string; maxMarketCap: string; minLiquidity: string; minVolume: string;
  minHolders: number; verifiedTransparency: boolean; launchedWithinDays: number; limit: number; offset: number;
}>;

export function createApiClient(opts: ClientOptions = {}) {
  const mode = opts.mode ?? API_MODE;
  const baseUrl = (opts.baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const token = opts.getToken ?? (() => sessionToken);
  const mockId = (id: string) => WEB_MOCK_ID_MAP[id] ?? id;

  function http<S extends z.ZodType>(schema: S, path: string, query?: Record<string, string | number | boolean | undefined>): Promise<z.infer<S>> {
    return requestJson(schema, { baseUrl, fetchImpl: doFetch, path, ...(query ? { query } : {}), token: token() });
  }
  function send<S extends z.ZodType>(schema: S, path: string, body?: unknown): Promise<z.infer<S>> {
    return requestJson(schema, { baseUrl, fetchImpl: doFetch, method: "POST", path, ...(body !== undefined ? { body } : {}), token: token() });
  }

  // ---- mock mode: in-memory stand-ins for the API's stored data (never persisted, never sent anywhere) ----
  let mockTarget: StoredTarget = { targetType: "percentage", percentBps: 3000, targetCents: null, updatedAt: "2026-01-01T00:00:00.000Z" };
  const mockLaunches: Launch[] = [];
  const mockWallets = (): Wallet[] => DEMO_WALLETS.map((w) => ({ id: w.id, chain: "solana" as const, address: w.address, label: w.label, ownershipVerified: false, dataSource: "demo" as const, createdAt: "2026-01-01T00:00:00.000Z" }));
  const mockReview = (config: LaunchConfig) => {
    const charity = DEMO_CHARITIES.find((c) => c.id === config.charityConfiguration.charityId);
    return reviewLaunchConfig(config, {
      ownedWalletAddresses: DEMO_WALLETS.map((w) => w.address),
      charity: charity ? { verified: charity.verification === "verified", hasVerifiedWallet: charity.wallet.verification === "verified" } : null,
      now: new Date(),
    });
  };

  const notFound = (what: string) => new ApiClientError(404, "NOT_FOUND", `${what} not found`);
  const need = <T,>(v: T | null, what: string): T => { if (v === null) throw notFound(what); return v; };

  return {
    mode,
    getWallets: async (): Promise<WalletList> => (mode === "api" ? http(WalletList, "/api/wallets") : { wallets: mockWallets() }),

    getTransactions: async (walletId: string, p: { limit?: number; offset?: number } = {}): Promise<TransactionsResponse> =>
      mode === "api"
        ? http(TransactionsResponse, `/api/transactions/${encodeURIComponent(walletId)}`, p)
        : need(buildTransactions(mockId(walletId), p.limit ?? 25, p.offset ?? 0), "Transactions"),

    getTokens: async (): Promise<TokenList> =>
      mode === "api" ? http(TokenList, "/api/tokens") : { tokens: DEMO_TOKENS.map(summarizeToken), dataSource: "demo", verifiedOnChain: false },

    /** Stores a reserve TARGET only. Moves no funds (the API has no such path). */
    setTaxReserveTarget: async (walletId: string, req: unknown): Promise<TaxReserveResponse> => {
      if (mode === "api") return send(TaxReserveResponse, `/api/tax-reserve/${encodeURIComponent(walletId)}/target`, req);
      const r = SetTaxReserveTargetRequest.safeParse(req);
      if (!r.success) throw zodToClientError(r.error);
      mockTarget = { ...targetFromRequest(r.data), updatedAt: new Date().toISOString() };
      return buildTaxReserve(mockId(walletId), mockTarget, "demo");
    },

    /** Saves a launch CONFIGURATION (draft). Deploys nothing. */
    createLaunch: async (config: unknown): Promise<Launch> => {
      if (mode === "api") return send(Launch, "/api/launches", config);
      const r = LaunchConfigSchema.safeParse(config);
      if (!r.success) throw zodToClientError(r.error);
      const now = new Date().toISOString();
      const launch: Launch = {
        id: crypto.randomUUID(), status: "draft", config: r.data, review: null,
        deployment: { status: "not_deployed", contractAddress: null }, createdAt: now, updatedAt: now, dataSource: "demo",
      };
      mockLaunches.unshift(launch);
      return launch;
    },

    reviewLaunch: async (id: string): Promise<Launch> => {
      if (mode === "api") return send(Launch, `/api/launches/${encodeURIComponent(id)}/review`);
      const i = mockLaunches.findIndex((l) => l.id === id);
      const found = mockLaunches[i];
      if (!found) throw notFound("Launch");
      const review = mockReview(found.config);
      const updated: Launch = { ...found, review, status: review.passed ? "review_passed" : "review_failed", updatedAt: new Date().toISOString() };
      mockLaunches[i] = updated;
      return updated;
    },

    getPortfolio: async (walletId: string): Promise<PortfolioResponse> =>
      mode === "api" ? http(PortfolioResponse, `/api/portfolio/${encodeURIComponent(walletId)}`) : need(buildPortfolio(mockId(walletId)), "Portfolio"),

    getTaxEstimate: async (walletId: string): Promise<TaxResponse> =>
      mode === "api" ? http(TaxResponse, `/api/tax/${encodeURIComponent(walletId)}`) : buildTax(mockId(walletId)),

    getTaxReserve: async (walletId: string): Promise<TaxReserveResponse> =>
      mode === "api" ? http(TaxReserveResponse, `/api/tax-reserve/${encodeURIComponent(walletId)}`) : buildTaxReserve(mockId(walletId), mockTarget, "demo"),

    getCharities: async (): Promise<Charity[]> =>
      mode === "api" ? (await http(CharityList, "/api/charities")).charities : buildCharityList(),

    getDonations: async (walletId: string): Promise<DonationsResponse> =>
      mode === "api" ? http(DonationsResponse, `/api/donations/${encodeURIComponent(walletId)}`) : need(buildDonations(mockId(walletId)), "Donations"),

    /** Mock mode lists only configurations saved in this tab (in memory); it never invents any. */
    getLaunches: async (params: { limit?: number; offset?: number } = {}): Promise<LaunchList> =>
      mode === "api"
        ? http(LaunchList, "/api/launches", params)
        : { launches: mockLaunches.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 25)), pagination: { limit: params.limit ?? 25, offset: params.offset ?? 0, total: mockLaunches.length } },

    getLaunch: async (id: string): Promise<Launch> => {
      if (mode === "api") return http(Launch, `/api/launches/${encodeURIComponent(id)}`);
      return need(mockLaunches.find((l) => l.id === id) ?? null, "Launch");
    },

    getTokenProof: async (id: string): Promise<TokenProof> =>
      mode === "api" ? http(TokenProof, `/api/tokens/${encodeURIComponent(id)}/proof`) : need(buildTokenProof(id), "Token"),

    getDiscover: async (p: DiscoverParams = {}): Promise<DiscoverResponse> => {
      if (mode === "api") {
        return http(DiscoverResponse, "/api/discover", { ...p, verifiedTransparency: p.verifiedTransparency === undefined ? undefined : String(p.verifiedTransparency) });
      }
      return buildDiscover(DiscoverQuery.parse({ ...p, verifiedTransparency: p.verifiedTransparency === undefined ? undefined : String(p.verifiedTransparency) }));
    },
  };
}

/** Default client, configured from NEXT_PUBLIC_API_MODE / NEXT_PUBLIC_API_BASE_URL. */
export const api = createApiClient();
export const { getWallets, getTransactions, getTokens, setTaxReserveTarget, createLaunch, reviewLaunch, getPortfolio, getTaxEstimate, getTaxReserve, getCharities, getDonations, getLaunches, getLaunch, getTokenProof, getDiscover } = api;
