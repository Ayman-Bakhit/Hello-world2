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
