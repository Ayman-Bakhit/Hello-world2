**Verdict: revise, don't go as-is. High confidence on the math, zero evidence on demand.** On your own assumptions the plan comes in $233 a month short of the $3,000 target. Reaching the target takes 43 appointments a month, and that uses essentially 100% of your delivery hours. A small price increase or shorter driving fixes the math. Only real paid bookings can show the demand is there.

## Inputs checked

- **Stripe:** 2.9% + 30¢ per successful domestic online card transaction, with no monthly fee. Manually entered cards cost +0.5% and international cards +1.5%. **Verified** at https://stripe.com/pricing (opened 2026-11-23).
- **The IRS rate in the old worksheet is wrong in two ways.**
  1. **It isn't a cash cost.** The IRS says "Use of the standard mileage rates is optional. Taxpayers may instead choose to calculate the actual costs." **Verified** in IR-2025-128 (Dec 29, 2025): https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents. It's a way to calculate a tax deduction. Your incremental cash cost is the $0.48 a mile you gave.
  2. **It's out of date for December.** The IRS page lists **76¢ for July 1 to Dec 31, 2026**. 72.5¢ only covered January to June. **Verified** at https://www.irs.gov/tax-professionals/standard-mileage-rates (last updated 28-Jul-2026). I didn't open Announcement 2026-11 itself.
- Everything else (price, volume, miles, hours, overhead) is your planning assumption and hasn't been checked against anything.

## Unit economics (run in Python)

| Per appointment | $ |
|---|---|
| Price collected | 125.00 |
| Stripe (0.029 × 125 + 0.30) | −3.93 |
| Consumables | −24.00 |
| Vehicle (36 mi × $0.48) | −17.28 |
| **Contribution** | **79.80** |

**Monthly, at 40 appointments:**
- Revenue: $5,000.00
- Stripe: −$157.00
- Consumables: −$960.00
- Vehicle: −$691.20
- Fixed overhead: −$425.00
- **Contribution: $2,766.80**, which is **$233.20 short** of $3,000.

**Break-even:** 425 / 79.795 = 5.33, so **6 appointments a month**. That's cheap to clear.

**To reach the target:** (3,000 + 425) / 79.795 = 42.92, so **43 appointments a month**, which gives $3,006.18.

**Using the worksheet's IRS-rate method instead:**
- At 72.5¢: $2,414 a month, and 49 appointments needed.
- At 76¢: $2,364 a month.

That method makes the business look worse than it is in cash terms. For sustainability, though, keep in mind that $0.48 a mile probably leaves out depreciation and wear. Your real economic cost sits somewhere between the two.

## Utilization

- **Hours per appointment:** 3.25 (2 on site plus 1.25 driving).
- **Delivery hours available:** 45 − 10 admin = 35 a week.
- **At 10 a week:** 32.5 hours, which is **92.9% of delivery hours**. Adding admin brings it to 94.4% of all 45 hours.
- **Capacity ceiling:** 35 / 3.25 = 10.77 a week, so 10 whole appointments a week.
- **Getting to 43 a month:**
  - It needs 139.75 hours out of 140 for the month, leaving 15 minutes of slack.
  - Spread across weeks, that's 11 + 11 + 11 + 10. Each 11-appointment week takes 35.75 delivery hours, which breaks the 35-hour cap. You'd have to eat into sales and admin time.
  - One no-show, a bad-traffic day or a holiday week (December has Christmas and New Year's Eve) and you miss.
- **Bottom line:** 43 a month is possible on paper but not realistic in practice.

## What flips it (keeping 40 appointments a month)

- **Price to $132 or more:** $131 misses by $0.16. At **$135**:
  - Contribution is $89.51 per appointment.
  - The month comes to **$3,155**.
  - The target needs 39 appointments, which leaves some buffer.
- **Driving to 23.8 miles or less per appointment:** route by zone, or charge a travel fee past a set radius.
- **Consumables to $18.17 or less.**
- **Volume is the biggest risk.** At 30 appointments a month you make $1,969, and at 20 you make $1,171. The whole plan rests on 10 paid appointments a week, and nothing supports that number yet.

## Math works vs. demand is proven

- **Proven by arithmetic:** break-even is easy. $3,000 needs either a price of about $132+ or less driving.
- **Not proven:**
  - That 10 people a week will pay $125, or $135
  - Cancellation and no-show rates
  - How many new customers vs. repeat customers
  - Whether you can actually group appointments geographically
  - Whether your state charges sales tax on this service
- Also, $3,000 before personal taxes isn't take-home pay. Self-employment tax alone takes a real cut.

## Validation test (14 days, around $0–50)

1. **Set up the offer.** Charge $135 inside a defined zone, with a travel fee outside it, collected through a Stripe Payment Link at booking. Free trials don't count as validation.
2. **Do 100 direct outreach touches** to people in your zone through channels you already have: your network, local groups and a Google Business Profile. Track touches → replies → paid bookings.
3. **Decision rules:**
   - **Go:** 10 or more paid bookings in 14 days, with average driving at or under 30 miles and no more than 1 in 10 cancelling.
   - **Revise:** 4 to 9 paid bookings. Fix the price, the zone or the channel, then rerun once.
   - **No-go:** 3 or fewer paid bookings after 100 touches. Stop. Don't throw ad money at it.

The timing is tight. It's Nov 23, so a 14-day test runs into December. Treat December as part of the test, not as a month you count on for income.

**Notes on gaps:**
- I used Stripe's standard rate only. Dispute fees, payout timing and your state's sales tax weren't checked.
- I didn't open Announcement 2026-11; the 76¢ rate comes from the IRS mileage-rates page.
- The test has no specific channels or contacts because I don't know your service or market.
