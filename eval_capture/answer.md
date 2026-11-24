**Decision: Don't pay the $1,000 deposit. The plan doesn't work as structured. Confidence: high.** Three reasons:
1. The loan can't legally pay off the personal credit card.
2. No lender can realistically approve a loan within 7 days.
3. At the planned 60 units, the business misses the $2,000/month goal even with zero debt.

## 1. SBA microloan rules as of Nov 23, 2026

eCFR is current through Nov 20, 2026, so I couldn't load the Nov 23 version directly. The microloan sections (13 CFR 120.700 to 120.709) were last amended in 2024. A Federal Register search found no rule changing these sections in 2025 or 2026; the only 2026 Part 120 rule (Feb 10) covers 7(a) base rates. That leaves a 3-day gap I couldn't check (Nov 20 to 23), but the risk is low.

| Claim | Status | Source (accessed 2026-11-24) |
|---|---|---|
| Money can only go to "working capital and acquisition of materials, supplies, furniture, fixtures, and equipment" | **Verified** | [13 CFR 120.707(a)](https://www.ecfr.gov/current/title-13/section-120.707) |
| SBA says the money "cannot be used to pay existing debts or to purchase real estate" | **Verified** | [SBA Microloans page](https://www.sba.gov/funding-programs/loans/microloans) |
| "SBA does not review Microloans for creditworthiness" | **Verified** | 120.707(a) |
| "SBA-approved lenders make all credit decisions and set all terms" | **Verified** | SBA page |
| Lenders "generally should not" lend more than $10k. Over $20k, the borrower must show it can't get credit elsewhere. Hard cap is $50k, with a 7-year maximum term | **Verified** | 120.707(b), 120.701 |
| The lender's rate cap is its own SBA rate plus 7.75 points (loans over $10k) or plus 8.5 points (loans of $10k or less) | **Verified** | 120.707(c) |
| Rates "generally between 8%-13%" | **Verified** that SBA's page says this; it's only a typical range | SBA page |

**Who decides:** the local nonprofit lender SBA funds (the rules call it an "intermediary"). It decides approval, amount, rate, term, collateral and fees. SBA doesn't approve individual loans.

**What this means for the $12k request:**
- Machinery ($8k) and inventory ($2k) qualify. That's $10k.
- The $2k personal card is existing debt, and it isn't business debt, so it doesn't qualify.
- The real request is $10k, which also lands at the "generally" cap.

## 2. Math (run in Python)

**Loan payment:**
- $12,000 at 10% APR over 36 months = **$387.21/month**.
- Total repaid is $13,939.42, of which $1,939.42 is interest.
- For comparison only: $10k would be $322.67/month and $9k would be $290.40.

**At 60 units:**
- Contribution per unit: $170 − $115 = $55.
- 60 × $55 = **$3,300/month contribution**.
- Minus $1,850 fixed costs = **$1,450 before debt**.
- Minus $387.21 debt payment = **$1,062.79 founder cash**.
- Both figures miss the $2,000 goal.

**Units needed to hit $2,000/month:**

| Scenario | Contribution needed | Units | Whole-unit threshold |
|---|---|---|---|
| No debt | $3,850 | 70.00 | **70** (+17% vs. plan) |
| $12k at 10%/36 | $4,237.21 | 77.04 | **78** (+30% vs. plan). 77 units gives $1,997.79, just short |

- Break-even (founder takes $0): 34 units with no debt, 41 units with debt.
- To hit the goal at 60 units with debt, the price would need to be $185.62, or the variable cost would need to drop to $99.38.

## 3. Capital and timing feasibility: fails

- **Cash:** The founder has $1,000 and needs $10,000 for machinery and inventory (the $2,000 card is separate). Paying the deposit takes cash to $0, with no buffer for supplies, fees, a first loan payment, or slow early sales.
- **Timing:** The deposit is due in 7 days, and no lender has approved or quoted anything. I couldn't verify typical processing times from public rules. Assuming approval within 7 days is unsupported.
- **Downside:** If financing doesn't come through or is smaller than needed, the founder loses 100% of their cash.

## 4. What public rules can't tell you

- Whether any local lender will approve this founder, and how much it will lend.
- The actual rate, fees, collateral, personal guarantee, down-payment requirement, credit thresholds and closing timeline.
- Whether that lender funds pre-revenue startups. SBA's eligibility list says "be an operating business," but the same page says microloans help you "start and/or grow." That conflict is unresolved, so ask the lender.
- Whether the machinery is worth $8k, and whether 60 units at $170 is real demand. The plan's forecast is an assumption, not evidence.

## 5. Cheaper first test (about $0 to $300, 2 to 4 weeks)

1. **Talk to the seller, free:** Ask for one of these:
   - the deposit refundable if financing isn't approved within 45 days, or
   - the deposit held by a neutral third party (escrow), or
   - an extended deadline.

   If they refuse, walk away. A seller who demands nonrefundable money from a buyer with no financing is a red flag.
2. **Call 2 or 3 local lenders, free:** Find them through SBA's intermediary list linked on the [Microloans page](https://www.sba.gov/funding-programs/loans/microloans). Ask:
   - Do you lend to pre-revenue businesses?
   - What's the maximum for a first-time borrower?
   - What rate and fees would apply?
   - What collateral, guarantee and down payment do you require?
   - How long does it take to close?
   - Would a $10k request for equipment and inventory be considered?
3. **Pre-sell before buying machinery, about $300 or less:** Make a few units without buying the machine: outsource the production, rent a shop or makerspace, or hand-build them. Take paid orders at $170.
   - **Pass:** 20 or more paid orders from non-friends within 30 days, at a variable cost of $115 or less, with a believable path to 78 units a month.
   - **Fail:** under 10 paid orders. Stop or change price or product.
4. **Handle the $2k card separately** from personal income. It can't go into this loan.

**What would change my answer:** a refundable or escrowed deposit, a written lender commitment for about $10k before the deadline, and pre-sale evidence that supports 78 or more units a month.

---
**Requirement check**
- Microloan permitted uses: Met (§1)
- Who decides approval and terms: Met (§1)
- Payment on $12k at 10% for 36 months: Met ($387.21)
- Contribution at 60 units: Met ($3,300)
- Whole-unit threshold for the goal: Met (70 with no debt, 78 with debt)
- Capital/timing feasibility: Met (§3)
- What public rules can't verify: Met (§4)
- Deposit decision: Met (don't pay)
- Cheaper first test: Met (§5)
- **Partial:** The Nov 23 date. eCFR is only current through Nov 20; the Federal Register search found no microloan changes, but Nov 20 to 23 isn't directly confirmed.
