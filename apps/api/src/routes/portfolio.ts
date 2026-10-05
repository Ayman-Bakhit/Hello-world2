import type { FastifyPluginAsync } from "fastify";
import { PortfolioResponse, buildPortfolio } from "@project-name/shared";
import { requireAuth } from "../auth/plugin";
import { notFound } from "../errors";
import { respond } from "../http/validate";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

/** DEMO-BACKED: ownership is checked in the database; balances come from demo fixtures (dataSource "demo"). */
export const portfolioRoutes: FastifyPluginAsync<Deps> = async (app, { pool }) => {
  app.get("/api/portfolio/:walletId", { preHandler: requireAuth(pool) }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req);
    // Only demo wallets have fixtures. A real (non-demo) wallet has no indexed data yet.
    const body = wallet.dataSource === "demo" ? buildPortfolio(wallet.id) : null;
    if (!body) throw notFound("Portfolio data");
    return respond(PortfolioResponse, body);
  });
};
