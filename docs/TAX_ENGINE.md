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
