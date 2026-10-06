import type { FastifyPluginAsync } from "fastify";
import { TransactionsQuery, TransactionsResponse, buildTransactions } from "@project-name/shared";
import { requireAuth } from "../auth/plugin";
import { getSyncState, indexedTransactionCount, loadTransactions } from "../db/chainRepos";
import { noLiveData } from "../errors";
import { parse, respond } from "../http/validate";
import { buildLiveTransactions } from "../services/live";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

/** Demo wallets: fixtures. Real wallets: indexed chain transactions only (404 NO_LIVE_DATA until a sync has succeeded). */
export const transactionRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  app.get("/api/transactions/:walletId", { preHandler: requireAuth(pool, config) }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req);
    const { limit, offset } = parse(TransactionsQuery, req.query);
    if (wallet.dataSource === "demo") return respond(TransactionsResponse, buildTransactions(wallet.id, limit, offset));
    const state = await getSyncState(pool, wallet.id);
    if (!state?.lastSuccessAt) throw noLiveData("transaction data");
    const { rows, total } = await loadTransactions(pool, wallet.id, limit, offset);
    return respond(
      TransactionsResponse,
      buildLiveTransactions({
        walletId: wallet.id, rows, total, limit, offset, cluster: config.SOLANA_CLUSTER,
        window: { newestSlot: state.newestSlot, oldestSlot: state.oldestSlot, historyComplete: state.historyComplete, hasGap: state.hasGap, indexedCount: await indexedTransactionCount(pool, wallet.id) },
      }),
    );
  });
};
