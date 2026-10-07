# Tax Engine

Code: `packages/shared/src/tax`. Pure, no I/O, bigint math. Output is an estimate, never advice. UI copy comes from `language.ts`.

## Flow
`AcquisitionLot[] + Disposal[] -> realize() -> RealizedEvent[] -> estimateTax(assumptions) -> TaxEstimate -> reserveStatus()`

## Rules implemented
- Cost-basis methods: FIFO, LIFO, HIFO (per asset). Lots acquired after the disposal are ineligible.
- Partial lots: basis and proceeds split proportionally; the final slice takes the remainder so sums are exact.
- Holding period: long-term only if disposed strictly after the one-year anniversary (UTC). Exactly one year = short-term.
- Netting: ST and LT nets computed separately; a net loss in one offsets a net gain in the other. Exposure floored at zero.
- Rates (short, long, state) are inputs in bps. No defaults in the engine.
- Oversold disposal throws; engine never invents basis.

## Known limits (do not hide these)
- No progressive brackets, NIIT, capital loss deduction cap ($3,000), carryforwards, or state-specific rules.
- No income classification (airdrops, staking, creator fees are ordinary income, not capital gains; must be handled by classifier upstream before this engine).
- Fees in basis/proceeds must be decided upstream and applied consistently.
- Wash sale treatment for crypto is unsettled; not modeled.
- Specific-ID method not implemented.
- Tax-year filter uses UTC calendar year.

## Tests
`tax.test.ts`: holding period boundaries (incl. leap day), each method, partial lots without drift, multi-lot splits, losses, oversold, input immutability, netting cases, year filter, assumption validation, reserve coverage.

## Tax data foundation (Slice 6)
Connects the engine above to the application's transaction layer. Code: `packages/shared/src/taxdata` (pure), `apps/api/src/{db/taxRepos,services/tax,prices/historical,routes/tax*}.ts`. **Everything is derived on demand; nothing derived is stored.** Nothing here is a legal or tax conclusion.

### Fixture-backed vs live
| Part | Status |
|---|---|
| `computeTax` (events, matching, lots, status, requirements) | Pure and fully tested with deterministic fixtures. Correct by test, not by real-world use |
| Transactions it reads | The Slice 5 indexed layer. **Chain data is NOT verified against a real network** (see INDEXING.md) |
| Prices | Interface only. `ObservationHistoricalPriceProvider` reads stored `price_observations` (spot observations, none exist without a configured price provider on mainnet). `FixtureHistoricalPriceProvider` is test-only and is never wired in production. So in this environment every real wallet has **no prices** and every swap is `DATA_REQUIRED` |
| User-supplied cost basis (`openingLots`) | Supported by the engine (so COMPLETE is possible at all); **no API or UI accepts or stores it yet** |

### Data model (`taxdata/types.ts`)
`TaxTxInput` (one normalized transaction for one wallet) -> `TaxEvent` -> `AcquisitionLot` / `Disposal` (existing engine types) -> `RealizedSlice`.
- **TaxEvent**: id, source transaction (id, signature, wallet), timestamp (nullable), kind (`BUY|SELL|TRANSFER_IN|TRANSFER_OUT|FEE|UNKNOWN`), asset (`native` or mint), decimals, quantity (bigint, always positive; direction is the kind), USD value (nullable), price quote (value, source, observation time, `FIXTURE|OBSERVED`), valuation (`PRICE|COUNTER_LEG`), fee lamports, the Slice 5 classification (kind, reason, version), status (`READY|DATA_REQUIRED|UNRESOLVED|MATCHED|EXCLUDED`), reason text, `missing[]` (`PRICE|COST_BASIS|TIMESTAMP|CLASSIFICATION|TRANSFER_MATCH`), confidence (`ESTIMATED|NONE`, never "verified"), matched/candidate transfer ids, uncovered quantity.
- **RealizedSlice**: asset, quantity, acquired/disposed time, cost basis, unit cost basis (micro-USD), proceeds, gain/loss, holding period, disposal and acquisition signatures, wallet of each, price sources used, fee recorded.
- Quantities and money are bigint/integer strings end to end. No `Number` conversion of any quantity or amount (only timestamps in seconds and bps). Values above 2^53 are tested.

