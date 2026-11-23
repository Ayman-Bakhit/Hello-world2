I've finished the USPS research and the cost math. Here's the verdict.

# Decision: NO-GO on the plan as proposed. The fixed version is INCONCLUSIVE until the route count is known.

The printer's claim is wrong. The 6×9 postcards fail three EDDM-Retail rules on their own: size, quantity and route selection. The $81 cost estimate is just arithmetic and doesn't make the mailing eligible. A compliant version can probably fit under $250, but only if the carrier routes you pick add up to roughly 200–555 addresses and the reprinted larger card costs about the same. I can't check either of those: you haven't given me the ZIP Code, and the route counts come from USPS's online EDDM tool.

## 1. USPS rules as of Nov 23, 2026

| Rule | Current USPS standard | Proposed plan | Result |
|---|---|---|---|
| **Price** | EDDM—Retail "Flats up to 3.3 oz." **$0.260** (Notice 123, "Effective October 04, 2026") | — | Verified ([Notice 123](https://pe.usps.com/text/dmm300/notice123.htm), fetched this session) |
| **Weight** | "must weigh no more than 3.3 ounces" ([DMM 143.2.5](https://pe.usps.com/text/dmm300/143.htm)) | 0.7 oz | ✅ Pass |
| **Size** | Must have "a length greater than 10-1/2 inches long, or a height greater than 6-1/8 inches high, or a thickness greater than 1/4 inch thick" (DMM 143.2.5). Max 15 × 12 × 0.75 in. Min thickness 0.007 in. Must be flexible, rectangular and evenly thick ([DMM 101.2](https://pe.usps.com/text/dmm300/101.htm), [QSG 140](https://pe.usps.com/text/qsg300/Q140.htm)) | 6 × 9 × 0.014 in: 9 is not > 10.5, 6 is not > 6.125, 0.014 is not > 0.25 | ❌ **Fail.** Under DMM 101.1 it counts as a letter-size piece, not a flat |
| **Quantity** | At least 200 pieces (or 50 lb), at most 5,000 per day per 5-digit ZIP. Fewer than 200 is allowed only when mailing to every address in a ZIP Code with fewer than 200 deliverable addresses (DMM 143.2.5, [145.1.2](https://pe.usps.com/text/dmm300/145.htm)) | 180 pieces in Chicago | ❌ **Fail.** No Chicago ZIP plausibly has under 200 addresses (my inference, not checked) |
| **Who receives it** | Simplified address mail "is distributed to all deliveries on a route." For city routes the only choices are "Postal Customer" (every active delivery) or "Residential Customer" (every active residential delivery) ([DMM 602.3.1.3, 3.2.1](https://pe.usps.com/text/dmm300/602.htm)). USPS: "delivered to every address on your selected routes" ([EDDM page](https://www.usps.com/business/every-door-direct-mail.htm)) | "Selected households" | ❌ **Fail.** You pick whole routes, not individual homes |
| **Postage & paperwork** | Indicia above and to the right of the address. Customer Registration ID (CRID) required. PS Form 3587 with each mailing. Pay at mailing by cash, check, debit or credit card ([DMM 144](https://pe.usps.com/text/dmm300/144.htm)) | Not addressed | Has to be built into the spec |
| **Prep & drop-off** | Bundles of 50–100 with a facing slip, separated by route. Enter at the Post Office that delivers those routes, or ship there by Priority Mail with a check and PS 3587 in box 1 (DMM 145.1.3, [146.1](https://pe.usps.com/text/dmm300/146.htm)) | Not addressed | Has to be built into the spec |

Caveat on dates: the DMM 143 page shows no issue date. Revision markers ("[7-12-26]" in 145, "[11-2-26]" in 101) show these pages are current through November 2026. The USPS EDDM marketing page also says "$0.26 per piece," which matches Notice 123.

## 2. What the proposed plan would cost if it were eligible (it isn't)

- Print: 180 × $0.19 = **$34.20**
- Postage: 180 × $0.260 = **$46.80**
- **Total: $81.00**, before any design, shipping or sales tax.

Being under $250 doesn't make it legal to mail. This piece can't be entered as EDDM-Retail at any price, so the $0.260 rate never applies to it. A USPS clerk would refuse it, or it would have to be repriced as some other mail class.

## 3. Smallest change that complies

1. **Size:** go from 6 × 9 to **6.25 × 9**. A height of 6.25 in is more than 6.125 in, so it qualifies as a flat. Same paper stock works: the weight scales to about 0.73 oz (0.7 × 56.25/54), well under 3.3 oz.
2. **Who gets it:** drop "selected households." Pick **whole carrier routes** in the ZIP, either Residential only ("Residential Customer") or all addresses ("Postal Customer").
3. **Quantity:** mailed pieces (**N**) = total delivery count of the routes you pick. N must be at least 200 and at most 5,000.

**Budget formula:**

> **Total = Q × p + N × $0.260 + F ≤ $250**
>
> - N = sum of the selected routes' counts (residential or all), with 200 ≤ N ≤ 5,000
> - Q = pieces printed, at least N (N plus a few spares)
> - p = printer's per-piece price **for 6.25 × 9 at quantity Q** (must be re-quoted)
> - F = design, setup, shipping to the Post Office, sales tax, any Priority Mail boxes

Most pieces you can mail for $250 (calculated with p and F as shown):

| F \ p | $0.19 | $0.22 | $0.25 | $0.30 |
|---|---|---|---|---|
| $0 | 555 | 520 | 490 | 446 |
| $25 | 499 | 468 | 441 | 401 |
| $50 | 444 | 416 | 392 | 357 |

The cheapest legal mailing is 200 pieces: 200 × ($0.19 + $0.26) = **$90**. At N = 200 and F = 0 you could pay up to $0.99 per piece for printing and still hit $250, so printing price only becomes the constraint at larger N.

**What would flip the answer:** route counts. Chicago city routes often have several hundred deliveries each (my estimate, not checked). If the smallest route, or the smallest combination of routes you'd want, is over about 450–555 addresses, no compliant EDDM-Retail mailing fits under $250 at these prices. Then the answer is **no-go**.

**Two things to confirm before going ahead:**
1. **Route counts.** In USPS's online EDDM tool, enter the ZIP, choose "Residential Routes Only" or "Residential and Business Routes," and write down each route's count. Go if one route, or a combination, falls between 200 and the cap in the table above for your p and F.
2. **A written printer quote** for 6.25 × 9 at that exact Q, with indicia, bundling and tax included. The $0.19 quote was for a different size.

**Alternatives:** (a) Mail nothing. (b) Address the 180 households you actually want with regular postcards or First-Class Mail. That's the only way to reach specific homes, at a higher cost per piece (I didn't price it). (c) EDDM at business-mail-entry rates needs a permit and a different process. Not worth it at this volume.

## 4. Spec for the printer

**Job: EDDM-Retail flat, one ZIP Code, Chicago IL, December 2026**

1. **Finished size:** 6.25 in high × 9 in long (or larger, up to 12 × 15 in). Square corners, or rounded corners no larger than 1/8 in radius. Flexible and evenly thick. **No** 6 × 9 pieces.
2. **Thickness / weight:** at least 0.007 in (0.014 in is fine). At most 3.3 oz per piece. Don't seal it shut.
3. **Indicia** (printed, not a stamp) in the top-right corner, within 1.625 in of the right edge and 1.375 in of the top edge, with 1/8 in clear space at the top and right edges. Larger than 0.5 × 0.5 in. All caps, at least 4-point type. Wording, one per line: `PRSRT STD` / `ECRWSS` / `U.S. POSTAGE PAID` / `EDDM RETAIL`. Caveat: USPS shows the indicia only as an image; I took this wording from the image's alt text, so check it against the artwork in the EDDM tool.
4. **Address line** below and to the left of the indicia: `LOCAL POSTAL CUSTOMER` if mailing to all addresses, or `RESIDENTIAL CUSTOMER` if residential only. No names, street addresses, return-service endorsements, handwriting or personal information.
5. **Quantity:** print Q = N + spares, where N = total of the selected routes' counts (to be supplied; at least 200 and at most 5,000).
6. **Bundling:** separate by carrier route. Bundles of 50–100 pieces, no taller than 6 in, strapped. One EDDM facing slip under the straps on top of each bundle, showing ZIP, route number and piece count.
7. **Paperwork (mailer):** get a CRID and fill out and sign PS Form 3587. Postage = N × $0.260, paid at the delivering Post Office by cash, check or card. If shipping instead, use Priority Mail boxes labeled "Every Door Direct Mail - Retail / Open Immediately," numbered "1 of X," addressed to the Postmaster. Box 1 holds a sample piece, the check, PS 3587 and the Postmaster instruction letter.
8. **Drop-off:** at the Post Office that delivers the selected routes, not just any Post Office.
9. **Quote needs to include:** unit price at Q for 6.25 × 9, setup/design, indicia, bundling and facing slips, delivery to the Post Office, and sales tax. All of it has to fit the formula above.

---

**Requirement check:**
- **Met:** all five eligibility rules checked against current USPS pages (section 1); proposed cost and why the estimate doesn't make it eligible (section 2); smallest compliant change, budget formula and what to confirm (section 3); printer spec in the answer (section 4); rule and rate cited.
- **Blocked:** actual route counts. The ZIP wasn't given and counts come from USPS's online EDDM tool, so the final go/no-go is open.
- **Partial:** I read the indicia wording from the image's alt text, not the image itself. Sales tax and any Chicago-specific fees are left in F rather than calculated.
