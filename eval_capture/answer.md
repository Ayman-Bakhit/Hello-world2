**Verdict: renegotiate. Don't sign as written.** I'm highly confident on this. The deal makes money ($1,580.20 profit, 32.9% margin). The problem is timing: the deposit can't reach the bank as cleared cash by the November 27 supplier deadline. Decline only if the customer won't change how the deposit is paid and you can't get the supplier or a lender to cover the gap.

## 1. Researched facts (read on 2026-11-23)

| Claim | Status | Source |
|---|---|---|
| US domestic online card fee: "2.9% + 30¢ per successful transaction for domestic cards" | Verified: verbatim page text, read by my web-fetch subagent | https://stripe.com/pricing |
| Extra fees: +1.5% international cards, +1% currency conversion, +0.5% manually entered cards | Verified (same page) | https://stripe.com/pricing |
| "First payout: After you successfully receive your first live payment, Stripe typically schedules your initial payout to complete within 7–14 days depending on your industry, country of operation, and risk level" | Verified: verbatim | https://docs.stripe.com/payouts |
| US settlement after the first payout is "2 business days" | **Unverified.** This came only from a model summary of the page, not the verbatim text. | docs.stripe.com/payouts |
| New accounts can't use Instant Payouts right away | **Unverified** (summary only) | docs.stripe.com/payouts |
| Thursday, Nov 26, 2026 is Thanksgiving, a US bank holiday | Unverified, from memory. It is the 4th Thursday, which fits the calendar rule. | — |

The founder assumes withdrawal in 2 business days. **Stripe's own documentation contradicts that for a first payout.** Even if the assumption were right, Tue Nov 24 plus 2 business days lands on Fri Nov 27, the supplier deadline, because Thanksgiving doesn't count. That leaves no buffer at all.

## 2. Fees and profit (calculated in Python)

- Each charge: $2,400 × 2.9% + $0.30 = **$69.90**. Net per charge: $2,330.10.
- **Total transaction fees: $139.80** (domestic card, entered online).
- Costs: $2,600 + $360 + $120 = $3,080.
- **Profit: $4,800 − $139.80 − $3,080 = $1,580.20.** Check: $900 starting cash + $1,580.20 = $2,480.20 ending cash, which matches the schedule.
- Fee sensitivity: international cards add $72.00 (profit $1,508.20). Manually entered cards add $24.00. Neither changes the verdict.

## 3. Cleared-cash schedule, Nov 23 to Dec 18

The Nov 24 charge creates a pending Stripe balance, not cleared cash. The Dec 18 charge doesn't clear by Dec 18 under any scenario.

| Dates | A: Founder assumption (payout lands Nov 27) | B: Stripe minimum (payout Dec 1) | C: Stripe maximum (payout Dec 8) |
|---|---|---|---|
| Mon Nov 23 – Thu Nov 26 | 900.00 | 900.00 | 900.00 |
| Fri Nov 27 – Mon Nov 30 (supplier −2,600) | 630.10 | **−1,700.00** | **−1,700.00** |
| Tue Dec 1 (overhead −120) | 510.10 | 510.10 | **−1,820.00** |
| Wed Dec 2 – Mon Dec 7 | 510.10 | 510.10 | **−1,820.00** |
| Tue Dec 8 – Mon Dec 14 | 510.10 | 510.10 | 510.10 |
| Tue Dec 15 – Fri Dec 18 (materials −360) | 150.10 | 150.10 | 150.10 |

**Maximum cash shortfall: $1,820** (scenario C, Dec 1–7). If the first payout lands on or before Dec 1, the shortfall is $1,700. A "negative" balance here means the supplier isn't paid on time, so in practice the job stalls on Nov 27.

## 4. Alternative deposit/payment policy (to send the customer)

> To begin production, Customer will pay a 50% deposit of $2,400 by bank wire or same-day ACH to [Business]'s business checking account no later than November 24, 2026, and production starts only once those funds have cleared. The remaining $2,400 is due by ACH or wire on delivery, December 18, 2026. If the deposit has not cleared by November 25, 2026, the delivery date moves back one day for each day of delay, or [Business] may cancel without penalty, because materials must be paid for by November 27.

With this policy, cash goes 3,300 (Nov 24) → 700 (Nov 27) → 580 (Dec 1) → 220 (Dec 15) → 2,620 (Dec 18). The lowest point is $220 and it never goes negative. Profit rises to $1,720 because there are no card fees. Your bank may charge for incoming wires; that cost isn't stated, so it's left out.

## 5. Decision check

- **Alternatives:**
  - Sign unchanged: fails the Nov 27 cash test in both of Stripe's published scenarios.
  - Renegotiate (recommended).
  - Ask the supplier to accept payment by about Dec 9 (that covers the 14-day worst case).
  - Bridge the gap with $1,820 or more of committed cash.
  - Decline: you lose $1,580 but carry zero risk.
- **Downside if the customer never pays the second half:** $2,330.10 received − $3,080 spent = **−$749.90**. Check the customer's credit before signing. This is nonpayment, a separate risk from the refunds the task said to ignore.
- **Card-specific risk:** a single $2,400 charge on a brand-new Stripe account could be held for review. Not verified; I'm flagging it as plausible.

**What would reverse the verdict:**
1. **Signing unchanged becomes fine if** you have at least $1,820 more (ideally $2,000 or more) in cleared, committed funds by Nov 27. Or the supplier agrees in writing to accept payment on or after Dec 9. Or the Stripe account is not actually new and Stripe confirms in the Dashboard that the payout will arrive by Nov 26.
2. **Declining becomes right if** the customer insists on paying by card, the supplier won't move its date, and no bridge funding exists. Also if the customer's ability to pay on Dec 18 can't be confirmed.
3. **Fees don't flip anything:** even the worst stated surcharges cut profit by less than $100.

**Next actions:**
- **Today:** send the policy above. Separately, ask the supplier whether it would accept payment by Dec 9.
- **Stop rule:** if neither the customer nor the supplier agrees by Nov 25, decline.

**Note on requirements:** I didn't open the Stripe pages myself; a web-fetch subagent did, in this session. The 2-business-day settlement figure, the Instant Payouts restriction and the Thanksgiving holiday are unverified as labeled above. The support page on first-payout timing (support.stripe.com/questions/first-payout-timing) returned a 404. Every other requirement is covered.
