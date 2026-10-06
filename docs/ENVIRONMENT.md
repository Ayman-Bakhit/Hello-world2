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
Mock-mode smoke (web built without the api env, any port): `E2E_WEB_URL=http://localhost:3112 pnpm --filter @project-name/web e2e:mock`
