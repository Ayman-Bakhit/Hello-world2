# Solana indexing (Slice 5)

Read-only. The indexer reads public chain data for a wallet the user has proven they control, stores it, and serves it as the Portfolio and Transactions. It never signs, never sends, never holds a key, and has no code path that could.

## Data flow
```
Wallet (authenticated)  ->  POST /api/wallets/:id/sync  (ownership check, rate limit, cooldown)
   IndexerService (1 run per wallet, global cap)  ->  runWalletSync
      SolanaRpc (JsonRpcSolanaProvider, SOLANA_RPC_URL, server only)   getBalance / getTokenAccountsByOwner /
                                                                       getSignaturesForAddress / getTransaction / getAccountInfo
      every response: size cap -> lossless JSON parse -> envelope check -> Zod normalizer (packages/shared/src/chain/parse.ts)
   raw_transactions (immutable)  ->  classify  ->  transactions + transaction_asset_deltas (derived)
   balance_observations (append-only)  ->  token_holdings (derived, replaced per sync)
   asset_metadata (untrusted token text), price_observations (named source + time)
GET /api/portfolio | /api/transactions  ->  services/live.ts  ->  shared contracts (Zod)  ->  web (LIVE DATA)
```
Pieces and where they live: provider interface `apps/api/src/solana/types.ts`, provider `solana/rpc.ts`, budget `solana/budget.ts`, deterministic fake `solana/fake.ts`, price abstraction `prices/provider.ts`, SQL `db/chainRepos.ts`, sync `indexer/sync.ts`, orchestration `indexer/service.ts`, view builders `services/live.ts`, parsing/classification (pure, shared with tests) `packages/shared/src/chain/`.

## Replaceable RPC
`SolanaRpc` and `TokenMetadataSource` are interfaces. Production uses `JsonRpcSolanaProvider` (plain JSON-RPC over fetch, no vendor SDK). A different provider (a vendor API, Helius, a self-hosted node) is a new class implementing the same interface. Tests use `FakeSolanaRpc`. The URL is read from `SOLANA_RPC_URL`, is never logged, returned in a response, or put in an error message (tested), and is refused in production unless https.

## What is stored
| What | Where | Mutable? |
|---|---|---|
| Original `getTransaction` JSON | `raw_transactions.payload` (UNIQUE chain+signature) | No (trigger) |
| Balance an RPC node reported at a slot | `balance_observations` (UNIQUE wallet+asset+account+slot) | No (trigger) |
| Current holdings | `token_holdings` | Derived; rebuilt every sync |
| Normalized transaction + label + reason + classifier version | `transactions`, `transaction_asset_deltas` (UNIQUE wallet+raw) | Derived; rebuildable from raw |
| Token name/symbol/uri | `asset_metadata` | Untrusted text, refreshed |
| Prices | `price_observations` (provider, observed_at) | Append |
| Run history and sync window | `wallet_sync_runs`, `wallet_sync_state` | Bookkeeping |

## Sync algorithm (bounded, idempotent, restartable)
1. A run row is inserted first. A partial unique index allows only one `running` run per wallet, across processes. A per-wallet cooldown (`INDEXER_MIN_SYNC_INTERVAL_SECONDS`) and a global concurrency cap apply. Runs orphaned by a crash are failed at startup.
2. Balance and token accounts are read. SOL and each mint get an `assets` row (`ON CONFLICT DO NOTHING`; a mint whose decimals disagree with the stored decimals is skipped and reported). Holdings are replaced inside one DB transaction.
3. Metadata is looked up for up to `INDEXER_MAX_METADATA_LOOKUPS` mints that have none. Failures leave the asset "metadata unavailable" and do not fail the sync.
4. SOL price (mainnet and configured provider only).
5. Signatures: first sync fetches the newest `INDEXER_INITIAL_TRANSACTION_LIMIT`; later syncs fetch at most `INDEXER_MAX_TRANSACTIONS_PER_SYNC` newer than the stored anchor (`until`). Each signature already stored costs no RPC call. Each new one is fetched, stored raw, classified, and normalized in order.
6. The anchor (newest indexed signature) advances only if every signature in the window was stored. A partial run is simply retried. If a later sync returns a full page while chasing the anchor, `has_gap` is set: transactions between syncs may be missing, and the UI says so. `history_complete` is true only when the first sync reached the end of the wallet's history.
7. Bounds: every RPC call is counted (`INDEXER_MAX_RPC_CALLS_PER_SYNC`), the loop stops at `INDEXER_MAX_RUN_SECONDS`, and a transient RPC failure (timeout/network/5xx) stops the transaction loop instead of hammering the node. There are no unbounded loops and no pagination to genesis.