### Event rules (conservative; the adapter only labels what moved)
| Slice 5 label | Tax event(s) | Notes |
|---|---|---|
| `swap` | one SELL per outflow leg and one BUY per inflow leg | **Only under the explicit assumption `swapTreatment=DISPOSAL_AND_ACQUISITION`**, echoed in every response. `NOT_ASSESSED` leaves every leg UNRESOLVED. Treatment varies by jurisdiction; this is not a conclusion |
| `transfer` (SOL) | TRANSFER_IN / TRANSFER_OUT | never a purchase or sale |
| `token_receipt` / `token_send` | TRANSFER_IN / TRANSFER_OUT | origin/destination/purpose unknown; could be an airdrop, income, a payment or a gift |
| `fee`, or a failed transaction the wallet paid for | FEE | recorded, **not applied** to basis/proceeds (`feePolicy: RECORDED_NOT_APPLIED`). Failed transactions never create lots even if deltas are present |
| failed transaction the wallet did not pay for | EXCLUDED | nothing moved |
| `unknown` and anything else (or a malformed shape) | UNKNOWN, UNRESOLVED | no tax meaning assumed; never in any figure |

### Transfers
Same signature + same asset + same quantity + two different wallets of the same user = `MATCHED` internal transfer (no tax effect; pooling is per user, so basis carries over). Anything else stays `UNRESOLVED`. Same asset and quantity in a different transaction within an hour is listed as a **candidate** (suggestion only, never applied). An unmatched transfer in creates no lot and invents no basis; an unmatched transfer out is not a sale.

### Prices
`PriceAt(asset, time) -> PriceQuote | null`: the latest observation **at or before** the time, within a maximum age (`TAX_PRICE_MAX_AGE_SECONDS`), source and observation time attached. No look-ahead, no zero, no interpolation, no stale reuse. For a 1:1 swap an unpriced leg may take the value of its priced counter-leg (`valuation: COUNTER_LEG`, labeled). Anything else unpriced is `DATA_REQUIRED` / "PRICE DATA UNAVAILABLE".

### Cost basis
The existing `realize()` (FIFO/LIFO/HIFO) is used unchanged. The method is a request parameter; if omitted the response says `methodSource: "default"` (FIFO). One calculation, one method, never mixed. Because availability is method-independent, quantity without any acquisition lot is found before calling the engine (it throws on oversold); the **uncovered** part of a disposal is marked `DATA_REQUIRED` (`COST_BASIS`), only the covered part is realized. Lots from all of a user's wallets are pooled per asset.

### Status (never optimistic)
`UNAVAILABLE`: nothing synced. `DATA_REQUIRED`: any missing price, cost basis or timestamp (**blocks_total**, any year, conservatively). `PARTIAL`: UNKNOWN events, unresolved transfers, incomplete or gapped wallet history, incomplete holdings. `COMPLETE`: none of the above; still "ESTIMATE" and based on unverified chain data. No rates supplied = realized figures are shown, exposure is `null` (`RATES`, info). A property test enumerates combinations of missing inputs and asserts COMPLETE only when nothing is missing; two mutations (ignore blockers, accept zero prices) were verified to turn the suite red.

### Known limits (in addition to the list above)
No manual cost-basis entry, no income classification (airdrops/staking), no wash-sale, no specific-ID. Sub-cent values are floored. A wallet history capped by the initial indexing limit is `PARTIAL` by construction, so realistic real-wallet results are PARTIAL or DATA_REQUIRED until backfill and a historical price source exist. `UNKNOWN`/unresolved items are excluded from every figure and listed instead.

## Manual cost basis (Slice 7)
Code: `taxdata/manual.ts` (strict parsing), `taxdata/compute.ts` (review, linking, lots), `apps/api/src/{db/manualBasisRepos,services/manualBasis,routes/manualBasis}.ts`.

