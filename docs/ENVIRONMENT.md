# Environment
See `.env.example`. Never commit `.env`. `ADMIN_WALLET` and `TREASURY_WALLET` are public addresses only. Generate secrets with `openssl rand -hex 32`. Default cluster is devnet.

## API variables (Slice 1)
See `.env.example` for the full list. `DATABASE_URL` is required. `CORS_ORIGINS` must be exact origins. `AUTH_MODE` defaults to `wallet` (wallet-signature sign-in only); `dev-insecure` additionally enables the dev-only session endpoint, is for local development only, and is refused under `NODE_ENV=production`. Auth settings: `AUTH_ORIGIN` (must be one of `CORS_ORIGINS`; the sign-in message domain is derived from it), `SOLANA_CLUSTER` (`devnet` default; named in the message as `solana:<cluster>`), `NONCE_TTL_SECONDS` (default 300), `MAX_OPEN_NONCES_PER_ADDRESS` (default 10), `SESSION_TTL_HOURS` (default 12), `COOKIE_SAMESITE` (`strict` default), `COOKIE_SECURE` (production is always Secure). Production requires https-only `CORS_ORIGINS`. `HOST` defaults to `127.0.0.1`. Web: `NEXT_PUBLIC_API_MODE` (`mock` default | `api`) and `NEXT_PUBLIC_API_BASE_URL`, set in `apps/web/.env.local`. `NEXT_PUBLIC_*` values are visible to browsers: never put secrets there.

## Solana indexing variables (Slice 5)
`SOLANA_RPC_URL` (server only; empty disables indexing), `SOLANA_COMMITMENT`, `SOLANA_RPC_TIMEOUT_MS`, `INDEXER_INITIAL_TRANSACTION_LIMIT` (50), `INDEXER_MAX_TRANSACTIONS_PER_SYNC` (100), `INDEXER_MAX_TOKEN_ACCOUNTS`, `INDEXER_MAX_METADATA_LOOKUPS`, `INDEXER_MAX_RPC_CALLS_PER_SYNC`, `INDEXER_MAX_RUN_SECONDS`, `INDEXER_MIN_SYNC_INTERVAL_SECONDS`, `INDEXER_MAX_CONCURRENT_SYNCS`, `INDEXER_SYNC_RATE_LIMIT_MAX`, `INDEXER_SYNC_ON_LOGIN`, `PRICE_PROVIDER` (`none` | `coingecko`), `PRICE_API_URL`, `PRICE_API_KEY`, `PRICE_MAX_AGE_SECONDS`. Blank values mean "default". See `.env.example` and `docs/INDEXING.md`. Never commit a real RPC URL or key.

Try indexing without any real network (fake node, invented data, local only):
```
pnpm --filter @project-name/api fake:rpc                       # fake JSON-RPC on 127.0.0.1:8899
SOLANA_RPC_URL=http://127.0.0.1:8899 SOLANA_CLUSTER=devnet pnpm dev:api
```
Then sign in on the web app, open Portfolio, press SYNC WALLET. With a real devnet RPC URL instead, SOLANA_CLUSTER should match the cluster of the URL. Manual real-RPC check: `SOLANA_RPC_URL=... SMOKE_WALLET_ADDRESS=<public address> pnpm --filter @project-name/api smoke:rpc`.

## Tax variables (Slice 6)
`TAX_PRICE_MAX_AGE_SECONDS` (default 3600: a stored price counts for a transaction only if observed at most this long before it), `TAX_MAX_TRANSACTIONS` (default 5000: cap per calculation; beyond it the result is marked incomplete). There is no setting that enables fixture prices outside tests, on purpose. Tax rates are never configured server-side: the user supplies them per request, and none are assumed.

## Report and tax limits (Slice 8)
`REPORT_MAX_ROWS` (default 20000: disposals listed in a report; more is DATA_REQUIRED with a capped list and an export is refused with 413), `TAX_MAX_CONCURRENT` (16) and `TAX_MAX_CONCURRENT_PER_USER` (8): concurrent tax calculations, process-wide and per user; excess gets an immediate 503/429. Together with `TAX_MAX_TRANSACTIONS` these bound the work of any report or export.

## Run locally
```
cp .env.example .env            # edit DATABASE_URL
createdb project_name           # or any database you own
pnpm install
pnpm db:migrate && pnpm db:seed-demo
pnpm dev:all                    # API http://localhost:4000, web http://localhost:3000
```
Real wallet sign-in (Phantom, Solflare, Backpack or any Wallet Standard wallet; devnet is fine, no funds needed):
```
# apps/web/.env.local
NEXT_PUBLIC_API_MODE=api
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
# then pnpm dev:all, open http://localhost:3000 (use "localhost", not 127.0.0.1: it must match AUTH_ORIGIN/CORS_ORIGINS)
```
Optional dev-only session for the demo user (`AUTH_MODE=dev-insecure`): `curl -XPOST localhost:4000/api/auth/dev-session`.

Browser end-to-end check of the sign-in flow (starts nothing; needs API :4000 and web :3000 built with the api-mode env above):
`pnpm --filter @project-name/web e2e:api` (alias `e2e:auth`). The database must also be seeded (`pnpm db:seed-demo`) so the demo charities exist.
API e2e harness requirements (all four are needed; otherwise the run fails for reasons unrelated to the code):
- `INDEXER_SYNC_ON_LOGIN=false` on the API, so the wallet has no indexed data after sign-in and the empty states can be asserted.
- `INDEXER_MIN_SYNC_INTERVAL_SECONDS=2` on the API. The suite waits 2.5 s between syncs and also asserts the cooldown 429. This is a test-harness setting only, NOT a production recommendation; keep the default in real deployments.
- A fresh `pn_e2e` database every run (drop, create, `pnpm db:migrate`, `pnpm db:seed-demo`). Leftover wallets and transactions break the "no data yet" checks.
- A freshly started local fake RPC (`apps/api/scripts/fake-rpc-server.ts`, port 8899). It keeps state (the `new-tx` control endpoint adds a transaction), so a reused process breaks the "3 indexed, then 4" checks.
Also raise `RATE_LIMIT_MAX`, `RATE_LIMIT_WRITE_MAX` and set `INDEXER_SYNC_RATE_LIMIT_MAX=100` (the maximum the config accepts). The fake RPC is local; no real Solana RPC or price provider is used.
Mock-mode smoke (web built without the api env, any port): `E2E_WEB_URL=http://localhost:3112 pnpm --filter @project-name/web e2e:mock`
