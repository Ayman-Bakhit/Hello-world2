**Decision: REVISE (no-go as currently specified).** High confidence in the math, zero confidence in demand. The plan as given brings in **$2,766.80/month, $233.20 short of the $3,000 target**, and the founder's hours cap it at 40 appointments in the 4 weeks while the target needs 43. Fix price or drive time, then run a paid pre-sell test before committing.

## Sourced inputs

| Input | Value | Status |
|---|---|---|
| Stripe US online card fee | 2.9% + 30¢ per successful domestic card charge. Manually keyed cards add 0.5%, international cards add 1.5%. | **Verified**, https://stripe.com/pricing (read 2026-11-23) |
| IRS business mileage rate | 72.5¢ for Jan 1 to Jun 30, 2026. **76¢ for Jul 1 to Dec 31, 2026.** | **Verified** in the IRS page table, https://www.irs.gov/tax-professionals/standard-mileage-rates (read 2026-11-23). The mid-year change comes from Announcement 2026-11. I couldn't read that text verbatim, but the IRS page table states 76. |
| Is the IRS rate a required cost? | No. "Use of the standard mileage rates is optional. Taxpayers may instead choose to calculate the actual costs." | **Verified**, IR-2025-128, https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents |
| Volume, price, consumables, miles, $0.48/mi, overhead, hours | As you gave them | Your planning assumptions, not verified |

**The old worksheet is wrong twice.** First, the IRS rate is a tax deduction method you can choose, not a cash expense. Second, 72.5¢ isn't even the rate in effect for December 2026 (76¢ is). For cash planning, use the actual $0.48/mile. The IRS rate only matters at tax time, where it may give a bigger deduction than actual costs.

## Unit economics (calculated in Python)

Per appointment:
- Stripe fee: 0.029 × $125 + $0.30 = **$3.925**
- Vehicle: 36 mi × $0.48 = **$17.28**
- Contribution: $125 − 3.925 − 24 − 17.28 = **$79.795**

| Metric | Actual $0.48/mi (correct) | Worksheet 72.5¢ | IRS 76¢ |
|---|---|---|---|
| Contribution per appointment | $79.80 | $70.98 | $69.72 |
| **Monthly contribution, 40 appointments, after $425 overhead** | **$2,766.80** | $2,414.00 | $2,363.60 |
| Cash break-even: 425 / CM | 5.33, so **6 appointments** | 6 | 7 |
| Minimum for $3,000: 3,425 / CM | 42.92, so **43 appointments** (10.75/week) | 49 | 50 |

The worksheet understates monthly contribution by $352.80.

## Capacity and utilization

- Each appointment takes 3.25 hours (2 on site + 1.25 driving). Delivery time available is 45 − 10 = 35 hours/week.
- At 10/week that's 32.5 of 35 delivery hours, so **92.9% delivery utilization**. Counting sales and admin, it's 42.5 of 45 hours, or **94.4%**.
- Max per week is 35 / 3.25 = 10.77, so **10/week, or 40 in the 4 weeks**.
- 43 appointments need 139.75 of the 140 hours in the 4 weeks, which only works if hours move freely between weeks. With a 35-hour weekly cap, 11 appointments in a week is 35.75 hours, which doesn't fit. **The target can't be hit at these assumptions.** Even if hours could be pooled, that's 99.8% utilization with no room for cancellations, traffic or rework.
- Contribution works out to $24.55 per delivery hour, or $15.37 per total hour worked. That's thin for a service business.

## Feasibility vs. demand

- **Math:** the target fails by $233/month at the stated price and drive time. Cash break-even (6 appointments) is easy on paper.
- **Demand:** nothing shows that 10 paid appointments a week exist. That number is an input, not evidence. December demand, local competition, no-shows and refunds are all untested. I believe Stripe keeps its fee on refunds, but I didn't check that.
- Not included: self-employment and income tax (your target is pre-tax), and no-shows. Each makes the gap bigger.

## Changes that close the gap (calculated)

| Change | Result |
|---|---|
| Raise price to **$131+** at 40 appointments | Reaches $3,000 |
| Cut driving to about 0.75 hours by clustering appointments in one area | About 12 appointments/week fit, and fewer miles also raises contribution |
| Price drops to $115 | Need 49 appointments, which can't be done |
| Average trip is 45 miles instead of 36 | $2,594/month, need 46 appointments |

The answer is most sensitive to **price and drive time**. At $125 there's no slack, and every downside makes it worse.

## Validation test (2 weeks, under about $150)

1. Set the price at **$135** and take full prepayment through a Stripe Payment Link (no monthly Stripe fee). Offer only time slots inside one tight area to keep drive time down.
2. Get the first buyers through your own direct outreach (past contacts, local groups, neighborhood platforms), plus at most about $100 in local ads if needed.
3. **Validated if:** 10 or more *prepaid* bookings in each of 2 consecutive weeks at $131 or more, averaging 36 miles or less and 1.25 hours of driving or less per appointment.
4. **Rejected if:** fewer than 6 prepaid bookings in week 1, or bookings only happen at under $125. At that point stop, or rethink the price, the area or the service.
5. Track actual drive time, miles, consumables and no-shows for every appointment, and replace the assumptions with real numbers before committing December.

**Other options:** don't proceed, or run it part-time below target while it proves demand. Doing nothing is reasonable if the pre-sell fails.

---

**Requirement check:** contribution, utilization, break-even, minimum for the target, current Stripe rate, the IRS correction, math vs. demand, the recommendation and the test are all covered above. One caveat: the 76¢ IRS figure is checked against the IRS page table but not against the Announcement 2026-11 text itself. It doesn't change the cash math, since the IRS rate isn't a cash cost.
