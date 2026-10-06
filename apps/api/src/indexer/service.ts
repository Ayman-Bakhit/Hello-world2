import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config";
import { beginRun, failStaleRuns, lastStartedAt, latestRun, runningRun, type RunRow } from "../db/chainRepos";
import type { Pool } from "../db/pool";
import { CoinGeckoPriceProvider, NullPriceProvider, type PriceProvider } from "../prices/provider";
import { JsonRpcSolanaProvider } from "../solana/rpc";
import type { SolanaRpc, TokenMetadataSource } from "../solana/types";
import { runWalletSync, type SyncLimits } from "./sync";

export interface IndexerParts {
  rpc: SolanaRpc | null;
  metadata: TokenMetadataSource | null;
  prices: PriceProvider;
}

export function createIndexerParts(config: Config): IndexerParts {
  const prices: PriceProvider =
    config.PRICE_PROVIDER === "coingecko" && config.PRICE_API_URL
      ? new CoinGeckoPriceProvider({ baseUrl: config.PRICE_API_URL, apiKey: config.PRICE_API_KEY, timeoutMs: 5000 })
      : new NullPriceProvider();
  if (!config.SOLANA_RPC_URL) return { rpc: null, metadata: null, prices };
  const p = new JsonRpcSolanaProvider({ url: config.SOLANA_RPC_URL, cluster: config.SOLANA_CLUSTER, commitment: config.SOLANA_COMMITMENT, timeoutMs: config.SOLANA_RPC_TIMEOUT_MS });
  return { rpc: p, metadata: p, prices };
}

export type StartResult =
  | { kind: "started"; run: RunRow }
  | { kind: "already_running"; run: RunRow }
  | { kind: "cooldown"; nextAllowedAt: Date }
  | { kind: "busy" }
  | { kind: "unavailable" };

/**
 * Starts wallet syncs in the background of the API process. At most one run per wallet (database-enforced), a global
 * concurrency cap, and a per-wallet cooldown. Nothing here can write to the chain.
 */
export class IndexerService {
  private active = 0;
  private readonly inflight = new Set<Promise<void>>();

  constructor(private readonly pool: Pool, private readonly config: Config, private readonly parts: IndexerParts, private readonly log?: FastifyBaseLogger) {}

  get configured(): boolean { return this.parts.rpc !== null; }
  get priceProviderName(): string { return this.parts.prices.name; }
  get cluster(): string { return this.config.SOLANA_CLUSTER; }

  get limits(): SyncLimits {
    const c = this.config;
    return {
      initialTransactionLimit: c.INDEXER_INITIAL_TRANSACTION_LIMIT, maxTransactionsPerSync: c.INDEXER_MAX_TRANSACTIONS_PER_SYNC,
      maxTokenAccounts: c.INDEXER_MAX_TOKEN_ACCOUNTS, maxMetadataLookups: c.INDEXER_MAX_METADATA_LOOKUPS,
      maxRpcCalls: c.INDEXER_MAX_RPC_CALLS_PER_SYNC, maxRunSeconds: c.INDEXER_MAX_RUN_SECONDS,
    };
  }

  /** Called once at startup: close runs orphaned by a crash. */
  async sweepStale(): Promise<void> {
    await failStaleRuns(this.pool, this.config.INDEXER_MAX_RUN_SECONDS + 60);
  }

  async nextAllowedAt(walletId: string): Promise<Date | null> {
    const last = await lastStartedAt(this.pool, walletId);
    if (!last) return null;
    const t = new Date(last.getTime() + this.config.INDEXER_MIN_SYNC_INTERVAL_SECONDS * 1000);
    return t.getTime() > Date.now() ? t : null;
  }

  async start(wallet: { id: string; address: string }, trigger: RunRow["trigger"]): Promise<StartResult> {
    if (!this.parts.rpc) return { kind: "unavailable" };
    const running = await runningRun(this.pool, wallet.id);
    if (running) return { kind: "already_running", run: running };
    const wait = await this.nextAllowedAt(wallet.id);
    if (wait) return { kind: "cooldown", nextAllowedAt: wait };
    if (this.active >= this.config.INDEXER_MAX_CONCURRENT_SYNCS) return { kind: "busy" };
    const run = await beginRun(this.pool, wallet.id, trigger, { ...this.limits });
    if (!run) return { kind: "already_running", run: (await runningRun(this.pool, wallet.id)) ?? (await latestRun(this.pool, wallet.id))! };
    this.active++;
    const p = runWalletSync(
      { pool: this.pool, rpc: this.parts.rpc, metadata: this.parts.metadata, prices: this.parts.prices, limits: this.limits, pricesApply: this.config.SOLANA_CLUSTER === "mainnet" },
      wallet, run,
    )
      .catch((e: unknown) => this.log?.error({ err: { name: (e as Error).name, message: (e as Error).message } }, "wallet sync crashed"))
      .finally(() => { this.active--; this.inflight.delete(p); });
    this.inflight.add(p);
    return { kind: "started", run };
  }

  /** Resolves when every in-flight sync has finished (tests, graceful shutdown). */
  async drain(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }
}
