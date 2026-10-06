import { classifyTransaction, type TokenAccountObservation } from "@project-name/shared";
import {
  assetsNeedingMetadata, finishRun, getSyncState, hasNormalized, insertBalanceObservation, insertNormalizedTransaction,
  insertRawTransaction, rawTransactionId, replaceHoldings, saveMetadata, savePrice, saveSyncState, upsertAsset, type RunRow,
} from "../db/chainRepos";
import type { Pool } from "../db/pool";
import type { PriceProvider } from "../prices/provider";
import { CountingRpc } from "../solana/budget";
import { SolanaRpcError, rpcErrorCode, type SolanaRpc, type TokenMetadataSource } from "../solana/types";

export interface SyncLimits {
  initialTransactionLimit: number;
  maxTransactionsPerSync: number;
  maxTokenAccounts: number;
  maxMetadataLookups: number;
  maxRpcCalls: number;
  maxRunSeconds: number;
}

export interface SyncDeps {
  pool: Pool;
  rpc: SolanaRpc;
  metadata: TokenMetadataSource | null;
  prices: PriceProvider;
  limits: SyncLimits;
  /** Prices are only meaningful on mainnet. On devnet/testnet no price is requested or stored. */
  pricesApply: boolean;
  now?: () => number;
}

const TRANSIENT = new Set(["timeout", "network", "http"]);

/**
 * One bounded, read-only sync of one wallet. Idempotent and restartable:
 *  - raw transactions are UNIQUE(chain, signature); normalized rows UNIQUE(wallet, raw); balance observations UNIQUE(account, slot)
 *  - the "newest indexed" anchor only advances when every signature in the fetched window was stored, so an interrupted
 *    or partial run is simply retried and already-stored transactions cost no RPC call
 *  - every RPC call goes through a budget; the loop is bounded by limits and a wall-clock cap
 * The `run` row must already exist (created by IndexerService.start so concurrent starts are rejected up front).
 */
