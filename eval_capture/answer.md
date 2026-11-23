## Verdict: renegotiate. Don't sign as-is. Confidence: high.

The deal makes money (about $1,580 profit). The problem is timing. Stripe says a new account's first payout typically takes 7 to 14 days, so the $2,400 deposit almost certainly won't reach your bank by the November 27 supplier deadline. With $900 cleared, you'd be $1,700 to $1,820 short and would miss the supplier payment. Change how the deposit is paid and the deal works. Walk away only if neither the customer nor the supplier will move and you have no other way to cover about $1,820.

## Evidence

| Claim | Status | Source (accessed 2026-11-23) |
|---|---|---|
| Stripe standard fee: "2.9% + 30¢ per successful transaction for domestic cards" | Verified | https://stripe.com/pricing |
| Extra fees: +0.5% manually entered cards, +1.5% international cards, +1% currency conversion. "No setup fees, monthly fees" | Verified | same page |
| "After you successfully receive your first live payment, Stripe typically schedules your initial payout to complete within 7–14 days, depending on your industry, country of operation, and risk level." | Verified | https://docs.stripe.com/payouts |
| "Payouts scheduled on weekends or holidays arrive on the next business day." | Verified | same page |
| US settlement is 2 business days after the first payout | Unverified (the fetch summarized this part instead of quoting it) | same page |
| New accounts aren't immediately eligible for Instant Payouts | Unverified (same reason) | same page |
| Nov 26, 2026 is Thanksgiving, a US bank holiday | Unverified (from memory). It's the 4th Thursday, which I checked in code. | n/a |

Your 2-business-day assumption contradicts Stripe's published first-payout timing. Even if it held, Tue Nov 24 plus 2 business days, skipping Thanksgiving, lands on Fri Nov 27. That's deadline day, with no room for the bank to clear it.

## Math (run in Python)

Assumes a domestic card entered online by the customer, not keyed in manually.

- Fee per $2,400 charge: 2,400 × 2.9% + 0.30 = **$69.90**, so you net $2,330.10
- **Total fees: $139.80**
- **Profit:** 4,800 − 139.80 − (2,600 + 120 + 360) = **$1,580.20**
- If you key the cards in manually, fees rise by $24 to $163.80. Not material.

## Cleared-cash schedule, contract unchanged

Dates not listed have no cash movement. All three columns assume the founder pays every obligation on its due date.

| Date | Event | A: founder's assumption (payout Nov 27) | B: Stripe best case (payout Dec 1) | C: Stripe worst case (payout Dec 8) |
|---|---|---|---|---|
| Nov 23 (Mon) | Start | 900.00 | 900.00 | 900.00 |
| Nov 24 (Tue) | $2,400 charged, pending in Stripe | 900.00 | 900.00 | 900.00 |
| Nov 27 (Fri) | Supplier −2,600 (+2,330.10 in A) | 630.10 | **−1,700.00** | **−1,700.00** |
| Dec 1 (Tue) | Overhead −120 (+2,330.10 in B) | 510.10 | 510.10 | **−1,820.00** |
| Dec 8 (Tue) | +2,330.10 (C only) | 510.10 | 510.10 | 510.10 |
| Dec 15 (Tue) | Materials −360 | 150.10 | 150.10 | 150.10 |
| Dec 18 (Fri) | $2,400 charged, pending | 150.10 | 150.10 | 150.10 |

**Maximum cash shortfall: $1,700 (best case) to $1,820 (worst case).** Even case A leaves only $150 of cushion. The Dec 18 net of $2,330.10 is still pending on Dec 18. Once it pays out, cash ends at $2,480.20, which equals $900 + $1,580.20, so the schedule reconciles.

## Alternative deposit/payment policy for the customer

> The 50% deposit of $2,400 is due by bank wire or same-day ACH to our business bank account, arriving by 12:00 p.m. Central on Wednesday, November 25, 2026, and production starts only once that deposit has cleared. The remaining $2,400 is due on delivery, December 18, 2026, by bank transfer or by online card payment at no extra charge. If the deposit hasn't cleared by November 25, the delivery date moves back one business day for each business day of delay, and if it still hasn't cleared by December 1, either party may cancel with no further obligation.

Under this policy you'd have $3,300 on Nov 25, $700 after paying the supplier on Nov 27, $580 on Dec 1 and $220 on Dec 15. You'd never go negative. Fees drop to $69.90 and profit rises to $1,650.20. Your bank may charge a fee for receiving a wire, often around $15 (unverified, check with your bank).

## Options compared

| Option | Cash gate | Profit | Verdict |
|---|---|---|---|
| Sign unchanged | Fails in B and C, which match Stripe's published timing | $1,580 | No |
| Renegotiate to bank-transfer deposit (policy above) | Passes, lowest balance $220 | $1,650 | **Yes** |
| Renegotiate the supplier: $900 now, rest by Dec 9 | Passes if they agree | $1,580 | Fallback |
| Bridge the gap with a credit card or loan of about $1,820 | Passes if you have access | $1,580 minus interest/fees | Fallback |
| Decline | n/a | $0 | Only if every option above fails |

## What would flip the verdict

1. **To "sign unchanged":** written confirmation from Stripe that this account's first payout will land by the morning of Nov 26 (realistically, before Thanksgiving). Alternatively, you have $1,820 or more of committed backup credit, or the supplier accepts payment after Dec 8.
2. **To "decline":** the customer insists on a card deposit, the supplier won't move its date, and you can't borrow $1,820.
3. **Makes things worse:** a reserve or risk review on a new account's first $2,400 charge. This is speculation, not sourced, but it's exactly the kind of "risk level" factor Stripe cites for the 7 to 14 day range.
4. **Doesn't matter:** the fee details. Costs would have to rise by about $1,580 before the deal loses money. Cash timing is the only constraint that's actually limiting you.

## Next steps (today, Nov 23)

1. Send the customer the policy above. You win if they agree in writing to a Nov 24 or 25 bank-transfer deposit. You lose if they insist on a card.
2. At the same time, ask the supplier whether they'd take $900 now and the rest by Dec 9.
3. If both say no by end of day Nov 24, decline. Don't sign hoping Stripe pays out early.

**Coverage notes:** Two Stripe claims are unverified because the page fetches summarized those parts instead of quoting them: the 2-business-day US settlement figure for later payouts, and new accounts' ineligibility for Instant Payouts. Neither changes the verdict. The Thanksgiving holiday date is from memory. Everything else you asked for is covered above.
