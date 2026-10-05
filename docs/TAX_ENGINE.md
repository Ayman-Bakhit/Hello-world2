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
