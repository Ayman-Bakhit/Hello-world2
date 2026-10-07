import {
  CharityEvidenceResponse, CharityList, LaunchHistory, PublicLaunch, PublicLaunchList, buildDemoPublicLaunch, planLaunchAction, launchFingerprint, revisionRowHash, toPublicLaunch, STATUS_MEANING, type LaunchAction, type LaunchActionName, DEMO_CHARITIES, DonationDetail, DonationPlanResponse, Receipt, buildCharityEvidence, buildDonationDetail, buildDonationPlan, buildReceipt, parseUsdToCents, DEMO_WALLETS, DiscoverQuery, DiscoverResponse, DonationsResponse, Launch, LaunchConfigSchema,
  DeploymentAttemptList, DeploymentDecisionSummary, ExecutionReadinessResponse, FIXTURE_CHARITY, buildDecisionSummary, buildReadinessResponse, evaluateExecutionReadiness, fixtureReadyLaunch, DeploymentPlanResponse, DeploymentReviewResponse, buildDeploymentPlan, buildDeploymentReview, buildDemoDeploymentPlan, LaunchList, LaunchProof, PROOF_SCENARIOS, buildLaunchProof, buildProofFixture, DEMO_IDS as PROOF_DEMO_IDS, type ProofScenario, PortfolioResponse, SetTaxReserveTargetRequest, StartSyncResponse, SyncStatusResponse, TaxCalculateResponse, TaxDetailsResponse, TaxReportResponse, buildDemoTaxReport, reportToCsv, reportToJson, exportFilename, ManualBasisDetail, ManualBasisList, ManualBasisView,
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
  function send<S extends z.ZodType>(schema: S, path: string, body?: unknown, method: "POST" | "PUT" = "POST"): Promise<z.infer<S>> {
    return requestJson(schema, { baseUrl, fetchImpl: doFetch, method, path, ...(body !== undefined ? { body } : {}), token: token() });
  }

  // ---- mock mode: in-memory stand-ins for the API's stored data (never persisted, never sent anywhere) ----
  let mockTarget: StoredTarget = { targetType: "percentage", percentBps: 3000, targetCents: null, source: "USER_SET", enabled: true, updatedAt: "2026-01-01T00:00:00.000Z" };
  const mockLaunches: Launch[] = [];
  /** Mock-mode revision rows, kept in memory per launch. They use the same hash chain as the API. */
  const mockHistory = new Map<string, Array<{ seq: number; action: LaunchAction; statusAfter: Launch["status"]; fingerprint: string; reason: string | null; createdAt: string; prevHash: string | null; rowHash: string }>>();
  const mockWallets = (): Wallet[] => DEMO_WALLETS.map((w) => ({ id: w.id, chain: "solana" as const, address: w.address, label: w.label, ownershipVerified: false, dataSource: "demo" as const, createdAt: "2026-01-01T00:00:00.000Z" }));
  const mockCharity = (id: string) => buildCharityList().find((c) => c.id === id) ?? null;
  const mockReview = (config: LaunchConfig) => {
    const charity = mockCharity(config.charityConfiguration.charityId);
    return reviewLaunchConfig(config, {
      ownedWalletAddresses: DEMO_WALLETS.map((w) => w.address),
      charity: charity
        ? {
            verified: charity.verificationState === "VERIFIED", hasVerifiedWallet: charity.wallets.some((w) => w.verificationStatus === "verified"),
            snapshot: { id: charity.id, name: charity.name, verificationState: charity.verificationState, verificationSource: charity.verificationSource, lastReviewedAt: charity.lastReviewedAt, dataSource: charity.dataSource },
          }
        : null,
      now: new Date(),
    });
  };
  const mockRecord = (l: Launch, action: LaunchAction, reason: string | null) => {
    const rows = mockHistory.get(l.id) ?? [];
    const prev = rows.at(-1)?.rowHash ?? null;
    const createdAt = new Date().toISOString();
    const row = { seq: rows.length + 1, action, statusAfter: l.status, fingerprint: l.fingerprint, reason, createdAt, prevHash: prev, rowHash: revisionRowHash({ launchId: l.id, seq: rows.length + 1, action, statusAfter: l.status, fingerprint: l.fingerprint, createdBy: "demo", reason, prevHash: prev, createdAt }) };
    mockHistory.set(l.id, [...rows, row]);
  };
  /** Mock mode: the same pure builder the API uses, over the in-memory launch. Failures carry the API's status and code. */
  const mockPlan = (id: string): DeploymentPlanResponse => {
    if (id === PROOF_DEMO_IDS.launch) { const plan = buildDemoDeploymentPlan(); return { plan, review: buildDeploymentReview(plan), recorded: false, supersededPlans: 0 }; }
    const l = need(mockLaunches.find((x) => x.id === id) ?? null, "Launch");
    const c = mockCharity(l.config.charityConfiguration.charityId);
    const r = buildDeploymentPlan({ launch: l, charity: c ? { id: c.id, verificationState: c.verificationState, walletAddress: null } : null });
    if (!r.ok) {
      const f: Record<string, string[]> = {};
      for (const e of r.errors) (f[e.field] ??= []).push(`${e.code}: ${e.message}`);
      const first = r.errors[0]!;
      throw new ApiClientError(first.code === "LAUNCH_NOT_READY" || first.code === "STALE_REVIEW" ? 409 : 422, first.code, first.message, f);
    }
    return { plan: r.plan, review: buildDeploymentReview(r.plan), recorded: false, supersededPlans: 0 };
  };
  /** Mock mode: the same pure evaluator the API uses. The labeled demo launch is a fixture; saved mock launches have no resolvable charity wallet. */
  const mockReadinessFor = (id: string) => {
    if (id === PROOF_DEMO_IDS.launch) { const launch = fixtureReadyLaunch(); return { launch, readiness: evaluateExecutionReadiness({ launch, charity: FIXTURE_CHARITY, planState: { recorded: false, supersededPlans: 0 } }) }; }
    const launch = need(mockLaunches.find((x) => x.id === id) ?? null, "Launch");
    const c = mockCharity(launch.config.charityConfiguration.charityId);
    return { launch, readiness: evaluateExecutionReadiness({ launch, charity: c ? { id: c.id, verificationState: c.verificationState, walletAddress: null } : null }) };
  };
  const mockProof = (l: Launch, audience: "owner" | "public"): LaunchProof => {
    const c = mockCharity(l.config.charityConfiguration.charityId);
    return buildLaunchProof({
      subject: { launchId: l.id, dataSource: l.dataSource, config: l.config, fingerprint: l.fingerprint, charity: c ? { id: c.id, name: c.name, walletAddress: null } : null },
      deployment: null, observation: null, observationCount: 0, historyIntact: true, audience,
    });
  };
  const mockLaunch = (config: LaunchConfig, id: string, status: Launch["status"], now: string): Launch => ({
    id, status, statusMeaning: STATUS_MEANING[status], config, review: null, fingerprint: launchFingerprint(config), revision: 1, publicVisible: false, readyAt: null,
    deployment: { status: "not_deployed", mintAddress: null, transactionSignature: null, contractAddress: null }, metadata: { source: "USER_PROVIDED", verifiedOnChain: false }, createdAt: now, updatedAt: now, dataSource: "demo",
  });
  const publicCharity = (l: Launch) => { const c = mockCharity(l.config.charityConfiguration.charityId); return c ? { id: c.id, name: c.name, verificationState: c.verificationState, verificationSource: c.verificationSource, lastReviewedAt: c.lastReviewedAt, dataSource: c.dataSource } : null; };
  const mockCheckRefs = (cfg: LaunchConfig) => {
    const addrs = DEMO_WALLETS.map((w) => w.address);
    if (!addrs.includes(cfg.creatorWallet)) throw new ApiClientError(422, "WALLET_NOT_OWNED", "creatorWallet must be one of your registered wallets", { creatorWallet: ["not one of your registered wallets"] });
    if (!addrs.includes(cfg.taxReserveConfiguration.destinationAddress)) throw new ApiClientError(422, "WALLET_NOT_OWNED", "The tax reserve allocation destination must be one of your registered wallets", { "taxReserveConfiguration.destinationAddress": ["not one of your registered wallets"] });
    if (!mockCharity(cfg.charityConfiguration.charityId)) throw new ApiClientError(422, "CHARITY_NOT_FOUND", "The selected charity is not in the registry", { "charityConfiguration.charityId": ["not a registry charity"] });
  };
  /** Same transition function as the API (planLaunchAction); only the storage differs. */
  const mockAct = (id: string, action: LaunchActionName, o: { config?: LaunchConfig; reason?: string | null; publish?: boolean; fingerprint?: string } = {}): Launch => {
    const i = mockLaunches.findIndex((l) => l.id === id);
    const found = mockLaunches[i];
    if (!found) throw notFound("Launch");
    if (action === "ready" && o.fingerprint !== found.fingerprint) throw new ApiClientError(409, "FINGERPRINT_MISMATCH", "The confirmed fingerprint is not this launch's current configuration fingerprint.");
    const needsReview = action === "configure" || action === "review" || action === "ready";
    const review = needsReview ? mockReview(found.config) : undefined;
    const plan = planLaunchAction({ current: { status: found.status, config: found.config, review: found.review, revision: found.revision }, action, now: new Date(), ...(o.config ? { config: o.config } : {}), ...(review ? { review } : {}), ...(o.publish !== undefined ? { publish: o.publish } : {}) });
    if (!plan) throw new ApiClientError(409, "INVALID_LAUNCH_TRANSITION", `This action is not available while the launch is ${found.status}.`);
    const updated: Launch = {
      ...found, status: plan.status, statusMeaning: STATUS_MEANING[plan.status], config: plan.config, review: plan.review, fingerprint: plan.fingerprint, revision: plan.revision,
      publicVisible: plan.publicVisible, readyAt: plan.readyAt, updatedAt: new Date().toISOString(),
    };
    mockLaunches[i] = updated;
    mockRecord(updated, action, o.reason ?? null);
    return updated;
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

    /** Saves a launch CONFIGURATION (a DRAFT). Deploys nothing; no status can be sent. */
    createLaunch: async (config: unknown): Promise<Launch> => {
      if (mode === "api") return send(Launch, "/api/launches", config);
      const r = LaunchConfigSchema.safeParse(config);
      if (!r.success) throw zodToClientError(r.error);
      mockCheckRefs(r.data);
      const launch = mockLaunch(r.data, crypto.randomUUID(), "DRAFT", new Date().toISOString());
      mockLaunches.unshift(launch);
      mockRecord(launch, "create", null);
      return launch;
    },
    /** Replaces the configuration. The launch returns to DRAFT. */
    updateLaunch: async (id: string, config: unknown): Promise<Launch> => {
      if (mode === "api") return send(Launch, `/api/launches/${encodeURIComponent(id)}`, config, "PUT");
      const r = LaunchConfigSchema.safeParse(config);
      if (!r.success) throw zodToClientError(r.error);
      mockCheckRefs(r.data);
      return mockAct(id, "update", { config: r.data });
    },
    /** Server validation of the stored configuration: DRAFT -> CONFIGURED when it passes. */
    configureLaunch: async (id: string): Promise<Launch> => (mode === "api" ? send(Launch, `/api/launches/${encodeURIComponent(id)}/configure`) : mockAct(id, "configure")),
    /** Submit for review: CONFIGURED -> REVIEW. */
    reviewLaunch: async (id: string): Promise<Launch> => (mode === "api" ? send(Launch, `/api/launches/${encodeURIComponent(id)}/review`) : mockAct(id, "review")),
    /** REVIEW -> READY, only with the exact current fingerprint and explicit confirmation. READY is not deployed. */
    readyLaunch: async (id: string, req: { fingerprint: string; confirmed: true; publish: boolean }): Promise<Launch> =>
      mode === "api" ? send(Launch, `/api/launches/${encodeURIComponent(id)}/ready`, req) : mockAct(id, "ready", { fingerprint: req.fingerprint, publish: req.publish }),
    cancelLaunch: async (id: string, reason?: string): Promise<Launch> =>
      mode === "api" ? send(Launch, `/api/launches/${encodeURIComponent(id)}/cancel`, reason ? { reason } : {}) : mockAct(id, "cancel", { reason: reason ?? null }),
    getLaunchHistory: async (id: string): Promise<LaunchHistory> => {
      if (mode === "api") return http(LaunchHistory, `/api/launches/${encodeURIComponent(id)}/history`);
      need(mockLaunches.find((l) => l.id === id) ?? null, "Launch");
      return { launchId: id, revisions: (mockHistory.get(id) ?? []) as LaunchHistory["revisions"], historyIntact: true, note: "Append-only and hash-chained, so an edit made outside the API is detectable. This is auditability, not a blockchain proof." };
    },
    /** Public, read-only: READY and published configurations. Mock mode adds one labeled demo launch. */
    getPublicLaunches: async (params: { limit?: number; offset?: number } = {}): Promise<PublicLaunchList> => {
      if (mode === "api") return http(PublicLaunchList, "/api/public/launches", params);
      const own = mockLaunches.filter((l) => l.status === "READY" && l.publicVisible).map((l) => toPublicLaunch(l, publicCharity(l)));
      const all = [...own, buildDemoPublicLaunch()];
      return { launches: all.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 25)), pagination: { limit: params.limit ?? 25, offset: params.offset ?? 0, total: all.length } };
    },
    /** Owner-only deployment PLAN (read-only; nothing is signed, sent or deployed). Mock mode builds it in memory; the demo launch serves a labeled fixture. */
    getDeploymentPlan: async (id: string): Promise<DeploymentPlanResponse> => (mode === "api" ? http(DeploymentPlanResponse, `/api/launches/${encodeURIComponent(id)}/deployment-plan`) : mockPlan(id)),
    getDeploymentReview: async (id: string): Promise<DeploymentReviewResponse> => {
      if (mode === "api") return http(DeploymentReviewResponse, `/api/launches/${encodeURIComponent(id)}/deployment-review`);
      const d = mockPlan(id);
      return { review: d.review, planId: d.plan.identity.planId };
    },
    /** Owner-only execution READINESS (read-only; real execution is disabled, so this never says a launch can be signed or sent). */
    getExecutionReadiness: async (id: string): Promise<ExecutionReadinessResponse> => {
      if (mode === "api") return http(ExecutionReadinessResponse, `/api/launches/${encodeURIComponent(id)}/execution-readiness`);
      const { launch, readiness } = mockReadinessFor(id);
      return buildReadinessResponse(launch, readiness);
    },
    getDeploymentDecisionSummary: async (id: string): Promise<DeploymentDecisionSummary> => {
      if (mode === "api") return http(DeploymentDecisionSummary, `/api/launches/${encodeURIComponent(id)}/deployment-decision-summary`);
      const { launch, readiness } = mockReadinessFor(id);
      return buildDecisionSummary(launch, readiness);
    },
    getDeploymentAttempts: async (id: string): Promise<DeploymentAttemptList> => {
      if (mode === "api") return http(DeploymentAttemptList, `/api/launches/${encodeURIComponent(id)}/deployment-attempts`);
      mockReadinessFor(id);
      return { launchId: id, attempts: [], execution: { enabled: false }, note: "A READY launch can have no deployment attempt. Attempts are a separate, append-only record; none is created while real execution is disabled." };
    },
    /** Owner-only token proof for a launch. Mock mode: a saved launch is never deployed, so its proof is always NOT DEPLOYED. */
    getLaunchProof: async (id: string): Promise<LaunchProof> => {
      if (mode === "api") return http(LaunchProof, `/api/launches/${encodeURIComponent(id)}/proof`);
      return mockProof(need(mockLaunches.find((l) => l.id === id) ?? null, "Launch"), "owner");
    },
    /**
     * Public token proof (READY and published only). Mock mode: the labeled DEMO launch serves a deterministic FIXTURE scenario
     * (default FULL_MATCH, which is still NOT verified); a user's own published launch is NOT DEPLOYED. `scenario` is ignored in api mode.
     */
    getPublicLaunchProof: async (id: string, scenario?: string): Promise<LaunchProof> => {
      if (mode === "api") return http(LaunchProof, `/api/public/launches/${encodeURIComponent(id)}/proof`);
      if (id === PROOF_DEMO_IDS.launch) {
        const s = (PROOF_SCENARIOS as readonly string[]).includes(scenario ?? "") ? (scenario as ProofScenario) : "FULL_MATCH";
        return buildProofFixture(s, "public");
      }
      const l = mockLaunches.find((x) => x.id === id && x.status === "READY" && x.publicVisible);
      return mockProof(need(l ?? null, "Launch"), "public");
    },
    getPublicLaunch: async (id: string): Promise<PublicLaunch> => {
      if (mode === "api") return http(PublicLaunch, `/api/public/launches/${encodeURIComponent(id)}`);
      const demo = buildDemoPublicLaunch();
      if (id === demo.id) return demo;
      const l = mockLaunches.find((x) => x.id === id && x.status === "READY" && x.publicVisible);
      return toPublicLaunch(need(l ?? null, "Launch"), publicCharity(l!));
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

    getCharityEvidence: async (charityId: string): Promise<CharityEvidenceResponse> =>
      mode === "api" ? http(CharityEvidenceResponse, `/api/charities/${encodeURIComponent(charityId)}/evidence`) : need(buildCharityEvidence(charityId), "Charity"),

    getDonation: async (donationId: string): Promise<DonationDetail> =>
      mode === "api" ? http(DonationDetail, `/api/donations/by-id/${encodeURIComponent(donationId)}`) : need(buildDonationDetail(donationId), "Donation"),

    getReceipt: async (receiptId: string): Promise<Receipt> =>
      mode === "api" ? http(Receipt, `/api/receipts/${encodeURIComponent(receiptId)}`) : need(buildReceipt(receiptId), "Receipt"),

    /** Stateless review of a planned donation. Nothing is stored, signed or sent, in either mode. */
    planDonation: async (req: { walletId: string; charityId: string; amount: string }): Promise<DonationPlanResponse> => {
      if (mode === "api") return send(DonationPlanResponse, "/api/donations/plan", { ...req, asset: "USDC" });
      const cents = parseUsdToCents(req.amount);
      if (cents === null || cents <= 0n) throw new ApiClientError(400, "VALIDATION_ERROR", "Request validation failed", { amount: ["invalid amount"] });
      const c = need(buildCharityList().find((x) => x.id === req.charityId) ?? null, "Charity");
      return buildDonationPlan({ walletId: mockId(req.walletId), charity: c, hasVerifiedWalletForAsset: c.wallets.some((w) => w.verificationStatus === "verified"), amountUsdCents: cents, walletDataSource: "demo" });
    },

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
export const { getWallets, getWalletSync, startWalletSync, getTransactions, getTokens, setTaxReserveTarget, createLaunch, updateLaunch, configureLaunch, reviewLaunch, readyLaunch, cancelLaunch, getLaunchHistory, getPublicLaunches, getPublicLaunch, getLaunchProof, getPublicLaunchProof, getDeploymentPlan, getDeploymentReview, getExecutionReadiness, getDeploymentDecisionSummary, getDeploymentAttempts, getPortfolio, getTaxEstimate, getTaxDetails, getTaxReserve, getTaxReport, exportTaxReport, calculateTax, calculateTaxReserve, listManualBasis, createManualBasis, getManualBasis, reviseManualBasis, voidManualBasis, getCharities, getCharityEvidence, getDonation, getReceipt, planDonation, getDonations, getLaunches, getLaunch, getTokenProof, getDiscover } = api;
