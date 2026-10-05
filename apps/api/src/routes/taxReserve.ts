import type { FastifyPluginAsync } from "fastify";
import { SetTaxReserveTargetRequest, TaxReserveResponse, buildTaxReserve, targetFromRequest } from "@project-name/shared";
import { actorOf, requireAuth } from "../auth/plugin";
import { getTaxReserveTarget, upsertTaxReserveTarget } from "../db/repos";
import { notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

/**
 * GET: target from the database; reserve balance and exposure from demo fixtures (labeled).
 * POST: stores the target configuration ONLY. No transfer, approval, or signing path exists here.
 */
export const taxReserveRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const auth = requireAuth(pool);

  const view = async (userId: string, walletId: string) => {
    const t = await getTaxReserveTarget(pool, userId);
    return respond(TaxReserveResponse, buildTaxReserve(walletId, t, t?.dataSource ?? "database"));
  };

  app.get("/api/tax-reserve/:walletId", { preHandler: auth }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req);
    if (wallet.dataSource !== "demo") throw notFound("Tax reserve data");
    return view(actorOf(req).userId, wallet.id);
  });

  app.post(
    "/api/tax-reserve/:walletId/target",
    { preHandler: auth, config: { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } } },
    async (req) => {
      const wallet = await ownedWalletFromParams(pool, req);
      if (wallet.dataSource !== "demo") throw notFound("Tax reserve data");
      const body = parse(SetTaxReserveTargetRequest, req.body);
      await upsertTaxReserveTarget(pool, actorOf(req).userId, targetFromRequest(body));
      return view(actorOf(req).userId, wallet.id);
    },
  );
};
