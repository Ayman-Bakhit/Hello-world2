import type { FastifyPluginAsync } from "fastify";
import { TaxDetailsResponse, TaxQuery, TaxResponse, buildTax, buildTaxDetails } from "@project-name/shared";
import { actorOf, requireAuth } from "../auth/plugin";
import { parse, respond } from "../http/validate";
import { runUserTax, taxDetailsOf, taxResponseOf } from "../services/tax";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

/**
 * Demo wallets: fixture estimate (dataSource "demo"). Real wallets: derived on demand from the user's INDEXED transactions
 * and stored prices by the shared engine; never demo data. Every response carries status, method, requirements and
 * provenance. Estimates for planning, not tax advice, and the underlying chain data is not independently verified.
 */
export const taxRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const limit = { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX * 3, timeWindow: config.RATE_LIMIT_WINDOW } };
  const run = (req: Parameters<typeof actorOf>[0], q: TaxQuery) =>
    runUserTax({ pool, prices: app.taxPrices, maxTransactions: config.TAX_MAX_TRANSACTIONS }, actorOf(req).userId, q);

  app.get("/api/tax/:walletId", { preHandler: requireAuth(pool, config), config: limit }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req);
    const q = parse(TaxQuery, req.query);
    if (wallet.dataSource === "demo") return respond(TaxResponse, buildTax(wallet.id));
    return respond(TaxResponse, taxResponseOf(wallet.id, await run(req, q)));
  });

  app.get("/api/tax/:walletId/details", { preHandler: requireAuth(pool, config), config: limit }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req);
    const q = parse(TaxQuery, req.query);
    if (wallet.dataSource === "demo") return respond(TaxDetailsResponse, buildTaxDetails(wallet.id));
    return respond(TaxDetailsResponse, taxDetailsOf(wallet.id, await run(req, q)));
  });
};