### What user-provided basis means (and does not)
A record is the **user's own statement** that a quantity of an asset in one of their wallets has a given USD cost basis and acquisition time. Everything about it carries `source: USER_PROVIDED` / `origin: USER_PROVIDED`; it is never presented as blockchain data and `verifiedOnChain` is always `false`. It does **not** prove the user acquired the asset, when, or for how much; it is not checked against any exchange, receipt or chain. It does **not** supply prices (a missing historical price still blocks COMPLETE), does **not** classify UNKNOWN transactions, and does **not** complete missing history. The system never calls it "verified".

### Model
`MANUAL_BASIS` is a separate event kind (not a purchase, not a transfer, not a blockchain transaction). Input to the engine (`openingLots`): wallet, asset, decimals, raw quantity, acquisition time, total cost basis (cents), revision, created-at (ms), optional signature, reason, `acknowledgedOverlap`. Quantities are exact bigint raw units; the user types whole-token decimals, which are converted losslessly or **rejected** (more decimals than the asset has; USD with more than 2 decimals; non-canonical numbers; non-UTC or sub-second or future or pre-2009 times).

### How it enters the calculation
- **As lots**: each included record is an acquisition lot (same engine, FIFO/LIFO/HIFO unchanged). **Wallet scoping**: a manual lot is only eligible for disposals in the SAME wallet (no cross-wallet matching). On-chain lots stay pooled per asset across the user's wallets (Slice 6). Disposals are processed in time order against the remaining lots, so a lot cannot go negative or be consumed twice.
- **Resolving a transfer-in**: an unmatched TRANSFER_IN (same wallet, same asset) is linked to user records when (a) records carry that transaction's signature and together equal its quantity, or (b) exactly one record has the exact quantity and an earlier acquisition time. The transfer becomes READY, names the manual record(s), and stays `origin: CHAIN` (it is a blockchain transaction); the record stays `USER_PROVIDED`. Partial coverage (less than the received quantity) leaves it UNRESOLVED and says how much is covered. Ambiguity (several exact matches) is not linked. A linked record is the basis for those units; it does not add units (no double count).
- **Status**: unchanged rules. Basis can turn `DATA_REQUIRED` (missing cost basis) into `PARTIAL`/`COMPLETE` only if every other requirement (prices, timestamps, classification, history, holdings, transfer matches, review) is satisfied. A record under review adds `BASIS_REVIEW` (PARTIAL).

### Duplicates and overlaps (excluded, never merged or deleted)
Review states: `POTENTIAL_DUPLICATE`, `OVERLAPPING_BASIS`, `DECIMALS_MISMATCH`, `OK`. A record is **POTENTIAL_DUPLICATE** when, in the same wallet and asset, it matches an earlier user record or an on-chain BUY by the same transaction signature (against chain) or the same quantity within 24 hours (or same quantity and signature against a user record). The earlier record wins; the later is **excluded** from lots until the user acknowledges (a new revision with `acknowledgeOverlap=true`) or voids it. **OVERLAPPING_BASIS**: records tied to one transfer's signature that together exceed what it received. **DECIMALS_MISMATCH**: decimals contradict the asset's on-chain decimals (not acknowledgeable). Each review lists conflicts with source (`CHAIN`/`USER_PROVIDED`), id, signature, quantity and time, and an explanation. Same signature with different quantities is allowed (a transfer explained in pieces); the overlap rule catches excess.

### Audit history
Every change is an immutable, hash-chained revision (see DATABASE.md). The calculation fingerprint covers record id, revision, quantity, time, cost, signature, acknowledgement and creation time, so any edit changes it.

### Limits
No automatic matching beyond the rules above; no proceeds or price entry; no income treatment; no multi-currency; on-chain lots remain user-pooled while manual lots are wallet-scoped (so a manual lot moved to another wallet by a matched transfer does not follow it; add basis for the receiving wallet).

## Tax report and export (Slice 8)
Code: `packages/shared/src/taxdata/report.ts` (pure), `apps/api/src/{services/tax.ts,services/taxGate.ts,routes/taxReport.ts}`, `apps/web/src/components/TaxReportPanel.tsx`. **No second tax engine**: the report is a read-only view over the Slice 6/7 `computeTax` result (realized slices, events, requirements, manual-basis review). Nothing is persisted; every report is derived on demand.

