import type { FastifyPluginAsync } from "fastify";
import { TaxResponse, buildTax } from "@project-name/shared";
import { requireAuth } from "../auth/plugin";
import { notFound } from "../errors";
import { respond } from "../http/validate";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

/** DEMO-BACKED estimate computed by the shared tax engine. Fields are "estimated*"; there is no tax-bill field. */
export const taxRoutes: FastifyPluginAsync<Deps> = async (app, { pool }) => {
  app.get("/api/tax/:walletId", { preHandler: requireAuth(pool) }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req);
    if (wallet.dataSource !== "demo") throw notFound("Tax data");
    return respond(TaxResponse, buildTax(wallet.id));
  });
};
