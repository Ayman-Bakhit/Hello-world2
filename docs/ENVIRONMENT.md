# Environment
See `.env.example`. Never commit `.env`. `ADMIN_WALLET` and `TREASURY_WALLET` are public addresses only. Generate secrets with `openssl rand -hex 32`. Default cluster is devnet.

## API variables (Slice 1)
See `.env.example` for the full list. `DATABASE_URL` is required. `CORS_ORIGINS` must be exact origins. `AUTH_MODE` defaults to `disabled`; `dev-insecure` is for local development only and the API refuses it under `NODE_ENV=production`. `HOST` defaults to `127.0.0.1`. Web: `NEXT_PUBLIC_API_MODE` (`mock` default | `api`) and `NEXT_PUBLIC_API_BASE_URL`, set in `apps/web/.env.local`. `NEXT_PUBLIC_*` values are visible to browsers: never put secrets there.

## Run locally
```
cp .env.example .env            # edit DATABASE_URL
createdb project_name           # or any database you own
pnpm install
pnpm db:migrate && pnpm db:seed-demo
pnpm dev:all                    # API http://localhost:4000, web http://localhost:3000
# optional: point the web client at the API
echo 'NEXT_PUBLIC_API_MODE=api' > apps/web/.env.local
# dev session for the demo user (AUTH_MODE=dev-insecure only)
curl -XPOST localhost:4000/api/auth/dev-session
```