### What the report represents
An **estimated tax report** for one tax year, one accounting method and one swap treatment, over the signed-in user's own real wallets (pooled, as in the calculation): realized proceeds, cost basis, gain/loss, short-term and long-term split, the realized disposals (one row each), unresolved and data-required events, the missing-data requirements, the user-provided basis records included, the price observations used, limits, and a calculation fingerprint plus a report hash.

### What it does NOT represent
Not a tax return, filing, form or statement of what is owed; not verified; no jurisdiction-specific rules (no brackets, NIIT, loss caps, carryforwards, wash-sale); no exposure or rates (rates are not part of the report); not a statement that the data is complete unless the status says COMPLETE, and even then it is an estimate over unverified chain data.

### Tax year
**UTC calendar year, by disposal time**: `[Jan 1 00:00:00 UTC, next Jan 1 00:00:00 UTC)`. A disposal at 2023-12-31T23:59:59Z is in 2023; at 2024-01-01T00:00:00Z it is in 2024. The year is an explicit parameter (default: the current UTC year, echoed in the report); it is never taken from the browser's timezone. Acquisition time only decides short vs long term. This is the engine's existing rule and the only one implemented; it is not claimed to be correct for every jurisdiction (fiscal years, local-time boundaries and other rules are not supported).

### Completeness
Status is the calculation's status and can only get **worse** in the report: `UNAVAILABLE` (nothing synced: no summary, no rows), `DATA_REQUIRED` (missing price, cost basis or timestamp; or the report exceeded a supported limit), `PARTIAL` (unknown/unresolved events, unresolved transfers, incomplete or gapped history, incomplete holdings, records under review), `COMPLETE` (all Slice 6 rules satisfied). Manual basis cannot bypass a missing price, an UNKNOWN transaction, incomplete history or any other blocker (property-tested across all combinations). If more transactions exist than `TAX_MAX_TRANSACTIONS`, or more disposals than `REPORT_MAX_ROWS`, the report says so with a `LIMIT` requirement and is `DATA_REQUIRED`; totals always cover every in-year disposal, only the listing is capped, and an export is refused (413) instead of silently truncating.

### Provenance (every figure traces back)
Each disposal row carries: disposal transaction signature and wallet, the acquisition (lot) transaction signature and wallet, `acquisitionSource` (`CHAIN` or `USER_PROVIDED`), `disposalSource` (`CHAIN`), the manual basis record id when applicable, the proceeds and cost price source, price observation time and confidence (`FIXTURE` or `OBSERVED`), how the value was obtained (`PRICE` or `COUNTER_LEG`), the fee recorded, `confidence` (always `ESTIMATED`) and `verifiedOnChain` (always `false`). Unresolved events keep their origin and reason. Fixture prices are labeled "(fixture)" and the report states they are not market data and not verified; user-provided basis is labeled USER_PROVIDED and the report states it is the user's statement. **Disclosure**: if any user-provided record is included the report says exactly "Includes user-provided tax data." and lists the records (id, asset, quantity, time, cost, review state, how many disposals used it); records under review are listed as EXCLUDED.

### Determinism
Rows are sorted; JSON is key-sorted; equal inputs give byte-identical CSV and equal JSON except `meta.generatedAt` (the only documented generation metadata). `fingerprint` (sha256 of the calculation inputs: transactions, classifier versions, prices actually used, method, year, swap treatment, coverage, manual records with revision/acknowledgement) changes when a source transaction, a manual-basis revision, a used price observation, the method or the year changes. `reportHash` is sha256 of the whole report except `meta` and itself. A price observation that no event used does not change the fingerprint.