Reorgs: reads use `finalized` by default, so reorg handling is not implemented and not needed for that setting. With `confirmed` a rare reorg could leave a stored transaction that later disappears; this is not handled. Verify before using `confirmed`.

## Classification (conservative, not tax)
`packages/shared/src/chain/classify.ts` (version `1`). A label is produced only when the wallet's own balance change and the programs involved make it unambiguous. Otherwise `UNKNOWN`, with a reason.
| Label | Rule |
|---|---|
| `TRANSFER` | SOL moved, no token change, only System/ComputeBudget/Memo programs |
| `TOKEN_RECEIPT` / `TOKEN_SEND` | exactly one mint changed, no SOL change (fee excluded), only token/ATA/System programs |
| `SWAP` | assets decreased and increased AND a program from `KNOWN_DEX_PROGRAMS` was involved |
| `FEE` | failed transaction the wallet paid for, or no movement and the wallet only paid the fee |
| `UNKNOWN` | everything else (NFT/stake/lending/multi-leg/unknown programs, mixed directions, wallet not involved) |
Fee: reported separately (`feeLamports`, only when the wallet was the fee payer); SOL deltas exclude it. Every record keeps its reason, classifier version, program ids and the raw record reference, so a label can be re-derived.
**Limitations (read before trusting a label):** the DEX list is a hand-written heuristic and is **unverified** against a live network; wrapped SOL, closed token accounts (rent), airdrops, staking, LP, NFTs, Token-2022 transfer fees and multi-hop routes are not modeled and will usually be `UNKNOWN`; a token received and swapped in one transaction may be `SWAP` or `UNKNOWN`; a self-transfer between two wallets you own is a `TRANSFER` in and out, not "internal". **Nothing here says taxable, disposal, income, or gift.** Live transactions carry `taxTreatment: "not_assessed"` and the tax endpoints stay `NO_LIVE_DATA` for real wallets until a later slice defines the boundary.

## Token metadata is untrusted
Name/symbol/uri come from the Metaplex metadata account written by the token's update authority. They are length-bounded, stripped of control and bidi characters, URI scheme-allowlisted (https/ipfs/ar), stored as text, rendered by React (escaped), labeled UNVERIFIED METADATA, and the uri is never fetched. A token calling itself "USDC" is shown by its **mint**, not promoted to a symbol. There is no objective verification source yet, so `verified` is always `false`. The PDA derivation and byte layout are implemented from the public Metaplex layout and are **unverified against a live network** (use `pnpm --filter @project-name/api smoke:rpc`).

## Prices and valuation
No hardcoded prices. `PRICE_PROVIDER=none` (default): every asset is `price_unavailable`. `coingecko`: SOL/USD only, mainnet only (devnet SOL has no value), parsed from the response text without floats. SPL tokens have no price source. A missing price is never zero: the asset has no value, `totalValueCents` is `null` unless every shown asset is priced, and a partial sum is returned separately and labeled. A price older than `PRICE_MAX_AGE_SECONDS` is `stale_price`. The UI shows three separate things: ON-CHAIN BALANCE, PRICE, USD VALUE.

## Demo vs live
Demo wallets (seeded) get fixtures labeled DEMO DATA and refuse sync. Real wallets get only indexed data (`dataSource: "chain"`, `verifiedOnChain: false`: observed from an RPC node, not independently verified) or `404 NO_LIVE_DATA`. No endpoint falls back from live to demo.

## Testing
See TESTING.md. A deterministic fake RPC (in-process and as an HTTP server, `pnpm --filter @project-name/api fake:rpc`) drives the unit/integration/browser tests. `pnpm --filter @project-name/api smoke:rpc` is a separate **manual** real-RPC check (not in CI, not run in the build sandbox, which blocks RPC egress).
