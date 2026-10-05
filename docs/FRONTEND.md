# Frontend (Slice 3)

Next.js 16 (App Router, Turbopack), React 19, Tailwind 4, strict TypeScript. No UI library, no chart library, no web fonts (system stack, so builds work offline). Only runtime deps: `next`, `react`, `react-dom`, `@project-name/shared`.

Start: `pnpm install && pnpm dev` then open http://localhost:3000.

**Everything on screen is DEMO DATA.** No RPC, no wallet extension, no network calls, no persistence.

## Routes
| Route | Screen |
|---|---|
| `/` | Landing (hero, four buckets, Verify Don't Trust) |
| `/connect` | Connect wallet (same panel as the modal) |
| `/portfolio` | Totals, changes, sortable holdings, transactions |
| `/tax` | Tax Center (estimates, assumptions, disposals) |
| `/tax-reserve` | Reserve status, add/withdraw summary, adjust target |
| `/give` | Verified charities, donate, rules, history |
| `/launch` | 12-step wizard (mock deploy) |
| `/launch/configuration` | Fee split editor + charity + reserve destination |
| `/token/[slug]` | Proof page. `/token/demo` is the featured one; 5 more demo slugs |
| `/discover` | Filters with visible ranking rules |
| `/analytics` `/vaults` `/documents` | Polished placeholders |
| `/trust` | Trust Center; unfinished sections badged COMING IN THE ON-CHAIN IMPLEMENTATION |

All routes are statically prerendered. One shared shell (`AppShell`: sidebar, top bar, global DEMO DATA bar) wraps everything from the root layout; the sidebar becomes a drawer below `lg`.

## Structure
```
src/app          routes only (server components; thin)
src/components   UI. Client components only where state is needed
src/lib          pure logic: format, portfolio math, fee-draft parsing, launch validation, discover rules, types
src/mock         ALL demo data, one place. Nothing hardcoded in components
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

## Known limits and risks
- Wallet state and wizard state are in-memory; a hard reload resets them (by design for now).
- "VERIFIED TRANSPARENCY" is not awarded anywhere; demo tokens show "n/9 CHECKS REPORTED · DEMO". Nothing is labeled IMMUTABLE.
- No CSP/security headers yet (Slice 11). `poweredByHeader` is off.
- Accessibility: keyboard and ARIA basics done (dialog roles, aria-sort, live regions, focus styles). Not audited; modals do not trap focus fully.
- Tests are unit-level; browser checks were manual via Playwright script, not in CI.
