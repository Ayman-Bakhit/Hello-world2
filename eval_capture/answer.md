**Decision: don't pay the $1,000 nonrefundable deposit. High confidence.** The $12k loan can't be used as proposed. No lender has approved anything and the deadline is 7 days. Even if everything else goes right, the plan's 60 units a month doesn't reach the $2,000 goal.

## 1. SBA microloan rules (checked Nov 23, 2026)

**What the money can be used for**
- **Verified, regulation:** 13 CFR 120.707(a) says "Proceeds from Microloans may be used only for working capital and acquisition of materials, supplies, furniture, fixtures, and equipment." I pulled this from the eCFR API at its latest issue date, 2026-11-19, because the API won't return a Nov 23 version yet. The section was last changed in 2024. https://www.ecfr.gov/current/title-13/chapter-I/part-120/subpart-G/section-120.707
- **Verified, SBA.gov (opened 2026-11-23):** the page lists working capital, inventory, supplies, furniture, fixtures, machinery and equipment as allowed uses. It also says: "Proceeds from an SBA microloan cannot be used to pay existing debts or to purchase real estate." https://www.sba.gov/funding-programs/loans/microloans

**What that means for the $12k ask**
- **Machinery ($8k) and inventory ($2k):** both allowed.
- **$2k personal credit card:** not allowed.
- **Largest usable ask:** $10k. If the founder pays the deposit from their own cash, it's $9k.

**Who decides approval and terms**
- **Verified, SBA.gov:** "SBA-approved lenders make all credit decisions and set all terms." The regulation adds that "SBA does not review Microloans for creditworthiness."
- **Verified, 13 CFR 120.701:** the lender here is the intermediary, a nonprofit or quasi-governmental lender.

**Program limits (verified, 120.707(b)-(c))**
- **Amount:** generally no more than $10k per borrower, and above $20k only with extra justification. $12k is above the "generally" guideline. $10k is within it.
- **Term:** at most 7 years.
- **Rate cap:** the intermediary's own SBA borrowing rate plus 7.75 points on loans over $10k, or plus 8.5 points on loans of $10k or less.
- **Typical rates:** SBA.gov says "generally, between 8%-13%". That's a range SBA quotes, not a quote for this founder.

## 2. The math

All figures below come from a script I ran.

**Loan payment ($12,000, 10% APR, 36 months, fully amortizing; for comparison only)**
- Monthly payment: **$387.21**
- Total interest over 3 years: $1,939.42
- Same terms on $10,000: $322.67 a month

**Contribution at the plan's 60 units**

| Line | Amount |
|---|---|
| Contribution per unit ($170 price minus $115 cost) | $55 |
| Contribution at 60 units ($55 × 60) | $3,300 |
| Minus fixed costs ($1,850) | $1,450 |
| Minus $12k loan payment ($387.21) | **$1,062.79 founder cash** |

That's about $937 a month short of the $2,000 goal.

**Units needed for $2,000 a month founder cash (pre-tax, whole units)**

| Financing | Exact units | Whole units | Check |
|---|---|---|---|
| No debt | 3,850 / 55 = 70.0 | **70** | 70 units gives $2,000.00 |
| $10k loan | 4,172.67 / 55 = 75.87 | **76** | 75 units gives $1,952; 76 gives $2,007 |
| $12k loan | 4,237.21 / 55 = 77.04 | **78** | 77 units gives $1,997.79; 78 gives $2,052.79 |

**What the numbers say**
- With the $12k loan, the goal takes 78 units a month, 30% above the plan's volume.
- Break-even with no owner pay is 41 units with the $12k loan and 34 units without debt.
- At 60 units, a price cut of $17.71 per unit, or an equal rise in unit cost, wipes out founder cash entirely.

## 3. Capital and timing

- **Cash:** paying the deposit takes the founder's cash from $1,000 to $0. That leaves no reserve and no way to fund the other $9,000.
- **Timing:** the deposit is due in 7 days and no lender has approved or quoted anything. No public rule sets how fast an intermediary decides. I don't know the typical timeline, so ask the lender directly. If the loan is denied or delayed, the $1,000 is gone.
- **Working capital gap (the plan doesn't cover it):** $2,000 of inventory buys about 17 units ($2,000 / $115). Making 60 units a month takes $6,900 a month in variable costs. Unless customers pay upfront, the plan has to front that cash before sales come in, and nothing pays for it.
- **The credit card:** it still needs its own minimum payments from personal income, and a lender will likely weigh it in underwriting. That's my inference, not verified.

## 4. What public rules can't tell you

- Whether any intermediary approves this loan, and for how much
- The actual rate, term, fees, collateral and personal guarantee requirements
- How long a decision takes
- Whether a deposit the founder already paid counts as their own contribution, or can be paid back out of loan proceeds
- Demand for 60 units at $170, the $115 unit cost, and the $1,850 fixed costs. These are all forecasts with no evidence behind them.
- The machine's condition, whether it's free of liens, and why the seller insists the deposit be nonrefundable

## 5. A cheaper first test (about 30 days, ≤$300 at risk)

1. **Today, ask the seller one of three things:**
   - a deposit refunded if financing or inspection fails within 45 days,
   - a $100-200 fee to hold the machine for 30 days, or
   - lease-to-own.

   If they refuse all three, walk away.
2. **This week, contact 2-3 microlenders** from the list linked on the SBA page. Ask:
   - Will you lend $9-10k to a startup for equipment and inventory?
   - What rate, term and collateral would you require?
   - How many days to a decision?
   - Does a deposit I've already paid count as my own contribution?
   - How do you treat existing personal card debt?

   A written term sheet or pre-approval counts as the green light. A "no", or a timeline that can't fit the seller's window, is a stop.
3. **Next 30 days, presell:** take paid orders or deposits at $170 from real buyers. Make the first small batch without buying the machine (makerspace, contract maker or rented machine time) to check that $115 per unit is real.
   - **Go:** 20 or more paid orders in 30 days, and unit cost at or under $115.
   - **Stop or rethink:** fewer than 10 paid orders, or unit cost over $125.
4. **Keep the credit card out of the business loan.** Pay it from personal income.

What would change my answer: a refundable or contingent deposit, plus written lender pre-approval, plus at least 20 paid preorders. With all three, buying the machine becomes reasonable. Even then, plan around 76-78 units a month, not 60.

---
**Requirement check**
- R1 permitted uses and who decides: Met, sections 1 and 4.
- R2 loan payment: Met ($387.21).
- R3 contribution at 60 units: Met.
- R4 whole-unit threshold: Met (70 / 76 / 78).
- R5 capital and timing feasibility: Met, section 3.
- R6 what can't be verified: Met, section 4.
- R7 deposit decision: Met (don't pay).
- R8 cheaper test: Met, section 5.

The one gap: the eCFR couldn't serve a Nov 23 version, so I used the latest available (Nov 19). SBA.gov was checked on Nov 23 itself.
