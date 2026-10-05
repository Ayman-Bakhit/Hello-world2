import {
  ApiErrorBody, CharityList, DiscoverResponse, DonationsResponse, Launch, LaunchList, PortfolioResponse,
  TaxReserveResponse, TaxResponse, TokenProof, WEB_MOCK_ID_MAP, buildCharityList, buildDiscover, buildDonations,
  buildPortfolio, buildTax, buildTaxReserve, buildTokenProof, DiscoverQuery, type Charity, type StoredTarget,
} from "@project-name/shared";
import type { z } from "zod";
import { API_BASE_URL, API_MODE, type ApiMode } from "./config";

/**
 * Typed API client. Same function signatures in both modes, and the same response types (validated
 * with the shared zod schemas), so the UI can switch from mock to API without changes.
 *
 *  - mock: builds responses locally from shared demo fixtures. No network. dataSource is "demo".
 *  - api:  calls the Fastify API. Protected endpoints need a session token (setSessionToken).
 *
 * The session token is kept in memory only: no localStorage, no cookies, nothing persisted by this layer.
 */

export class ApiClientError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly fields?: Record<string, string[]>) {
    super(message);
    this.name = "ApiClientError";
  }
}

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
  minHolders: number; verifiedTransparency: boolean; limit: number; offset: number;
}>;

export function createApiClient(opts: ClientOptions = {}) {
  const mode = opts.mode ?? API_MODE;
  const baseUrl = (opts.baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const token = opts.getToken ?? (() => sessionToken);
  const mockId = (id: string) => WEB_MOCK_ID_MAP[id] ?? id;

  async function http<S extends z.ZodType>(schema: S, path: string, query?: Record<string, string | number | boolean | undefined>): Promise<z.infer<S>> {
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const t = token();
    let res: Response;
    try {
      res = await doFetch(url.toString(), { headers: { accept: "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) } });
    } catch {
      throw new ApiClientError(0, "NETWORK_ERROR", "Could not reach the API");
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const e = ApiErrorBody.safeParse(json);
      throw e.success ? new ApiClientError(res.status, e.data.error.code, e.data.error.message, e.data.error.fields) : new ApiClientError(res.status, "HTTP_ERROR", `Request failed (${res.status})`);
    }
    return schema.parse(json);
  }

  const notFound = (what: string) => new ApiClientError(404, "NOT_FOUND", `${what} not found`);
  const need = <T,>(v: T | null, what: string): T => { if (v === null) throw notFound(what); return v; };
  const MOCK_TARGET: StoredTarget = { targetType: "percentage", percentBps: 3000, targetCents: null, updatedAt: "2026-01-01T00:00:00.000Z" };

  return {
    mode,
    getPortfolio: async (walletId: string): Promise<PortfolioResponse> =>
      mode === "api" ? http(PortfolioResponse, `/api/portfolio/${encodeURIComponent(walletId)}`) : need(buildPortfolio(mockId(walletId)), "Portfolio"),

    getTaxEstimate: async (walletId: string): Promise<TaxResponse> =>
      mode === "api" ? http(TaxResponse, `/api/tax/${encodeURIComponent(walletId)}`) : buildTax(mockId(walletId)),

    getTaxReserve: async (walletId: string): Promise<TaxReserveResponse> =>
      mode === "api" ? http(TaxReserveResponse, `/api/tax-reserve/${encodeURIComponent(walletId)}`) : buildTaxReserve(mockId(walletId), MOCK_TARGET, "demo"),

    getCharities: async (): Promise<Charity[]> =>
      mode === "api" ? (await http(CharityList, "/api/charities")).charities : buildCharityList(),

    getDonations: async (walletId: string): Promise<DonationsResponse> =>
      mode === "api" ? http(DonationsResponse, `/api/donations/${encodeURIComponent(walletId)}`) : need(buildDonations(mockId(walletId)), "Donations"),

    /** Mock mode has no stored launch configurations: the list is empty, never invented. */
    getLaunches: async (params: { limit?: number; offset?: number } = {}): Promise<LaunchList> =>
      mode === "api"
        ? http(LaunchList, "/api/launches", params)
        : { launches: [], pagination: { limit: params.limit ?? 25, offset: params.offset ?? 0, total: 0 } },

    getLaunch: async (id: string): Promise<Launch> => {
      if (mode === "api") return http(Launch, `/api/launches/${encodeURIComponent(id)}`);
      throw notFound("Launch");
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
export const { getPortfolio, getTaxEstimate, getTaxReserve, getCharities, getDonations, getLaunches, getLaunch, getTokenProof, getDiscover } = api;
