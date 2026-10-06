# Environment
See `.env.example`. Never commit `.env`. `ADMIN_WALLET` and `TREASURY_WALLET` are public addresses only. Generate secrets with `openssl rand -hex 32`. Default cluster is devnet.

## API variables (Slice 1)
See `.env.example` for the full list. `DATABASE_URL` is required. `CORS_ORIGINS` must be exact origins. `AUTH_MODE` defaults to `wallet` (wallet-signature sign-in only); `dev-insecure` additionally enables the dev-only session endpoint, is for local development only, and is refused under `NODE_ENV=production`. Auth settings: `AUTH_ORIGIN` (must be one of `CORS_ORIGINS`; the sign-in message domain is derived from it), `SOLANA_CLUSTER` (`devnet` default; named in the message as `solana:<cluster>`), `NONCE_TTL_SECONDS` (default 300), `MAX_OPEN_NONCES_PER_ADDRESS` (default 10), `SESSION_TTL_HOURS` (default 12), `COOKIE_SAMESITE` (`strict` default), `COOKIE_SECURE` (production is always Secure). Production requires https-only `CORS_ORIGINS`. `HOST` defaults to `127.0.0.1`. Web: `NEXT_PUBLIC_API_MODE` (`mock` default | `api`) and `NEXT_PUBLIC_API_BASE_URL`, set in `apps/web/.env.local`. `NEXT_PUBLIC_*` values are visible to browsers: never put secrets there.

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
