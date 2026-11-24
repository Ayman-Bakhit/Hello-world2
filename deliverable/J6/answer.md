# J6: Should a one-person software/AI LLC make federal contracts its main channel for the next 6 months?

## Decision: PURSUE LATER (not as your main channel for the next 6 months)

**Confidence: moderate.** The rules don't block you. You qualify as small, and registering is free. The problem is the market *you can actually reach* in 6 months with no federal past performance and no contract vehicle. In FY2025 it was tiny:

- **$10.53B** was obligated under NAICS 541511, but only **$117.5M (1.1%)** went to awards sized $15k to $350k, the range a solo firm can win directly.
- Inside that range, total small business set-asides came to **200 awards worth $9.8M across the whole government**, averaging about $49k each.
- Most of the money moves through large vehicles and task orders where you'd need a seat or a prime partner first.

Making federal your *main* channel for 6 months means betting your pipeline on a win rate I can't source (see Sensitivity). The award-to-cash lag also pushes most of the revenue past the 6-month window.

**What to do now (cheap, capped):** spend about $0 and 30 to 40 hours over 6 months building the foundation, and keep private clients as the main channel.
1. Register in SAM.gov and get a UEI. It's free, takes a few hours of your time, and the government's processing can take weeks (processing time unverified).
2. List NAICS 541511, plus 541512 and 541519 if they fit what you sell. Fill out your SBA small business profile.
3. Pick **2 to 3 agencies** (HHS, VA, or DHS; reasons in Q1) and work the subcontracting route below.

**Entry route when you do pursue (recommended order):**
1. **Subcontract to small-business primes** that already hold 541511 set-aside awards or vehicles at HHS, DHS, or VA. Use USAspending's recipient view, filtered to 541511 + SBA set-aside + agency, to get names. Offer a specific AI-automation capability as a sub. This builds past performance with no proposal burden or vehicle requirement.
2. **Direct micro-purchases (≤$15k) and sub-SAT RFQs ($15k to $350k)** for small, well-scoped automation work. Find them through agency small business offices (OSDBU) and SAM.gov opportunities.
3. **Only after 1 to 3 past performances:** go after a GSA MAS schedule or a seat on a larger vehicle. Do not start with this.

Doing nothing on federal is a credible alternative. It only beats the cheap foundation if your private pipeline is already full at good rates, because the foundation costs about 40 hours and $0.

---

## Q1. FY2025 obligations, NAICS 541511 (USAspending.gov)

**Source:** USAspending.gov public API v2, retrieved **2026-11-24 ~12:01 UTC**.
**Common filters:**
- `time_period` 2024-10-01 to 2025-09-30 (action date, i.e., obligations recorded in FY2025)
- `award_type_codes` A, B, C, D (all contract types: BPA calls, purchase orders, delivery orders, definitive contracts; IDVs excluded so nothing is double counted)
- `naics_codes.require` = ["541511"]

The script that produced these numbers is in `deliverable/J6/usaspending_fy25_541511.py`.

| Metric | Value | Endpoint / extra filter |
|---|---|---|
| **Total obligations, FY2025** | **$10,533,826,643** | `/api/v2/search/spending_over_time/` (group=fiscal_year). This matches the sum of all 58 agencies from `/spending_by_category/awarding_agency/` |
| **Total small business set-aside** (code `SBA`) | **$1,503,558,741 (14.3%)** | same + `set_aside_type_codes:["SBA"]` |
| Partial small business set-aside (`SBP`) | $3,001,343 | `["SBP"]` |
| All small-business-type set-asides combined (SBA, SBP, 8(a) competed and sole source, SDVOSB, WOSB/EDWOSB, HUBZone) | $2.634B (25.0%) | sum of the individual code queries |
| Contract awards with FY2025 activity | 7,689 | `/spending_by_award_count/` |
| Awards sized $15k to $350k | 2,378 awards, $117.5M obligated (avg $49,410) | + `award_amounts` {15000 to 350000} |
| Of those, total small business set-aside | **200 awards, $9.78M** (avg $48,887) | + `["SBA"]` |
| New awards in FY2025, $15k to $350k (all set-aside types) | 1,032 | `date_type: new_awards_only` |
| Top 10 recipients' share | 27.2% (GDIT $579M, Booz Allen $544M, Lockheed $340M, IBM $337M, Carahsoft $193M...) | `/spending_by_category/recipient/` |

**Top awarding agencies, all 541511 obligations, FY2025:**

