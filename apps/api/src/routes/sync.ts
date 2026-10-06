import type { FastifyPluginAsync } from "fastify";
import { StartSyncResponse, SyncStatusResponse } from "@project-name/shared";
import { requireAuth } from "../auth/plugin";
import { getSyncState, indexedTransactionCount, latestRun } from "../db/chainRepos";
import { ApiError } from "../errors";
import { respond } from "../http/validate";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

/**
 * On-demand, read-only indexing of the signed-in user's own wallet. Ownership is checked in SQL; foreign wallets are 404.
 * Rate limited per IP here and per wallet by a cooldown in the indexer. Starting a sync never touches the chain except to READ.
 */
export const syncRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const auth = requireAuth(pool, config);

  app.get("/api/wallets/:id/sync", { preHandler: auth }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req, "id");
    const indexer = app.indexer;
    const demo = wallet.dataSource === "demo";
    const [run, state, count, next] = await Promise.all([
      latestRun(pool, wallet.id), getSyncState(pool, wallet.id), indexedTransactionCount(pool, wallet.id), indexer.nextAllowedAt(wallet.id),
    ]);
    const lastIsRunning = run?.status === "running";
    const state_ = demo ? "unsupported_demo_wallet" : !indexer.configured ? "indexing_unavailable" : lastIsRunning ? "syncing" : !run ? "never_synced" : state?.lastSuccessAt ? (run.status === "failed" ? "failed" : "synced") : "failed";
    return respond(SyncStatusResponse, {
      walletId: wallet.id, state: state_, configured: indexer.configured, cluster: indexer.cluster, priceProvider: indexer.priceProviderName,
      limits: { initialTransactionLimit: config.INDEXER_INITIAL_TRANSACTION_LIMIT, maxTransactionsPerSync: config.INDEXER_MAX_TRANSACTIONS_PER_SYNC, minSyncIntervalSeconds: config.INDEXER_MIN_SYNC_INTERVAL_SECONDS },
      lastRun: run, lastSuccessAt: state?.lastSuccessAt ?? null,
      window: state ? { newestSlot: state.newestSlot, oldestSlot: state.oldestSlot, historyComplete: state.historyComplete, hasGap: state.hasGap, indexedCount: count } : null,
      nextAllowedAt: next ? next.toISOString() : null,
    });
  });

  app.post(
    "/api/wallets/:id/sync",
    { preHandler: auth, config: { rateLimit: { max: config.INDEXER_SYNC_RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW } } },
    async (req, reply) => {
      const wallet = await ownedWalletFromParams(pool, req, "id");
      if (wallet.dataSource === "demo") throw new ApiError(409, "SYNC_UNSUPPORTED", "Demo wallets are not indexed. Demo data is fixture data.");
      const r = await app.indexer.start(wallet, "manual");
      switch (r.kind) {
        case "unavailable": throw new ApiError(503, "INDEXING_UNAVAILABLE", "Blockchain indexing is not configured on this server (SOLANA_RPC_URL is not set).");
        case "busy": throw new ApiError(503, "INDEXER_BUSY", "The indexer is busy. Try again shortly.");
        case "cooldown": {
          const secs = Math.max(1, Math.ceil((r.nextAllowedAt.getTime() - Date.now()) / 1000));
          void reply.header("retry-after", String(secs));
          throw new ApiError(429, "SYNC_COOLDOWN", `This wallet was synced very recently. Try again in ${secs}s.`);
        }
        case "already_running": return reply.code(200).send(respond(StartSyncResponse, { run: r.run, alreadyRunning: true }));
        case "started": return reply.code(202).send(respond(StartSyncResponse, { run: r.run, alreadyRunning: false }));
      }
    },
  );
};
