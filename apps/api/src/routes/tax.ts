import type { FastifyPluginAsync } from "fastify";
import { TaxResponse, buildTax } from "@project-name/shared";
import { requireAuth } from "../auth/plugin";
import { noLiveData } from "../errors";
import { respond } from "../http/validate";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

/** DEMO-BACKED estimate computed by the shared tax engine. Fields are "estimated*"; there is no tax-bill field. */
export const taxRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  app.get("/api/tax/:walletId", { preHandler: requireAuth(pool, config) }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req);
    if (wallet.dataSource !== "demo") throw noLiveData("tax data");
    return respond(TaxResponse, buildTax(wallet.id));
  });
};