### Export formats
- **CSV** (`text/csv; charset=utf-8`, CRLF, header always present): one realized disposal per row, 31 columns: `report_status, tax_year, asset, mint, quantity, quantity_raw, acquisition_timestamp, disposal_timestamp, cost_basis_usd, proceeds_usd, gain_loss_usd, holding_period, accounting_method, disposal_transaction, disposal_wallet_id, acquisition_transaction, acquisition_wallet_id, acquisition_source, disposal_source, manual_basis_id, proceeds_valuation, proceeds_price_source, proceeds_price_observed_at, proceeds_price_confidence, cost_price_source, cost_price_observed_at, cost_price_confidence, fee_lamports, confidence, verified_on_chain, report_fingerprint`. Money is exact dollars from integer cents; times are ISO-8601 UTC. **Formula injection**: any text cell starting with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with an apostrophe; control and direction-override characters are removed; RFC 4180 quoting. Only cells that are exactly a plain decimal number (generated from bigint math, e.g. `-400.00`) are left numeric. Notes and other free text are never exported.
- **JSON** (`application/json`): the entire report (metadata, status, summary, disposals, unresolved events, requirements, manual-basis records, price provenance, provenance statements, limits, fingerprint, hash, disclaimer), key-sorted.
- Filenames are built only from validated parts (`estimated-tax-report-<year>-<method>-<12 hex>.csv|json`) and sent as `Content-Disposition: attachment` with `Cache-Control: no-store` and `nosniff`.

### Fixture / live-data limitations
Everything here is verified only against fixtures and a fake RPC. Real wallets have no real prices in this environment, so real reports are `DATA_REQUIRED` until a real historical price source exists; chain data is unverified.

## Slice 10: tax reserve foundation (estimate -> recommendation -> target -> balance -> coverage)
The reserve layer consumes the existing tax result. It is not a second engine and holds no tax rate.

**Five figures, never conflated**
| Figure | Source | Status labels |
|---|---|---|
| Tax estimate | tax engine (`TAX_ENGINE`) or demo fixture | `ESTIMATE`, with the tax status (COMPLETE, PARTIAL, DATA_REQUIRED, UNAVAILABLE); `authoritative:false`, `verifiedOnChain:false` |
| Recommendation | `SYSTEM_RECOMMENDATION`, policy `EXPOSURE_1X` (the estimated exposure, unchanged) | `ESTIMATED RESERVE TARGET`, `ESTIMATED RESERVE — TAX DATA INCOMPLETE`, `TAX DATA REQUIRED — NO RESERVE RECOMMENDATION`, `NO TAX RESERVE ESTIMATE AVAILABLE`, `RATES REQUIRED FOR A RESERVE ESTIMATE` |
| User target | `USER_SET` configuration | `USER TARGET`, `No reserve target set.` |
| Reserve balance | `UNAVAILABLE` / `NOT_CONNECTED` for real wallets; `DEMO_FIXTURE` only for the demo wallet | `RESERVE BALANCE UNAVAILABLE`, `DEMO RESERVE BALANCE` |
| Coverage / remaining | balance / target; unavailable if either side is | `80% of target`, `UNAVAILABLE` |

**Status rules (the layer never upgrades tax certainty)**
- COMPLETE: recommendation = estimated exposure, labeled an estimate.
- PARTIAL: same number, labeled `ESTIMATED RESERVE — TAX DATA INCOMPLETE`, with what is missing.
- DATA_REQUIRED: no recommendation and no exposure figure (they are not a total); the missing data is listed.
- UNAVAILABLE: nothing.
- No tax rates supplied: no exposure, so no recommendation. Rates stay user-supplied POST-body data (`POST /api/tax-reserve/:walletId/calculate`); a GET with rates in the URL is a 400. No rate or percentage is hardcoded anywhere in the layer.

**Coverage wording**: `balance / target` reads "80% of target", never "80% of your tax liability". A separate `targetVsExposure` field says "Target is 80.45% of the estimated exposure (an estimate)." and is unavailable when the exposure is. Neither measures funding on its own.

**Extensibility**: `RESERVE_POLICIES` is the only place a policy can be added (buffer, user-selected percentage, jurisdiction-specific). Only the identity policy exists; no policy is invented.

**Not decided (stopped, not invented)**: reserve custody; reserve wallet architecture; smart contract architecture; the USDC transfer mechanism; jurisdiction rules; the legal treatment of reserves; whether a reserve belongs to the user, the platform or a charity; whether "adopt the recommendation" stores a snapshot or tracks it live.

**Caveats that still apply**: real Solana RPC has not been validated from this environment; real historical prices are not connected (fixture prices only); results are not jurisdiction-complete; user-provided cost basis is not independently verified; fixture data (including the demo reserve balance) is not real-world verification; charity verification from Slice 9 is fixture/admin data; no real money movement. This is a planning tool, not tax advice.
