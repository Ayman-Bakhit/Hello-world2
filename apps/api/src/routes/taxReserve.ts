import type { FastifyPluginAsync } from "fastify";
import { SetTaxReserveTargetRequest, TaxCalculateRequest, TaxQuery, TaxReserveResponse, buildTaxReserve, targetFromRequest } from "@project-name/shared";
import { actorOf, requireAuth } from "../auth/plugin";
import { getTaxReserveTarget, upsertTaxReserveTarget } from "../db/repos";
import { parse, respond } from "../http/validate";
import { runUserTax, taxReserveOf } from "../services/tax";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

/**
 * GET: the stored target, plus the ESTIMATED requirement. Demo wallets: demo fixtures. Real wallets: derived from
 * indexed transactions (see tax routes); the reserve balance is not read from any chain, so coverage is null.
 * POST: stores the target configuration ONLY. No transfer, approval, or signing path exists here.
 */
export const taxReserveRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const auth = requireAuth(pool, config);

  const view = async (userId: string, wallet: { id: string; dataSource: string }, q: TaxCalculateRequest) => {
    const t = await getTaxReserveTarget(pool, userId);
    if (wallet.dataSource === "demo") return respond(TaxReserveResponse, buildTaxReserve(wallet.id, t, t?.dataSource ?? "database"));
    const run = await runUserTax({ pool, prices: app.taxPrices, maxTransactions: config.TAX_MAX_TRANSACTIONS }, userId, q);
    return respond(TaxReserveResponse, taxReserveOf(wallet.id, run, t));
  };

  app.get("/api/tax-reserve/:walletId", { preHandler: auth }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req);
    return view(actorOf(req).userId, wallet, parse(TaxQuery, req.query));
  });

  /** Same estimate with the tax rates in the body (never in a URL). */
  app.post("/api/tax-reserve/:walletId/calculate", { preHandler: auth }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req);
    return view(actorOf(req).userId, wallet, parse(TaxCalculateRequest, req.body ?? {}));
  });

  app.post(
    "/api/tax-reserve/:walletId/target",
    { preHandler: auth, config: { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } } },
    async (req) => {
      const wallet = await ownedWalletFromParams(pool, req);
      const body = parse(SetTaxReserveTargetRequest, req.body);
      await upsertTaxReserveTarget(pool, actorOf(req).userId, targetFromRequest(body));
      return view(actorOf(req).userId, wallet, parse(TaxQuery, {}));
    },
  );
};
