import {
  CharityList, DEMO_CHARITIES, DEMO_WALLETS, DiscoverQuery, DiscoverResponse, DonationsResponse, Launch, LaunchConfigSchema,
  LaunchList, PortfolioResponse, SetTaxReserveTargetRequest, StartSyncResponse, SyncStatusResponse, TaxCalculateResponse, TaxDetailsResponse, TaxReportResponse, buildDemoTaxReport, reportToCsv, reportToJson, exportFilename, ManualBasisDetail, ManualBasisList, ManualBasisView,
  type CreateManualBasisRequest, type ReviseManualBasisRequest, type VoidManualBasisRequest, TaxReserveResponse, TaxResponse, TokenList, TokenProof,
  TransactionsResponse, WEB_MOCK_ID_MAP, WalletList, buildCharityList, buildDiscover, buildDonations, buildPortfolio,
  buildTax, buildTaxDetails, buildTaxReserve, buildTokenProof, buildTransactions, DEMO_TOKENS, reviewLaunchConfig, summarizeToken,
  targetFromRequest, type Charity, type LaunchConfig, type StoredTarget, type Wallet,
} from "@project-name/shared";
import { z } from "zod";
import { API_BASE_URL, API_MODE, type ApiMode } from "./config";
import { ApiClientError, requestJson } from "./http";
import { zodToClientError } from "./zodError";
import { toCalculateRequest, type TaxQueryParams } from "../taxQuery";

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

  const manualUnsupported = () => new ApiClientError(409, "MANUAL_BASIS_UNSUPPORTED", "Demo data has no editable cost basis. Cost basis can only be added to real wallets.");
  const notFound = (what: string) => new ApiClientError(404, "NOT_FOUND", `${what} not found`);
  const need = <T,>(v: T | null, what: string): T => { if (v === null) throw notFound(what); return v; };

  return {
    mode,
    getWallets: async (): Promise<WalletList> => (mode === "api" ? http(WalletList, "/api/wallets") : { wallets: mockWallets() }),

    getTransactions: async (walletId: string, p: { limit?: number; offset?: number } = {}): Promise<TransactionsResponse> =>
      mode === "api"
        ? http(TransactionsResponse, `/api/transactions/${encodeURIComponent(walletId)}`, p)
        : need(buildTransactions(mockId(walletId), p.limit ?? 25, p.offset ?? 0), "Transactions"),

    /** Read-only indexing status for a wallet. Mock mode: demo wallets are never indexed. */
    getWalletSync: async (walletId: string): Promise<SyncStatusResponse> => {
      if (mode === "api") return http(SyncStatusResponse, `/api/wallets/${encodeURIComponent(walletId)}/sync`);
      return {
        walletId: mockId(walletId), state: "unsupported_demo_wallet", configured: false, cluster: "mock", priceProvider: "none",
        limits: { initialTransactionLimit: 0, maxTransactionsPerSync: 0, minSyncIntervalSeconds: 0 }, lastRun: null, lastSuccessAt: null, window: null, nextAllowedAt: null,
      };
    },

    /** Starts a bounded, READ-ONLY sync (reads the chain; signs and sends nothing). */
    startWalletSync: async (walletId: string): Promise<StartSyncResponse> => {
      if (mode === "api") return send(StartSyncResponse, `/api/wallets/${encodeURIComponent(walletId)}/sync`);
      throw new ApiClientError(409, "SYNC_UNSUPPORTED", "Demo wallets are not indexed. Demo data is fixture data.");
    },

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

    /** GET carries only non-sensitive parameters. Mock mode ignores them: it only has the labeled demo fixture. */
    getTaxEstimate: async (walletId: string, q: Pick<TaxQueryParams, "taxYear" | "method" | "swapTreatment"> = {}): Promise<TaxResponse> =>
      mode === "api" ? http(TaxResponse, `/api/tax/${encodeURIComponent(walletId)}`, { ...q }) : buildTax(mockId(walletId)),

    getTaxDetails: async (walletId: string, q: Pick<TaxQueryParams, "taxYear" | "method" | "swapTreatment"> = {}): Promise<TaxDetailsResponse> =>
      mode === "api" ? http(TaxDetailsResponse, `/api/tax/${encodeURIComponent(walletId)}/details`, { ...q }) : need(buildTaxDetails(mockId(walletId)), "Tax details"),

    getTaxReserve: async (walletId: string): Promise<TaxReserveResponse> =>
      mode === "api" ? http(TaxReserveResponse, `/api/tax-reserve/${encodeURIComponent(walletId)}`) : buildTaxReserve(mockId(walletId), mockTarget, "demo"),

    /** Summary + details from one calculation. Tax rates go in the POST body, never in a URL. */
    calculateTax: async (walletId: string, q: TaxQueryParams = {}): Promise<TaxCalculateResponse> =>
      mode === "api"
        ? send(TaxCalculateResponse, `/api/tax/${encodeURIComponent(walletId)}/calculate`, toCalculateRequest(q))
        : { tax: buildTax(mockId(walletId)), details: need(buildTaxDetails(mockId(walletId)), "Tax details") },

    calculateTaxReserve: async (walletId: string, q: TaxQueryParams = {}): Promise<TaxReserveResponse> =>
      mode === "api" ? send(TaxReserveResponse, `/api/tax-reserve/${encodeURIComponent(walletId)}/calculate`, toCalculateRequest(q)) : buildTaxReserve(mockId(walletId), mockTarget, "demo"),

    /** Estimated tax report (read-only view over the calculation). GET carries only non-sensitive parameters. */
    getTaxReport: async (walletId: string, q: Pick<TaxQueryParams, "taxYear" | "method" | "swapTreatment"> = {}): Promise<TaxReportResponse> =>
      mode === "api" ? http(TaxReportResponse, `/api/tax/${encodeURIComponent(walletId)}/report`, { ...q }) : TaxReportResponse.parse(need(buildDemoTaxReport(mockId(walletId), new Date().toISOString()), "Tax report")),

    /** Export as a file's text. POST body, never a URL. The filename is the server's validated one. */
    exportTaxReport: async (walletId: string, req: { format: "csv" | "json"; taxYear?: number; method?: "FIFO" | "LIFO" | "HIFO"; swapTreatment?: "DISPOSAL_AND_ACQUISITION" | "NOT_ASSESSED" }): Promise<{ filename: string; mime: string; text: string }> => {
      if (mode !== "api") {
        const rep = need(buildDemoTaxReport(mockId(walletId), new Date().toISOString()), "Tax report");
        return { filename: exportFilename(rep, req.format), mime: req.format === "csv" ? "text/csv" : "application/json", text: req.format === "csv" ? reportToCsv(rep) : reportToJson(rep) };
      }
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/api/tax/${encodeURIComponent(walletId)}/report/export`, {
          method: "POST", credentials: "include", cache: "no-store",
          headers: { accept: "text/csv,application/json", "content-type": "application/json", ...(token() ? { authorization: `Bearer ${token()}` } : {}) },
          body: JSON.stringify(req),
        });
      } catch {
        throw new ApiClientError(0, "NETWORK_ERROR", "Could not reach the API");
      }
      const text = await res.text();
      if (!res.ok) {
        let code = "HTTP_ERROR", message = `Request failed (${res.status})`;
        try { const j = JSON.parse(text) as { error?: { code?: string; message?: string } }; if (j.error?.code) { code = j.error.code; message = j.error.message ?? message; } } catch { /* not JSON */ }
        throw new ApiClientError(res.status, code, message);
      }
      const cd = /filename="([A-Za-z0-9._-]{1,120})"/.exec(res.headers.get("content-disposition") ?? "");
      return { filename: cd?.[1] ?? `estimated-tax-report.${req.format}`, mime: req.format === "csv" ? "text/csv" : "application/json", text };
    },

    // ---- USER_PROVIDED cost basis (real wallets only; never blockchain data) ----
    listManualBasis: async (walletId: string, includeVoided = false): Promise<z.infer<typeof ManualBasisList>> => {
      if (mode !== "api") throw manualUnsupported();
      return http(ManualBasisList, `/api/wallets/${encodeURIComponent(walletId)}/manual-basis`, { includeVoided: includeVoided ? "true" : "false" });
    },
    createManualBasis: async (walletId: string, req: CreateManualBasisRequest | Record<string, unknown>): Promise<ManualBasisView> => {
      if (mode !== "api") throw manualUnsupported();
      return send(ManualBasisView, `/api/wallets/${encodeURIComponent(walletId)}/manual-basis`, req);
    },
    getManualBasis: async (walletId: string, id: string): Promise<ManualBasisDetail & { historyIntact: boolean }> => {
      if (mode !== "api") throw manualUnsupported();
      const d = await http(ManualBasisDetail.extend({ historyIntact: z.boolean() }), `/api/wallets/${encodeURIComponent(walletId)}/manual-basis/${encodeURIComponent(id)}`);
      return d;
    },
    reviseManualBasis: async (walletId: string, id: string, req: ReviseManualBasisRequest | Record<string, unknown>): Promise<ManualBasisView> => {
      if (mode !== "api") throw manualUnsupported();
      return send(ManualBasisView, `/api/wallets/${encodeURIComponent(walletId)}/manual-basis/${encodeURIComponent(id)}/revisions`, req);
    },
    voidManualBasis: async (walletId: string, id: string, req: VoidManualBasisRequest): Promise<ManualBasisView> => {
      if (mode !== "api") throw manualUnsupported();
      return send(ManualBasisView, `/api/wallets/${encodeURIComponent(walletId)}/manual-basis/${encodeURIComponent(id)}/void`, req);
    },

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
export const { getWallets, getWalletSync, startWalletSync, getTransactions, getTokens, setTaxReserveTarget, createLaunch, reviewLaunch, getPortfolio, getTaxEstimate, getTaxDetails, getTaxReserve, getTaxReport, exportTaxReport, calculateTax, calculateTaxReserve, listManualBasis, createManualBasis, getManualBasis, reviseManualBasis, voidManualBasis, getCharities, getDonations, getLaunches, getLaunch, getTokenProof, getDiscover } = api;
