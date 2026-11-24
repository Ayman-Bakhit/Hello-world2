# StudyPal launch brief: review

Reviewed 2026-11-24. All sources listed below were opened in this session unless a claim is marked **Unverified**.

## Verdict (confidence: high)

**Don't approve the brief as written.** Split it into three parts:

| Item | Decision | Why |
|---|---|---|
| Form DE C-corp, issue founder stock with 83(b) | **Approve, with two fixes** (low par value plus the right franchise tax method; founder IP assignment) | Cheap and low regret. The tax claim in the brief is wrong, but it's easy to fix. |
| Hire 2 contractors | **Approve only with written IP assignments and a fixed scope that includes the COPPA consent flow** | Without an assignment the company may not own the code. $3,000 total is probably not enough for this scope. |
| $20,000 paid acquisition in Q1 | **No-go.** Replace it with a gated test of about $1,500 to $2,000 | The LTV math is off by 10x. Corrected, the brief fails its own 3x rule (2.67x, or 2.27x after store fees). |
| Feb 2027 launch | **Blocked until the product complies with COPPA** | The brief's sign-up and data design would collect children's personal information without parental consent. |

The two errors that matter most are the 10x LTV mistake and the missing COPPA analysis. Either one is enough to change the decision.

---

## 1. What's wrong

### 1a. LTV is off by 10x (Section 5). This alone reverses the ad-spend decision.
I ran the math in code, using the brief's own formula and inputs:

- LTV = $12 × 0.80 / 0.08 = $9.60 / 0.08 = **$120**, not $1,200.
- LTV/CAC = $120 / $45 = **2.67x**, which is below the 3x benchmark the brief itself uses.
- The highest CAC that clears 3x is **$40**.
- **After app store fees:** Apple's Small Business Program and Google Play subscriptions both take about 15% (sources below). Net price = $12 × 0.85 = $10.20. LTV = $10.20 × 0.80 / 0.08 = **$102**, and LTV/CAC = **2.27x**. The highest CAC for 3x falls to **$34**.
- Payback (cohort-level, undiscounted, churn applied): month 6 without the store fee, **month 7 with it**. $20,000 at $45 CAC buys about 444 subscribers.

The ratio depends heavily on two inputs, neither of which has a source. LTV/CAC with the 15% fee:

| Monthly churn \ CAC | $30 | $45 | $60 | $90 |
|---|---|---|---|---|
| 5% | 5.44 | 3.63 | 2.72 | 1.81 |
| 8% (brief) | 3.40 | **2.27** | 1.70 | 1.13 |
| 10% | 2.72 | 1.81 | 1.36 | 0.91 |
| 12% | 2.27 | 1.51 | 1.13 | 0.76 |
| 15% | 1.81 | 1.21 | 0.91 | 0.60 |

You only clear 3x at roughly CAC ≤ $34 with 8% churn, or with churn near 5%. Three inputs are unsourced estimates and could each be optimistic:
- **8% churn.** A homework product for grades 3 to 8 will likely see churn spike over summer break (June to August). A flat 8% ignores that. *(Estimate, no data.)*
- **$45 CAC** for a *paying* subscriber from app store ads. No source. *(Estimate.)*
- **80% gross margin.** The product runs voice, image understanding and an LLM on every session. To keep 80% on $10.20 net, AI and infrastructure costs have to stay at or below **$2.04 per subscriber per month**, including heavy users. Nobody has measured this yet. *(Arithmetic on your inputs.)*

