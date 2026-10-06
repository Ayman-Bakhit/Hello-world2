import type { FastifyPluginAsync } from "fastify";
import { PortfolioResponse, buildPortfolio } from "@project-name/shared";
import { requireAuth } from "../auth/plugin";
import { getSyncState, loadHoldings } from "../db/chainRepos";
import { noLiveData } from "../errors";
import { respond } from "../http/validate";
import { buildLivePortfolio } from "../services/live";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

/**
 * Demo wallets: fixtures (dataSource "demo"). Real wallets: ONLY indexed chain data; never fixtures.
 * A real wallet that has not been synced yet is a 404 NO_LIVE_DATA.
 */
export const portfolioRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  app.get("/api/portfolio/:walletId", { preHandler: requireAuth(pool, config) }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req);
    if (wallet.dataSource === "demo") return respond(PortfolioResponse, buildPortfolio(wallet.id));
    const holdings = await loadHoldings(pool, wallet.id);
    if (holdings.length === 0) throw noLiveData("portfolio data");
    const state = await getSyncState(pool, wallet.id);
    return respond(
      PortfolioResponse,
      buildLivePortfolio({
        walletId: wallet.id, holdings, cluster: config.SOLANA_CLUSTER, lastSyncedAt: state?.lastSuccessAt ?? null, nowMs: Date.now(),
        priceMaxAgeSeconds: config.PRICE_MAX_AGE_SECONDS, slot: state ? (holdings[0]?.slot ?? null) : null,
      }),
    );
  });
};
