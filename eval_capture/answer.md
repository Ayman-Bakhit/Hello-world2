**Decision: NO-GO on the printer's plan as written. High confidence.** It breaks three USPS rules at once. The fixable version (6.25" x 9", whole carrier routes, at least 200 pieces) is **INCONCLUSIVE on budget**. No ZIP Code was named, so I can't pull route counts, and the printer hasn't quoted the new size. Your $250 cap works only if the routes you pick total no more than about 555 pieces at $0.19/pc printing and $0 fixed fees.

## 1. Rule check (USPS sources, opened Nov 23, 2026)

| Requirement | USPS rule (Verified) | Proposed plan | Result |
|---|---|---|---|
| **Size** | EDDM-Retail flats must be **longer than 10.5"**, **or taller than 6.125"**, or thicker than 0.25". Max 3.3 oz. ([DMM 143.2.5](https://pe.usps.com/text/dmm300/143.htm)). Overall limits 15" x 12" x 0.75", min 0.007" thick ([DMM 101.2.1](https://pe.usps.com/text/dmm300/101.htm)) | 6" x 9" x 0.014", 0.7 oz. Height 6" ≤ 6.125", length 9" ≤ 10.5", thickness 0.014" ≤ 0.25". That makes it letter-size, not a flat | **FAIL** |
| **Quantity** | At least 200 pieces (or 50 lb), max 5,000 per day per 5-digit ZIP. Under 200 is allowed only if the **whole ZIP** has fewer than 200 deliverable addresses ([DMM 143.2.5](https://pe.usps.com/text/dmm300/143.htm), [145.1.2](https://pe.usps.com/text/dmm300/145.htm)). USPS's EDDM page also says "at least 200 and up to 5,000" ([usps.com EDDM](https://www.usps.com/business/every-door-direct-mail.htm)) | 180 | **FAIL**. A Chicago ZIP with under 200 addresses is essentially impossible (my estimate, not checked) |
| **Route selection** | Must be a saturation mailing with a simplified address, giving "complete distribution". Either "Postal Customer" goes to **all** active deliveries on a route, or "Residential Customer" goes to **all** residential ones ([DMM 602.3.2](https://pe.usps.com/text/dmm300/602.htm)). Counts must come from the EDDM Online Tool, with mail separated by route ([DMM 145.1.3](https://pe.usps.com/text/dmm300/145.htm)). Only addresses that asked to be removed can be dropped, using the facing slip's "Do Not Deliver" column | "Selected households" | **FAIL**. You can't pick individual homes |
| **Postage** | EDDM-Retail flats up to 3.3 oz: **$0.260/pc**. Source: [Notice 123, effective Oct 4, 2026](https://pe.usps.com/text/dmm300/notice123.htm), which the [usps.com EDDM page](https://www.usps.com/business/every-door-direct-mail.htm) also states ("$0.26 per piece"). No nonprofit price, no ancillary endorsements, no extra services, no forwarding ([DMM 143](https://pe.usps.com/text/dmm300/143.htm)) | Printer says it qualifies for the flat rate | Rate is right, but the piece doesn't qualify for it |
| **Payment and entry** | You need a CRID (free at gateway.usps.com) and a signed PS Form 3587. The required indicia is "PRSRT STD / ECRWSS / U.S. POSTAGE / PAID / EDDM-Retail" ([DMM 144](https://pe.usps.com/text/dmm300/144.htm), Exhibit 1.3). The mail must be entered at the Post Office or delivery unit that serves the selected routes ([DMM 146.1.1](https://pe.usps.com/text/dmm300/146.htm)) | Not specified | Must be done |

USPS also states that Marketing Mail "may receive deferred handling" with no delivery guarantee ([DMM 143.2.1](https://pe.usps.com/text/dmm300/143.htm)). In December that's a real timing risk. Separately, I didn't check whether a January 2027 price change exists, so if the drop slips into January, check the rate again.

## 2. What the proposed plan would cost if it were eligible

- Print: 180 x $0.19 = **$34.20**
- Postage: 180 x $0.260 = **$46.80**
- Total: **$81.00**, leaving $169 under the cap. This excludes tax, shipping and setup, none of which have been quoted.

**This price doesn't make the mailing allowed.** $81 just multiplies a real rate by a quantity that rate can't be used for. Postage is set by eligibility (size, quantity, saturation), not by what fits the budget. At the counter, the Post Office would refuse this mailing or charge a different rate. Fitting under $250 doesn't change that.

## 3. Least-change compliant alternative

**What changes:**
1. **Size: 6.25" x 9"** (was 6" x 9"). That's 4% more paper, the smallest change that clears the "taller than 6.125"" test. Exactly 6.125" fails because the piece must be greater than 6.125". Weight goes from about 0.70 to 0.73 oz at the same stock, well under 3.3 oz.
2. **Audience:** replace selected households with one or more **whole carrier routes** in the same ZIP, residential-only, adding up to at least 200.
3. **Quantity:** N equals the EDDM tool's count for those routes, not 180.

**Budget formula:**

```
N × 0.260  +  (N + s) × p  +  F  ≤  250
```

- N = total residential (or total) deliveries on the selected routes, from the EDDM Online Tool
- s = print overs: 1 sample piece for the Post Office (DMM 144.2.2) plus spares
- p = per-piece print price for 6.25" x 9", which must be re-quoted. The $0.19 was for 6" x 9" and doesn't carry over.
- F = fixed costs: setup, design, tax, delivery to the Post Office

**Ceiling on N, assuming s ≈ 0 (calculated in code):**

| Fixed costs F | Max N at p = $0.19 |
|---|---|
| $0 | 555 (total $249.75) |
| $25 | 500 |
| $50 | 444 |

Rearranged, this is the highest print price that still fits: p_max = (250 − F)/N − 0.26. At F = $0:

| N | 200 | 300 | 400 | 500 | 555 |
|---|---|---|---|---|---|
| p_max | $0.99 | $0.57 | $0.37 | $0.24 | $0.19 |

**What decides the answer (needs confirming):**
- **Route count:** does the target ZIP have a route, or set of whole routes, with 200 to roughly 450–555 residential deliveries? If even the smallest qualifying set is over the ceiling, it's no-go at $250 unless print gets cheaper. I don't know Chicago route sizes and haven't verified them. Get them from https://eddm.usps.com/eddm (Show Table → Residential column).
- **Print quote:** a firm all-in price for 6.25" x 9" at quantity N + s, including tax and delivery. 6.5" x 9" is a common EDDM size and USPS's old fact sheet lists it. If the printer charges less for 6.5" x 9" than for 6.25" x 9", take it, since it's equally compliant.

**Go if:** N is at least 200, and 0.26N + p(N+s) + F ≤ 250 using the real quote. **Stop if:** the smallest whole-route set that reaches 200 breaks the formula.

**Other options:**
- **Do nothing.** Costs $0.
- **Keep the targeted 180 households and skip EDDM.** Send the 6" x 9" cards as First-Class letters with stamps, at $0.82 each up to 1 oz ([Notice 123](https://pe.usps.com/text/dmm300/notice123.htm); a retail postcard can be at most 4.25" x 6", so these pay the letter price). Total: 180 x ($0.19 + $0.82) = **$181.80**. That's compliant and under budget, but you need names and addresses and you have to stamp each piece. If hitting those exact households matters more than reach, this is actually the smallest change.

## 4. Specification for the printer

**Piece**
- Finished trim **6.25" (H) x 9" (L)**, nominal. No piece may trim to 6.125" or less.
- Rectangular, with square corners or corners rounded no more than 1/8".
- 14 pt card stock (0.014"). Flexible, uniform thickness. Weight 3.3 oz max (expect about 0.73 oz).
- Nothing attached. If anything is attached later, it must meet DMM 143.3.5.
- No personal information, no handwritten or typed-in content, no bills.

**Address side**
- **Indicia**: upper right, above and right of the address block, inside an area 1.625" from the right edge and 1.375" from the top. Leave 1/8" clear at the top and right edges. Larger than 0.5" x 0.5". All caps, at least 4 pt. Text, exactly as in DMM 144 Exhibit 1.3:
  `PRSRT STD / ECRWSS / U.S. POSTAGE / PAID / EDDM-Retail`
- **Address block**: `POSTAL CUSTOMER` (USPS's EDDM page format). DMM 602.3.2 also allows `RESIDENTIAL CUSTOMER` for residential-only routes. Pick one and make it match the route selection.
- No names, no street addresses, no ancillary endorsements such as "Return Service Requested".

**Quantity**
- Print N + 1 sample + spares (N comes from the EDDM tool order).
- Postage is paid only on N.

**Bundling**
- Separate the pieces by carrier route.
- Bundles of 50–100 pieces, no taller than 6" (100 pieces at 0.014" is about 1.4").
- Put an EDDM facing slip on top of each bundle, under the strap, with the piece count written on it.
- Do not mix routes in one bundle.

**Paperwork**
- EDDM Online Tool order for the selected routes.
- CRID.
- Signed PS Form 3587, with carrier route info filled in on the back.
- One sample piece.
- Pay online or at the counter.

**Drop-off**
- Take it to the specific Post Office or delivery unit named in the EDDM order summary for those routes, not just any Chicago Post Office.
- Drop early in December. Marketing Mail can be deferred and has no delivery guarantee.

**Requirement check:**
- R1 rules: Met (section 1).
- R2 cost: Met ($81.00).
- R3 whether the price allows the mailing: Met (it doesn't).
- R4 alternative and formula: Met (section 3).
- R5 what must be confirmed: Met.
- R6 printer spec in the body: Met (section 4).
- R7 citations: Met.
- **Blocked:** route counts. No ZIP was given, and the EDDM tool needs a browser session. The 6.25" x 9" print quote can only come from the printer.