Pricing check: Khanmigo charges **$4/month or $44/year** for parents and learners ([khanmigo.ai/pricing](https://www.khanmigo.ai/pricing), Verified). That makes your $12 price 3x a well-known competitor. Free general chatbots are also substitutes. This doesn't prove $12 fails, but it's the strongest contrary evidence on conversion, and the brief doesn't address it.

### 1b. The Delaware franchise tax is not a flat $50 (Section 1)
- The $50 is the **annual report filing fee**, not the tax: "For an Annual Report ... for non-exempt domestic corporations the filing fee is $50" ([corp.delaware.gov/frtax](https://corp.delaware.gov/frtax/), Verified).
- Under the **Authorized Shares Method** (the default), the tax is $250 for 5,001 to 10,000 shares plus $85 for each additional 10,000 shares, up to a $200,000 maximum ([corp.delaware.gov/frtaxcalc](https://corp.delaware.gov/frtaxcalc/), Verified). For 10,000,000 authorized shares: $250 + 999 × $85 = **$85,165 a year**.
- Under the **Assumed Par Value Capital Method**, the minimum is $400, at "$400.00 per million or portion of a million" ([same page](https://corp.delaware.gov/frtaxcalc/), Verified). With a low par value (for example $0.00001) and small gross assets (I tested $25k and $100k), the result is **$400**. Total yearly cost is about **$450** including the report fee.
- **Fix:** keep the 10M shares, but set a very low par value and file using the APVC method by **March 1** each year. The penalty for missing the deadline is $200 plus 1.5% interest per month ([frtax](https://corp.delaware.gov/frtax/), Verified). Delaware's default invoices often show the large Authorized Shares figure, so don't panic and don't pay it. Recalculate instead.
- The brief's conclusion ("10M shares costs nothing extra") is roughly right *only if* you use APVC. The reasoning it gives is wrong.

### 1c. The 1099-NEC threshold is out of date (Section 4)
- For tax years beginning after 2025, the threshold "increased to $2,000 and may be adjusted for inflation beginning in calendar year 2027" ([IRS Instructions for Forms 1099-MISC and 1099-NEC](https://www.irs.gov/instructions/i1099mec), Verified). The $600 figure no longer applies to 2026 payments.
- At about $1,500 per contractor, **you probably don't have to file either 1099-NEC**, whether the payments land in 2026 or 2027. You may still file voluntarily. Remove the January filing task from the budget.
- Still collect the W-9s. If a contractor's total passes $2,000 in any calendar year (scope creep is common), you must file.
- If you pay contractors by credit card or a payment network, those payments go on Form 1099-K from the processor and are "not subject to reporting on Form 1099-MISC or Form 1099-NEC" ([same page](https://www.irs.gov/instructions/i1099mec), Verified).

### 1d. Section 2 overstates what the 83(b) election does
The 30-day deadline is correct: "not later than 30 days after the date of such transfer" ([26 USC 83(b)](https://www.law.cornell.edu/uscode/text/26/83), Verified). Three corrections:
- The election doesn't make income untaxed. It moves the tax to the grant date, on the share value minus what you pay. **Buy the shares at fair value** (par value, for example 8,000,000 × $0.00001 = $80) so the taxable spread is about $0. Later growth is then capital gain, and the holding period starts at grant, which also matters for QSBS.
- You must also give a copy of the election to the company ([26 CFR 1.83-2(d)](https://www.law.cornell.edu/cfr/text/26/1.83-2), Verified). Send the IRS copy by certified mail and keep the proof.
- The IRS has a Form 15620 for this election. **Unverified:** I didn't open the form, so check the current filing method on irs.gov.

### 1e. Section 3 (QSBS) is accurate, but the 3-year benefit is smaller than it sounds
What the brief says is correct: 50%, 75% and 100% at 3, 4 and 5 years for stock *acquired* after the applicable date. The cap is $15M per issuer, or 10x basis if that's larger, and it's indexed after 2026. Gross assets must stay at or below $75M ([26 USC 1202](https://www.law.cornell.edu/uscode/text/26/1202), Verified). The applicable date is the OBBBA enactment date, July 4, 2025 ([govinfo P.L. 119-21](https://www.govinfo.gov/app/details/PLAW-119publ21), seen in search results, page not opened, so treat it as Unverified).

What's missing: the part of the gain that *isn't* excluded is "section 1202 gain", which is taxed at a **28%** rate, not 20% ([26 USC 1(h)(4), (h)(7)](https://www.law.cornell.edu/uscode/text/26/1), Verified). Illustration on a $1M gain (federal only; I assumed 3.8% NIIT applies to the taxable part):
- 3 years: ~$159,000 tax vs ~$238,000 without QSBS. That's **33% savings**, not 50%.
- 4 years: ~$79,500.
- 5 years: ~$0.

Also check whether your state follows QSBS (**Unverified**, varies by state) and whether AMT applies to partial exclusions (**Unverified**, ask a CPA). This is a minor issue. QSBS only matters if the company reaches an exit, and none of the bigger problems in this review depend on it.

---

## 2. What's missing

### 2a. COPPA compliance. This is the biggest gap, and it blocks the launch as designed.
Grades 3 to 8 is roughly ages 8 to 14, so most of your users are under 13. "Child means an individual under the age of 13" ([16 CFR 312.2](https://www.law.cornell.edu/cfr/text/16/312.2), Verified). A homework app for grades 3 to 8 that is marketed to kids meets the rule's "directed to children" factors (subject matter, intended audience).

Almost everything the brief collects counts as **personal information** under 312.2 (Verified, same link):
- "A first and last name": you collect it at sign-up.
- "Online contact information" (an email address): you collect it at sign-up.
- "A photograph, video, or audio file where such file contains a child's image or voice": voice recordings, plus any photo showing a child's face or name.
- Biometric identifiers, including voiceprints.

What the rule requires that the brief ignores ([16 CFR 312.5](https://www.law.cornell.edu/cfr/text/16/312.5) and [312.10](https://www.law.cornell.edu/cfr/text/16/312.10), Verified):
1. **Verifiable parental consent "before any collection, use, or disclosure."** Your sign-up collects a child's name and email before any parent is involved.
2. **Separate consent for disclosure to third parties**, unless the disclosure is integral to the service. Using kids' data "to improve our prompts" is hard to call integral. Whether sending data to your LLM or voice vendor needs separate consent is a question for counsel (**Unverified**, I don't know).
3. **The audio exception doesn't cover you.** It applies only when audio is used to answer the child's request, is not used for anything else, and is deleted "immediately after responding." Keeping recordings for memory and prompt improvement is outside it.
4. **Retention:** child data "may not be retained indefinitely." You need a written retention policy with "a timeframe for deletion." "Remember past sessions" with no deletion period doesn't comply.

Timing and stakes: the amended rule took effect June 23, 2025, and the compliance date was **April 22, 2026**, so it fully applies to a Feb 2027 launch ([Federal Register 2025-05904](https://www.govinfo.gov/content/pkg/FR-2025-04-22/html/2025-05904.htm), Verified). The maximum civil penalty is **$53,088 per violation** ([16 CFR 1.98(d)](https://www.law.cornell.edu/cfr/text/16/1.98), Verified, for penalties assessed after Jan 17, 2025). A search result says there was no 2026 inflation adjustment (Unverified). One startup with a few thousand kids' accounts could face penalties far larger than the whole company.

**Fix (changes the product, not just the paperwork):**
- The parent creates the account using the parent's email. The child gets a first name or nickname only. No child email, no last name.
- Get verifiable consent through the parent's paid subscription checkout. **Unverified:** I believe a payment-card method is one of the accepted consent methods in 312.5(b), but I didn't open that paragraph, so confirm it.
- Turn voice into text and delete the audio right away by default. Keep text session memory for a set period (for example 90 days) and publish that period.
- Make "use my child's data to improve the product" a separate opt-in that is off by default.
- Write a privacy policy, a parent notice, a retention policy and a security program. Then pay a COPPA lawyer, or an FTC-approved Safe Harbor program, to review it **before** launch. **I don't know the cost; get 2 quotes.**

### 2b. App store rules for kids' apps
If you list in Apple's **Kids Category**: "Kids Category apps may not send personally identifiable information or device information to third parties," and third-party analytics and ads are restricted ([App Review Guideline 1.3](https://developer.apple.com/app-store/review/guidelines/), Verified). That conflicts with sending photos and voice to an outside AI API. Decide on the category before you build. Guideline 5.1.4 requires COPPA compliance for kids' apps either way (**Unverified**, the page text was cut off before 5.1.4). Aim your app store ads at **parents**, not kids.

### 2c. IP ownership
- **Contractors:** without a signed IP assignment, the freelancers may own the code they write. Software by independent contractors usually doesn't qualify as "work made for hire" (**Unverified**, from memory of 17 USC 101). Get a signed contractor agreement with IP assignment and confidentiality **before any work starts**.
- **Founder:** sign a technology and IP assignment that moves anything you've already built into the corporation. Investors and acquirers check for this.

### 2d. Delivery feasibility of a $3,000 build
Two contractors at about $1,500 each is roughly 30 to 40 hours each, if you assume $40 to $50 per hour (**estimate**; I don't know their rates). The scope is mobile plus web, photo understanding, voice, session memory, subscriptions on two app stores, and the COPPA consent flow, delivered in about 10 weeks. I don't think that fits. Get fixed-scope written quotes, or cut the scope (for example: one platform, text plus photo first, voice later).

### 2e. Smaller items
- **Foreign qualification:** if you operate from Iowa, a Delaware corp usually has to register in Iowa too, which means extra fees and yearly reports (**Unverified**; check the Iowa Secretary of State). Add a registered agent fee as well.
- **Kids aged 13 to 14 (grade 8) and state laws:** COPPA doesn't cover them, but some state privacy and AI-chatbot laws for minors may (**Unverified**; ask counsel when you review COPPA).
- **AI vendor terms on minors:** check whether your model and voice providers allow use by under-13s, and on what terms (**Unverified**).
- **Child safety and accuracy:** you need a plan for content filtering and for wrong answers. That's both a trust risk and a churn risk.
- **"Do nothing" and cheaper alternatives:** the brief compares no alternatives. The cheapest real alternative is a **parent-paid web beta** with a manual waitlist: no app store fee, faster to build, same COPPA flow. Another option is targeting **13+ (grades 9 to 12)**, which avoids COPPA but is a different product and market.

---

## 3. What's fine as written
- A Delaware C-corp is the right choice if you may raise VC money or care about QSBS.
- 10M authorized shares with 8M issued to the founder leaves 2M for an option pool. That's standard.
- 4-year vesting with a 1-year cliff on founder stock is standard, and investors like it.
- Filing an 83(b) within 30 days is correct and important.
- The QSBS tier description and the $15M cap are correct.
- Collecting W-9s is correct.
- US-only and direct-to-family is a coherent start. Selling to families (not schools) also avoids school procurement and FERPA contracting (**Unverified** that FERPA wouldn't apply; it generally covers schools).

---

## 4. Revised decision and plan

**Gate before any ad money:** (1) COPPA-compliant flow, reviewed by counsel; (2) measured AI cost per active subscriber per month at or below $2.04; (3) signed IP assignments.

| When | Action | Cost | Pass / stop rule |
|---|---|---|---|
| Week of Dec 1 | Form the DE C-corp with a low par value. Sign the founder stock purchase agreement (pay par) and the founder IP assignment. File the 83(b) within 30 days of transfer and send a copy to the company. | DE filing plus agent fees (**get quotes**, I didn't verify them); ~$450/yr DE tax and report fee using APVC | 83(b) mailed with proof by day 30 |
| Dec | Sign contractor agreements with IP assignment. Get fixed-scope quotes that include the parent consent flow and audio deletion. Collect W-9s. | Quotes decide this | If quotes are well above $3k, cut scope (one platform, text plus photo) rather than ship without COPPA |
| Dec to Jan | COPPA review by a lawyer or Safe Harbor program. Write the privacy policy, retention policy and parent notice. | **Unknown, get 2 quotes** | Sign-off before launch, or don't launch |
| Feb 2027 | Soft launch. Run an ad test aimed at parents: **$1,500 to $2,000** over 3 to 4 weeks (about 35 to 45 paying subscribers at $45 CAC). Track cost per paying subscriber, trial-to-paid rate, and month-1 churn. | $1,500 to $2,000 | **Scale** only if paid CAC ≤ $34 *and* month-1 churn ≤ 8% *and* AI cost ≤ $2.04/sub. **Stop or reprice** if CAC > $50 or churn > 12% after the second cohort. |
| Mar to Apr | Only if the test passes, release spend in $5k tranches, checking each cohort's 60-day retention before the next. Budget for a summer churn spike. | Up to the $20k originally planned | Same thresholds per tranche |

**What would change my view:**
- A real test showing paid CAC well under $34 with churn near 5% would justify spending the full $20k quickly.
- If COPPA counsel approves a design close to the current one, the build cost and timeline shrink.
- If parents won't pay $12 when Khanmigo costs $4, the price or the positioning has to change before any scaling.

---

## Sources (opened this session, 2026-11-24, unless noted)
- Delaware franchise tax and report fee: https://corp.delaware.gov/frtax/ and https://corp.delaware.gov/frtaxcalc/
- IRS 1099-NEC $2,000 threshold and 1099-K note: https://www.irs.gov/instructions/i1099mec (page labeled Revised 12/2026)
- QSBS: https://www.law.cornell.edu/uscode/text/26/1202 ; 28% rate on section 1202 gain: https://www.law.cornell.edu/uscode/text/26/1
- 83(b): https://www.law.cornell.edu/uscode/text/26/83 ; https://www.law.cornell.edu/cfr/text/26/1.83-2
- OBBBA enactment July 4, 2025: https://www.govinfo.gov/app/details/PLAW-119publ21 (search result only, not opened)
- COPPA rule: https://www.law.cornell.edu/cfr/text/16/312.2 , https://www.law.cornell.edu/cfr/text/16/312.5 , https://www.law.cornell.edu/cfr/text/16/312.10
- COPPA amendment dates: https://www.govinfo.gov/content/pkg/FR-2025-04-22/html/2025-05904.htm
- FTC penalty amount: https://www.law.cornell.edu/cfr/text/16/1.98
- Apple 15% Small Business Program: https://developer.apple.com/app-store/small-business-program/ ; subscriptions: https://developer.apple.com/app-store/subscriptions/
- Google Play subscription fees: https://support.google.com/googleplay/android-developer/answer/112622 (the table extraction was partly garbled; the 15% for subscriptions is clear)
- Apple Kids Category 1.3: https://developer.apple.com/app-store/review/guidelines/
- Khanmigo price: https://www.khanmigo.ai/pricing

Calculations were run in Python. The inputs are the brief's own numbers plus a 15% store fee; outputs are shown in Section 1a and 1b.

---

## Requirement check
- R1 Review the brief: **Met** (Sections 1 to 4 cover every section of the brief).
- R2 What's wrong: **Met** (Section 1: LTV, franchise tax, 1099 threshold, 83(b) wording, QSBS 28% nuance).
- R3 What's missing: **Met** (Section 2: COPPA, app store kids rules, IP, build feasibility, smaller items).
- R4 What's fine: **Met** (Section 3).
- R5 Be specific; no objections just to look thorough: **Met.** Items that are correct are kept in Section 3, and QSBS is flagged as minor.
- R6 Save to deliverable/J4/answer.md: **Met** (this file).
- R7 Commit only that folder to the session branch and push: done after writing; see the chat reply.
- R8 Reply with the branch name: see the chat reply.

**Not fully verified:** the IRS 83(b) filing method (Form 15620), state QSBS conformity and AMT, the work-made-for-hire rule, Iowa foreign qualification fees, the payment-card consent method in 312.5(b), App Review 5.1.4 text, AI vendor minor-use terms, and lawyer or Safe Harbor costs. All are marked Unverified above.