export async function runWalletSync(d: SyncDeps, wallet: { id: string; address: string }, run: RunRow): Promise<void> {
  const { pool, limits } = d;
  const rpc = new CountingRpc(d.rpc, d.metadata, limits.maxRpcCalls);
  const now = d.now ?? Date.now;
  const deadline = now() + limits.maxRunSeconds * 1000;
  const counts: Record<string, number> = {
    transactionsFetched: 0, transactionsStored: 0, transactionsAlreadyIndexed: 0, transactionsSkipped: 0,
    tokenAccounts: 0, metadataResolved: 0, metadataUnavailable: 0, rpcCalls: 0,
  };
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  let slot: bigint | null = null;
  let incomplete = false;
  let firstError = null as { code: string; message: string } | null;
  const note = (e: unknown) => { incomplete = true; firstError ??= rpcErrorCode(e); };

  try {
    // ---- 1. balances ----
    const bal = await rpc.getBalance(wallet.address);
    slot = bal.slot;
    const sol = await upsertAsset(pool, { address: "native", decimals: 9 });
    await insertBalanceObservation(pool, { walletId: wallet.id, assetId: sol.id, tokenAccount: null, amount: bal.lamports, decimals: 9, slot: bal.slot, runId: run.id });
    const holdings = [{ assetId: sol.id, balance: bal.lamports, slot: bal.slot, tokenAccounts: 0 }];

    const tokens = await rpc.getTokenAccountsByOwner(wallet.address);
    let accounts: TokenAccountObservation[] = tokens.accounts;
    if (accounts.length > limits.maxTokenAccounts) {
      accounts = accounts.slice(0, limits.maxTokenAccounts);
      incomplete = true;
      counts.holdingsIncomplete = 1;
      firstError ??= { code: "TOKEN_ACCOUNT_LIMIT", message: `Wallet has more than ${limits.maxTokenAccounts} token accounts; only the first ${limits.maxTokenAccounts} are shown` };
    }
    counts.tokenAccounts = accounts.length;
    const perMint = new Map<string, { decimals: number; balance: bigint; accounts: number }>();
    const accountRows: { tokenAccount: string; mint: string; amount: bigint; decimals: number }[] = [];
    for (const a of accounts) {
      const m = perMint.get(a.mint);
      if (m && m.decimals !== a.decimals) { counts.holdingsIncomplete = 1; incomplete = true; firstError ??= { code: "RPC_MALFORMED", message: "Inconsistent token decimals reported for one mint" }; continue; }
      perMint.set(a.mint, { decimals: a.decimals, balance: (m?.balance ?? 0n) + a.amount, accounts: (m?.accounts ?? 0) + 1 });
      accountRows.push(a);
    }
    const assetIds = new Map<string, string>();
    for (const [mint, v] of perMint) {
      const asset = await upsertAsset(pool, { address: mint, decimals: v.decimals });
      if (asset.decimals !== v.decimals) { counts.holdingsIncomplete = 1; incomplete = true; firstError ??= { code: "RPC_MALFORMED", message: "Token decimals differ from the stored mint decimals" }; continue; }
      assetIds.set(mint, asset.id);
      holdings.push({ assetId: asset.id, balance: v.balance, slot: tokens.slot, tokenAccounts: v.accounts });
    }
    for (const a of accountRows) {
      const id = assetIds.get(a.mint);
      if (id) await insertBalanceObservation(pool, { walletId: wallet.id, assetId: id, tokenAccount: a.tokenAccount, amount: a.amount, decimals: a.decimals, slot: tokens.slot, runId: run.id });
    }
    await replaceHoldings(pool, wallet.id, holdings, run.id);

    // ---- 2. metadata (untrusted; bounded; failures leave the asset as "metadata unavailable") ----
    if (d.metadata && limits.maxMetadataLookups > 0) {
      const todo = (await assetsNeedingMetadata(pool, [...assetIds.values()])).slice(0, limits.maxMetadataLookups);
      for (const t of todo) {
        if (now() > deadline) { incomplete = true; break; }
        try {
          const m = await rpc.getTokenMetadata(t.mint);
          await saveMetadata(pool, t.id, m, m?.source ?? "metaplex_onchain");
          bump(m ? "metadataResolved" : "metadataUnavailable");
        } catch (e) {
          if (e instanceof SolanaRpcError && e.kind === "budget") { incomplete = true; break; }
          bump("metadataUnavailable"); // transient: leave unrecorded, retried next sync
        }
      }
    }

    // ---- 3. price (SOL only, mainnet only) ----
    if (d.pricesApply) {
      const q = (await d.prices.getPrices(["native"])).get("native");
      if (q) await savePrice(pool, sol.id, q.source, q.observedAt, q.priceMicroUsd);
    }

    // ---- 4. transactions ----
    const state = await getSyncState(pool, wallet.id);
    const first = !state?.newestSignature;
    const limit = first ? limits.initialTransactionLimit : limits.maxTransactionsPerSync;
    const sigs = await rpc.getSignaturesForAddress(wallet.address, first ? { limit } : { limit, until: state!.newestSignature! });
    let allStored = true;
    for (const s of sigs) {
      if (now() > deadline) { allStored = false; incomplete = true; firstError ??= { code: "SYNC_TIME_LIMIT", message: "Sync stopped at its time limit; run it again to continue" }; break; }
      try {
        const known = await rawTransactionId(pool, s.signature);
        if (known && (await hasNormalized(pool, wallet.id, known))) { bump("transactionsAlreadyIndexed"); continue; }
        const tx = await rpc.getTransaction(s.signature);
        bump("transactionsFetched");
        if (!tx) { bump("transactionsSkipped"); allStored = false; incomplete = true; firstError ??= { code: "TX_UNAVAILABLE", message: "A transaction could not be retrieved from the node" }; continue; }
        const c = classifyTransaction(wallet.address, tx.normalized);
        const deltas: { assetId: string; delta: bigint; decimals: number }[] = [];
        for (const x of c.deltas) deltas.push({ assetId: (await upsertAsset(pool, { address: x.asset, decimals: x.decimals })).id, delta: x.delta, decimals: x.decimals });
        const rawId = await insertRawTransaction(pool, { signature: tx.normalized.signature, slot: tx.normalized.slot, blockTime: tx.normalized.blockTime, payloadJson: tx.payloadJson });
        const stored = await insertNormalizedTransaction(pool, {
          rawId, walletId: wallet.id, kind: c.kind, failed: tx.normalized.failed, feeLamports: c.walletPaidFee ? c.feeLamports : 0n, slot: tx.normalized.slot,
          blockTime: tx.normalized.blockTime, reason: c.reason, version: c.version, programIds: tx.normalized.programIds, deltas,
        });
        bump(stored ? "transactionsStored" : "transactionsAlreadyIndexed");
      } catch (e) {
        if (!(e instanceof SolanaRpcError)) throw e;
        bump("transactionsSkipped"); allStored = false; note(e);
        if (e.kind === "budget" || TRANSIENT.has(e.kind)) break; // stop hammering a failing node
      }
    }

    // anchor + window bookkeeping: advance only when the whole fetched window is stored
    const newest = sigs[0];
    const oldest = sigs[sigs.length - 1];
    await saveSyncState(pool, wallet.id, {
      ...(allStored && newest ? { newest: { signature: newest.signature, slot: newest.slot } } : {}),
      ...(first && oldest ? { oldest: { signature: oldest.signature, slot: oldest.slot } } : {}),
      ...(first && allStored ? { historyComplete: sigs.length < limit } : {}),
      // a full page while chasing a known anchor means older-than-window transactions between runs may be missing
      ...(!first && sigs.length >= limit ? { hasGap: true } : {}),
      success: true, slot,
    });
    if (!first && sigs.length >= limit) { incomplete = true; firstError ??= { code: "SYNC_WINDOW_FULL", message: "More new transactions than one sync indexes; some in between may be missing" }; }
  } catch (e) {
    counts.rpcCalls = rpc.calls;
    const err = rpcErrorCode(e);
    await finishRun(pool, run.id, { status: "failed", slot, counts, error: err });
    return;
  }
  counts.rpcCalls = rpc.calls;
  await finishRun(pool, run.id, { status: incomplete ? "partial" : "succeeded", slot, counts, error: incomplete ? firstError : null });
}