| # | Agency | Obligated | Share |
|---|---|---|---|
| 1 | Defense (DOD) | $4,234.9M | 40.2% |
| 2 | Health & Human Services (HHS) | $1,335.2M | 12.7% |
| 3 | Veterans Affairs (VA) | $811.8M | 7.7% |
| 4 | Homeland Security (DHS) | $772.7M | 7.3% |
| 5 | General Services Administration (GSA) | $551.4M | 5.2% |
| 6 | Commerce | $468.8M | 4.5% |
| 7 | Justice | $425.1M | 4.0% |
| 8 | Treasury | $391.6M | 3.7% |

The top 5 agencies account for 73.2% of the total.

**Top agencies under total small business set-asides:** DOD $606.0M (40.3% of set-aside dollars), HHS $367.0M (24.4%), DHS $83.7M, DOT $70.8M, DOJ $63.9M, DOE $63.5M.

**Why HHS/VA/DHS and not DOD first:** DOD is the biggest pool, but new DoD contracts now increasingly carry the CMMC clause. DFARS 252.204-7021 (NOV 2025) is in eCFR (verified: https://www.ecfr.gov/current/title-48/section-252.204-7021). That clause adds cybersecurity assessment costs if the work touches controlled unclassified information (CUI). HHS has the second-largest small business set-aside pool and doesn't carry that requirement.

**Caveats (what I could not verify):**
- **Set-aside coding is incomplete.** All the set-aside codes, including "NONE", add up to only $4.12B of the $10.53B. The other **$6.42B has no set-aside code** in this API. My guess is that it's mostly task orders under vehicles, which often leave the field blank, but I haven't verified that. So 14.3% is a **floor** for set-aside spending, not the true share.
- **`award_amounts` semantics.** I'm treating this filter as the award's total obligated amount. It's an award-level filter on FY2025 transaction activity. The ≤$15k band came out net negative (−$40M) because of deobligations, so the size-band figures are indicative only. Treat them as order-of-magnitude.
- **NAICS boundaries.** Software and AI work is also coded under 541512, 541519, and 541715. The reachable market is larger than 541511 alone. I did not pull those codes.
- **Data can change.** USAspending data is revised over time, so a later pull may differ slightly.

## Q2. Micro-purchase and simplified acquisition thresholds

**Verified** in 48 CFR 2.101 (eCFR, current through 2026-11-20): https://www.ecfr.gov/current/title-48/section-2.101

- **Micro-purchase threshold (MPT): $15,000.** Lower carve-outs apply: $2,500 for services subject to the Service Contract Labor Standards and $2,000 for construction, with higher limits for contingency or emergency buys.
- **Simplified acquisition threshold (SAT): $350,000.** Higher for contingency and emergency buys.
- These were $10,000 and $250,000 before an inflation adjustment I believe took effect 2025-10-01 (*unverified: from memory, I did not open the rule*).

**What they mean for you:**
- **≤$15k:** a contracting officer or purchase-card holder can buy with minimal competition. This is the easiest door for a first sale, but at your scale it's pocket money.
- **$15k to $350k:** under FAR 19.502-2(a), these buys **must be set aside for small business** unless the contracting officer doesn't expect offers from 2 or more competitive small businesses. This is your best direct lane. The procedures are simplified (quotes, not full proposals). **Verified:** https://www.ecfr.gov/current/title-48/section-19.502-2
- **>$350k:** you only get a set-aside if the "rule of two" is met, and you face full FAR procedures and competitors with past performance. A solo shop is not realistic here as prime yet.
- **Watch item:** the FAR is being rewritten (the "Revolutionary FAR Overhaul"), and agencies are applying class deviations (https://www.acquisition.gov/far-overhaul, opened 2026-11-24). Section numbers and wording may differ at the agency you sell to. I believe the dollar thresholds and the small business reservation come from statute and will persist, but that's *unverified* for each agency's deviation text.

## Q3. SBA size standard for 541511: do you qualify?

- **$34.0 million in average annual receipts.** **Verified** in 13 CFR 121.201 (eCFR current through 2026-11-20): https://www.ecfr.gov/current/title-13/section-121.201
- **How receipts are measured** (13 CFR 121.104(c), verified: https://www.ecfr.gov/current/title-13/section-121.104): total receipts over the last 5 completed fiscal years ÷ 5. If you've been in business less than 5 years, it's receipts ÷ weeks in business × 52. **Affiliates count** (13 CFR 121.103).
- **You qualify.** Under $250k is less than 1% of $34M (0.74% even at $250k). The one exception: if you're affiliated with a larger company through common ownership or control, I'd need to know.
- **You self-represent size** in SAM for each solicitation's NAICS code. No SBA certification is needed for a total small business set-aside (FAR 19.301-1, verified: https://www.ecfr.gov/current/title-48/section-19.301-1). Programs like 8(a), WOSB, SDVOSB, and HUBZone *do* require separate certification and eligibility. I haven't assessed whether you qualify for any of them.

## Q4. Do you have to register before you can bid or be paid?

**Yes. SAM.gov registration is required at the time you submit an offer or quote** (48 CFR 4.1102(a), verified: https://www.ecfr.gov/current/title-48/section-4.1102). Contracting officers must check it (4.1103). Registration gives you your UEI and your representations and certifications.

**Exceptions** (4.1102(a), verified). The ones that matter to you:
- (1) **Micro-purchases paid with the government purchase card as both the purchasing and payment method.** This is the one exception you might realistically use.
- (7) Micro-purchases not paid by electronic funds transfer and not required to be reported.

The rest don't apply to you: classified contracts, deployed or overseas or emergency contracting officers, individuals performing outside the US, urgency sole-source awards, and foreign vendors ≤$40k.

**In practice:** register anyway. Without SAM you're invisible to set-aside searches and can't take any reported award. Registration is free on SAM.gov (my understanding; *unverified this session*). Ignore third-party "registration services" that charge for it. Renew every year (*unverified this session*).

## Q5. What would change my recommendation

**Flip to "pursue now":**
- You get a named prime or agency buyer who commits to a sub or a sub-SAT order within about 90 days, i.e., a real first buyer, not "interest."
- You find 15 or more open RFQs in your lane in 30 days of checking SAM.gov opportunities and agency forecasts.
- You already have federal past performance through a former employer or a teaming partner, or a teammate offers you a seat on a vehicle.
- Your private-sector pipeline is producing less than about $100 of signed contract value per sales hour.

**Flip to "do not pursue":**
- Your private pipeline is full at strong rates.
- Your work requires CUI or DoD access, which triggers CMMC costs.
- Your offer doesn't map to 541511/541512/541519 buys.

**Sensitivity (the number that decides it).** These are all estimates, not sourced:
- 6-month effort: 18 sub-SAT bids × 15 hours each + 80 hours of setup and market research = **350 hours of business development**.
- Average award: $49,410 (USAspending FY25 average, $15k to $350k band).

| Win rate (assumed) | Expected wins | Expected award value | Award value per BD hour |
|---|---|---|---|
| 2% | 0.36 | $17,788 | $51 |
| 5% | 0.90 | $44,469 | $127 |
| 10% | 1.80 | $88,938 | $254 |
| 20% | 3.60 | $177,876 | $508 |

- **Break-even win rate:** 3.9% if a sales hour on private work is worth $100 of signed value, and 5.9% if it's worth $150.
- **I have no source for a new entrant's win rate**, and that's exactly the variable that flips the answer.
- These figures are *award value*, not cash or profit. Delivery hours, the award-to-payment lag (prompt-payment terms; *unverified this session*), and a likely gap of several months before the first award all push realized cash in the 6-month window **below** this table.

**Falsification test (cheap, 30 days, $0):** count real, open 541511/541512 RFQs at HHS, VA, and DHS that you could deliver solo, and send a capability statement to 10 small-business primes from the USAspending recipient list.
- **Stop:** fewer than 5 viable RFQs and 0 prime replies. That confirms "later."
- **Go:** 15 or more RFQs, or 2 or more primes asking for a call. Move to "pursue now" through subcontracting.

---

## Requirement coverage

| # | Requirement | Status |
|---|---|---|
| R1 | Decision + entry route | Met: "Decision" section (Pursue later; sub to SB primes → micro/sub-SAT → vehicles) |
| R2 | Q1 total, set-aside, top agencies, from USAspending FY25, with source/filters/date | Met: Q1 table, $10.53B / $1.50B / DOD-HHS-VA. Partial: set-aside coding gap ($6.42B uncoded) disclosed |
| R3 | Q2 MPT/SAT + meaning | Met: $15k / $350k verified in 48 CFR 2.101. Prior values and effective date unverified |
| R4 | Q3 size standard + qualify | Met: $34.0M verified; yes, affiliation is the only caveat |
| R5 | Q4 registration + exceptions | Met: FAR 4.1102 verified. "Free" and annual renewal unverified this session |
| R6 | Q5 what changes recommendation | Met |
| R7 | Say what couldn't be verified | Met: caveats in Q1, Q2, Q4, Sensitivity |
| R8 | Save to deliverable/J6/answer.md, commit only that folder, push | Done: see reply |
