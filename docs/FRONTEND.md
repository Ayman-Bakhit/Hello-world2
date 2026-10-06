# Frontend (Slice 3)

Next.js 16 (App Router, Turbopack), React 19, Tailwind 4, strict TypeScript. No UI library, no chart library, no web fonts (system stack, so builds work offline). Only runtime deps: `next`, `react`, `react-dom`, `@project-name/shared`.

Start: `pnpm install && pnpm dev` then open http://localhost:3000.

**Everything on screen is DEMO DATA.** No RPC, no wallet extension, no network calls, no persistence.

## Routes and the API endpoints each screen uses (Slice 4)
Screens load through the typed client (`src/lib/api/client.ts`). `:walletId` is always the authenticated session's wallet (from `GET /api/wallets`), never typed by the user.

| Route | Screen | Endpoints (api mode) | Needs sign-in |
|---|---|---|---|
| `/` | Landing (hero, buckets, Verify Don't Trust) | none (static sample values, labeled DEMO DATA) | no |
| `/connect` | Connect wallet (same panel as the modal) | `GET /auth/session`, `POST /auth/nonce`, `POST /auth/verify`, `POST /auth/logout` | no |
| `/portfolio` | Totals, sortable holdings, recent transactions, linked tax/reserve/giving figures | `GET /wallets`, `/portfolio/:id`, `/transactions/:id`, `/tax/:id`, `/tax-reserve/:id`, `/donations/:id` | yes |
| `/tax` | Tax Center | `GET /wallets`, `/tax/:id`, `/tax-reserve/:id`, `/transactions/:id` | yes |
| `/tax-reserve` | Reserve status + reserve TARGET editor; ADD FUNDS / WITHDRAW disabled | `GET /wallets`, `GET /tax-reserve/:id`, `POST /tax-reserve/:id/target` | yes |
| `/give` | CHARITY INFORMATION, ACTUAL ON-CHAIN DONATION (unavailable), donation records | `GET /charities` (public), `GET /wallets`, `GET /donations/:id` | records: yes |
| `/launch` | PREPARE LAUNCH wizard, saved configurations | `GET /charities`, `POST /launches`, `POST /launches/:id/review`, `GET /launches`, `GET /launches/:id` | save/list: yes |
| `/launch/configuration` | Fee split + charity + reserve destination workbench | `GET /charities` | no (saving is on `/launch`) |
| `/token/[slug]` | Proof page | `GET /tokens/:id/proof`, `GET /tokens` | no |
| `/discover` | Filters wired to API parameters | `GET /discover` | no |
| `/analytics` `/vaults` `/documents` | Placeholders (no endpoints exist; nothing is fabricated) | none | n/a |
| `/trust` | Trust Center | none | no |

Transactions are shown inside Portfolio and Tax (there is no separate transactions route). Mock mode (`NEXT_PUBLIC_API_MODE` unset or `mock`) uses the same client and screens; the client answers from shared demo fixtures and in-memory stand-ins (saved targets/launches live only in the tab).

All routes are statically prerendered shells; data loads in the browser. One shared shell (`AppShell`: sidebar, top bar, global notice) wraps everything from the root layout; the sidebar becomes a drawer below `lg`.

## Structure
```
src/app          routes only (server components; thin)
src/components   UI. Client components only where state is needed
src/lib          pure logic: format, portfolio math, fee-draft parsing, launch validation, discover rules, types
src/mock         demo constants still used by the landing page, wizard defaults, and tests (screens read the API client instead)
src/components/screens   one container per route (data loading) + exported pure views (testable)
src/state        React context: mock wallet, launch wizard config (in-memory)
```
Required components exist as: Sidebar, TopBar, DemoDataBanner, StatCard, PortfolioTable, FeeSplitEditor, AllocationBar, CharityCard, TaxReserveCard, TransactionTable, RiskPanel, ProofPanel, LaunchWizard, WalletConnectModal, PageHeader, EmptyState. Extras: Badge, Button, Card, ValueChart, SigningDialog ("WHAT YOU ARE SIGNING"), WalletMenu, GiveClient, DiscoverClient, TaxReserveControls, ConfigurationWorkbench.

## Shared math reuse
- Fee split: `parseFeeDrafts` (src/lib/feeDrafts.ts) only maps UI text to bps and error strings; `percentToBps`, `validateFeeSplit`, `splitAmount` come from `@project-name/shared`. Invalid totals disable review/deploy and show the exact reason (e.g. "Total is 100.01% (10001 bps)... Remove 0.01%.").
- Tax reserve coverage/shortfall: `reserveStatus`. "% of gains" targets: `percentOfGains`. Approved copy: `COPY`.
- Money is bigint cents everywhere; percentages are integer bps. Number() is used only for compact display and chart geometry.

## Mock data design
- Types in `src/lib/types.ts` (Wallet, Asset, Holding, Portfolio, Transaction, TaxEstimateView, TaxReserve, Charity, Donation, Token, FeeSplit, LaunchConfiguration).
- One consistent demo universe (asserted in `mock.test.ts`): portfolio $42,810.00; realized $58,100; exposure $18,420 (recomputed by the shared engine from the stated rates); reserve $14,200 = 77.1% coverage, $4,220 more; donations $1,840.
- Deliberate deviation from the brief's examples: the brief uses $14,000/76% on the Tax Center and $11,240 on the landing but $14,200/77.1% on the Reserve page. Demo data uses $14,200 everywhere so screens agree.
- Fictional names are tagged "(demo)"; addresses start with `DEMO`; signatures are `DEMO-SIG-*`; no explorer links are rendered; no demo token has a contract address.
- Discover ranking uses a fixed reference date so output is deterministic.

## What is still mocked (replace later)
| Mock | Replace with |
|---|---|
| `state/wallet.tsx` | Wallet Standard adapters + nonce sign-in verified by API (Slice 2/3b) |
| `mock/portfolio`, `transactions` | Indexer + price service (Slices 4-5) |
| `mock/tax` | Tax worker running `packages/shared` engine on indexed lots (Slice 6) |
| Reserve/Give/Launch signing dialogs | Server-built, simulated transactions decoded client-side (Slices 7-9) |
| `mock/charities` | Admin-verified charity registry (Slice 8) |
| `mock/tokens`, proof/risk panels | On-chain reads of authorities, liquidity, fee routing; label IMMUTABLE vs ADMIN CONTROLLED derived from chain (Slices 9-10) |
| Discover ranking | Real data; add wash-trade detection before "Trending" means anything |
| Analytics / Vaults / Documents | Real pages after indexer |

## API client layer (Slice 1)
`src/lib/api/` exposes `getPortfolio`, `getTaxEstimate`, `getTaxReserve`, `getCharities`, `getDonations`, `getLaunches`, `getLaunch`, `getTokenProof`, `getDiscover`. `NEXT_PUBLIC_API_MODE=mock` (default) builds responses locally from shared demo fixtures; `api` calls the Fastify API (`NEXT_PUBLIC_API_BASE_URL`, default http://localhost:4000) and validates every response with the shared Zod schemas. Every wallet-scoped screen now reads through this client (see the table above). Browsers authenticate with the HttpOnly cookie; a bearer token (dev/API clients only) would live in memory via `setSessionToken`, and the UI never sets one.

## Wallet authentication in the UI (Slice 2)
`NEXT_PUBLIC_API_MODE=api` turns on the real flow in `src/state/wallet.tsx`; the default `mock` keeps the demo connection (it never reports authenticated).
```
CONNECT WALLET -> pick Phantom / Solflare / Backpack (Wallet Standard; others listed if detected)
 -> wallet connects            status: CONNECTED   (amber, "Not authenticated yet")
 -> explanation shown: "Sign this message to securely authenticate with PROJECT_NAME. This does not send a transaction or move funds."
 -> SIGN MESSAGE: POST /api/auth/nonce, client checks the challenge is for this wallet + origin, message is displayed,
    wallet signs the TEXT, POST /api/auth/verify
 -> API sets an HttpOnly cookie    status: AUTHENTICATED (green)
 -> page load asks GET /api/auth/session (the cookie is invisible to JS); LOG OUT & DISCONNECT calls /api/auth/logout
```
No private key, seed phrase, or session secret is ever handled by the frontend; nothing is stored in web storage (a test enforces it). Components: `WalletConnectModal` (3-step panel), `WalletMenu` (CONNECTED/AUTHENTICATED badge, sign-in prompt, address-mismatch warning, logout), `lib/walletStandard.ts`, `lib/api/auth.ts`. In api mode, adding wallets / labels is disabled (needs wallet-linking endpoints). 

## Authenticated application state (Slice 4)
- `GET /api/auth/session` is asked on page load; the three states are explicit in the shell: **DISCONNECTED**, **CONNECTED** (extension address only, shown amber), **AUTHENTICATED** (server verified a signature, green). Mock mode shows `CONNECTED · DEMO` and never AUTHENTICATED.
- `sessionChecked` stops screens flashing the wrong state before the first answer. Any API call that returns 401 triggers a session re-check (`useResource` -> `refreshSession`), so an expired or revoked session drops the UI back to CONNECTED/DISCONNECTED instead of showing stale data.
- Logout (`LOG OUT` in the sidebar or the wallet menu) calls `POST /api/auth/logout` (server-side revoke), disconnects the wallet, and resets state. No token is ever in JavaScript, `localStorage`, or `sessionStorage`.

## Demo data vs live data (rule enforced in the UI)
Labels derive only from the API response (`dataSource`, `verifiedOnChain`): `demo` -> **DEMO DATA**; `chain` + verified -> **LIVE DATA** (nothing returns this yet); `database` -> **ACCOUNT DATA**.
- An authenticated real wallet has no indexed data, so the API answers `404 NO_LIVE_DATA` and the UI shows **NO LIVE ... DATA YET** ("Your wallet is authenticated, but blockchain indexing has not been connected yet."). Demo balances are never rendered for it. Tests assert the empty state contains none of the demo values.
- Demo records in the API are always labeled; a donation is only "CONFIRMED ON-CHAIN" if the API says `confirmed` (needs a recorded transaction).
- "VERIFIED TRANSPARENCY" appears only if the API reports `verifiedOnChain` and all checks (`lib/transparency.ts`). Demo tokens show `n/9 CHECKS REPORTED · DEMO` and the banner "BLOCKCHAIN VERIFICATION NOT YET CONNECTED".
- Price-history items (24h/7d/30d/YTD, value chart) are not in the API, so they are shown as "price service not connected" rather than invented.

## Shared states (`components/states.tsx`, `DataSource.tsx`)
`LoadingState`, `NoLiveData`, `UnauthenticatedState`/`AuthRequired` (AUTHENTICATION REQUIRED), `ApiErrorState`, `UnavailableState` (FEATURE COMING SOON / COMING LATER), `DataSourceBadge`, `DemoDataNotice`, and `ResourceView` which applies them uniformly to a loaded resource. All errors go through `describeApiError` (`lib/api/errors.ts`): 401, 403, 404 (NO_LIVE_DATA vs not found), 400 (field messages), 409/422 (our own message), 429 (retry), 5xx/network/unknown (generic text; server details never shown).

## Known limits and risks
- Wallet state and wizard state are in-memory; a hard reload resets them (by design for now).
- "VERIFIED TRANSPARENCY" is not awarded anywhere; demo tokens show "n/9 CHECKS REPORTED · DEMO". Nothing is labeled IMMUTABLE.
- No CSP/security headers yet (Slice 11). `poweredByHeader` is off.
- Accessibility: keyboard and ARIA basics done (dialog roles, aria-sort, live regions, focus styles). Not audited; modals do not trap focus fully.
- Unit tests render the pure views to static HTML; browser checks are Playwright scripts in `apps/web/e2e` (run manually, not in CI).
