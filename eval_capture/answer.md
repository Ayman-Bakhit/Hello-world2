**Verdict: conditional GO, but only for a 45-day test, not as a business you commit to. Confidence is low to moderate.**

The opportunity is a payer enrollment (insurance credentialing) service for newly opened outpatient physical, occupational and speech therapy practices with 1 to 3 providers. People clearly pay for this and the buyers can be found in public records. The open question is whether a brand-new solo founder can win clients when competitors already sell it for $99 per application.

## Segments compared

| Segment | Recurring pain | Can you reach buyers? | Competition / trust | 45-day cash? | Result |
|---|---|---|---|---|---|
| Small defense subcontractors (CMMC Level 1 cybersecurity compliance) | Real: annual self-assessments | Weak: I found no free public list with direct contacts | IT providers and certified consultants; buyers want credentials you don't have. Phase 2 reportedly suspended July 2026, which removes urgency (Unverified, secondary: [Red River](https://redriver.com/cybersecurity/cmmc-final-rule-what-changed-and-what-contractors-must-do); dodcio.defense.gov returned 403) | Unlikely | Lose |
| Small trucking carriers (federal filing admin) | Real: recurring federal filings (MCS-150 update every 2 years) | Excellent: public registry | Trust is broken. FMCSA has warned for years about third parties sending misleading paid-filing solicitations (Unverified, secondary: [CCJ](https://www.ccjdigital.com/be-wary-of-scams-seeking-payment-for-fmcsa-biennial-update-filing/); fmcsa.dot.gov returned 403). Cold outreach from you would look like a scam | Unlikely | Lose |
| Small nonprofits (grant research) | Real: 21% lost a government grant or contract in early 2025 (Unverified, secondary: [Chronicle of Philanthropy](https://www.philanthropy.com/news/a-third-of-u-s-nonprofits-that-serve-communities-lost-government-funding-in-early-2025/)) | Good | Many freelancers. Buyers have shrinking budgets and grants pay out over months | Poor | Lose |
| **New PT/OT/speech therapy practices (payer enrollment)** | Real and tied to deadlines (evidence below) | Good: about 123 new PT-taxonomy organization NPIs per month nationally | Crowded and commoditized, but the work is admin, not credential-gated | Plausible | **Wins** |

I also checked mental health therapists and dropped them. Headway says it credentials therapists for free and makes its money from insurer payouts (Unverified, vendor claim: [headway.co](https://headway.co/for-providers/insurance-credentialing)).

**Why it wins:** it is the only one of the four that passes every gate:
- a pain with a deadline attached
- a free public trigger list of new practices
- proven willingness to pay
- no license needed to do the work
- a clean reputation

## Evidence (all accessed 2026-11-23)

**The pain**
- **Verified:** Medicare lets PTs, OTs and speech pathologists bill retroactively only "up to thirty days prior to their effective date." Anything earlier is lost Medicare revenue. ([42 CFR 424.521](https://www.ecfr.gov/current/title-42/section-424.521))
- **Verified:** Medicare enrollment must be revalidated every 5 years, within 60 days of CMS's notice. ([42 CFR 424.515](https://www.ecfr.gov/current/title-42/section-424.515))
- **Verified:** Blue Cross Blue Shield of Michigan requires providers to re-attest their data every 120 days. Failing to do so means "being removed from our provider directory and may affect our ability to process claims." ([BCBSM](https://www.bcbsm.com/providers/help/provider-data-management-attestations/))
- **Unverified:** median enrollment takes 69 days ([Becker's](https://www.beckershospitalreview.com/cfo/payer-enrollment-takes-69-days-at-the-median-why-one-in-four-takes-97/), returned 403).

**Reaching buyers**
- **Verified:** I pulled the federal NPI registry API (the national provider ID database). New PT-taxonomy organization NPIs averaged about 123 per month from May to October 2026.
- That is a lower bound, because 14 states hit the API's result cap. It also includes hospitals and chains, which I did not filter out.
- Phone numbers are listed. Emails mostly are not, so you find them by hand on practice websites.

**Competitors' prices**
- **Verified (the vendor's own claim):** MedSole charges "$99 per payer application, charged only after the payer approves it," with revalidation included. ([medsolercm.com](https://medsolercm.com/blog/credentialing-cost))
- **Verified:** Medwave only gives custom quotes. ([medwave.io/pricing](https://medwave.io/pricing/))
- **Unverified:** a vendor blog puts the typical range at $100 to $300 per payer.

**Can a third party legally do the filing?**
- **Unverified:** a search summary of CMS documents says a third-party firm can act as a "surrogate" inside Medicare's enrollment system (PECOS) once the provider approves it. The provider still has to sign the application. ([CMS I&A guide](https://www.cms.gov/Regulations-and-guidance/Legislation/EHRIncentivePrograms/Downloads/IA_RefGuide.pdf))

**Cost to acquire a customer**
- Only your time. No ads.
- Per customer: contacts needed = 1 / (reply rate × close rate), at an estimated 10 minutes per contact.
  - 5% reply and 15% close: about 133 contacts, about 22 hours.
  - 2% reply and 10% close: about 500 contacts, about 83 hours.
- These rates are assumptions, not data.

## Federal email rules (CAN-SPAM)

- **Verified:** the FTC says "The law makes no exception for business-to-business email." ([FTC guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business))
- **Verified:** [15 U.S.C. 7704](https://www.law.cornell.edu/uscode/text/15/7704) requires:
  - accurate header and From information
  - a subject line that doesn't mislead
  - a clear statement that the email is an ad or solicitation
  - a working opt-out mechanism that stays active for at least 30 days
  - honoring opt-outs within 10 business days
  - a valid physical postal address
- **Verified:** collecting addresses with automated tools from sites that post a no-transfer notice counts as an "aggravated violation" under 7704(b). So collect email addresses by hand.
- **Verified:** the penalty is up to $53,088 per email ([16 CFR 1.98](https://www.ecfr.gov/current/title-16/section-1.98)).
- **Unverified:** phone calls fall under different rules (TCPA). Dial by hand, never use auto-dialers, and don't text.

## First-contact email

> **To:** info@stayinmotionpt.com
> **From:** [SENDER FULL NAME] <[SENDER EMAIL ON YOUR OWN DOMAIN]>
> **Subject:** Question about your in-network credentialing
>
> Hi Stay in Motion team,
>
> Your insurance page says you're temporarily cash-based while in-network credentialing is finalized. I run [BUSINESS NAME], a small service that handles payer enrollment paperwork and follow-up for new PT practices.
>
> One fact worth knowing: Medicare only lets PTs bill retroactively up to 30 days before their effective date (42 CFR 424.521). Every week a pending application sits idle can cost visits you can't bill in-network.
>
> Free offer: send me your list of pending payers. Within 2 business days I'll return a one-page status sheet showing what each application is waiting on and the next action for each. No charge, no obligation.
>
> If you want me to take the follow-up work off your plate after that, pricing is $250 setup plus $100 per payer application, invoiced when submitted. Optional upkeep (re-attestations, revalidation tracking) is $49 per provider per month.
>
> Worth a 15-minute call this week?
>
> [SENDER FULL NAME]
> [BUSINESS NAME] | [PHONE]
>
> *This is a business solicitation from [BUSINESS NAME]. If you'd rather not hear from me again, reply "unsubscribe" and I'll stop. [VALID PHYSICAL POSTAL ADDRESS OR USPS-REGISTERED PO BOX / PRIVATE MAILBOX]*

You must fill in every bracketed field before sending. Do not claim any experience or past clients you don't have.

## First prospect: publicly verifiable

**Stay in Motion PT PLLC, 30990 S Wixom Rd, Wixom, MI.**
- **Verified:** NPI 1629948872, registered 2025-11-11 (NPI registry API).
- **Verified:** its [insurance page](https://stay-in-motion.pages.dev/insurance) says "Temporarily cash-based while credentialing is finalized."
- **Verified:** its [contact page](https://stay-in-motion.pages.dev/contact) lists info@stayinmotionpt.com.
- **Caveats:** the page may be out of date, and they may already have a vendor or be nearly done. I have not contacted them, so there is no outreach result.

## Contribution per customer

Inputs are my estimates unless marked; I ran the model in code. The base case is 2 providers and 8 applications at about 3.5 hours each. Stripe's ACH fee of 0.8% capped at $5 is Verified ([stripe.com/pricing](https://stripe.com/pricing)).

| Scenario | Revenue | Contribution | Delivery hours | $/hr |
|---|---|---|---|---|
| Base: one-time enrollment | $1,050 | $1,012 | 34 | $29.75 |
| Same, including 22 hours of selling | | | 56 | **$18.00** |
| Year 1 with 12 months of upkeep | $2,226 | $2,178 | 80 incl. selling | $27.16 |
| Pessimistic: 6 hrs/application, no upkeep | $1,050 | $1,012 | 54 | $18.73 |
| Matching the $99 competitor, no setup fee | $792 | $756 | 34 | $22.23 |

**Fixed costs:**
- About $87 for 90 days (domain, e-fax, Google Workspace, all estimates).
- Errors-and-omissions insurance is unquoted; I assumed about $700 a year, which is a guess. Get a quote before you sign a first client.

**Capacity ceiling:** about 4.4 new clients a month, or roughly $4,500 a month in contribution. This is a cash and learning wedge, not a wealth engine. It only scales if you hire.

## Strongest evidence against

1. **Price is already commoditized.** A competitor offers $99 per application, charged only after approval, with revalidation included. You'd be a beginner charging more.
2. **Your hourly economics are worse than a normal job.** About $18 an hour fully loaded on the first sale.
3. **Little trust or expertise.** A mistake delays a clinic's revenue, and you have no track record.
4. **Not every new practice is a buyer.** Many cash-based clinics avoid insurance on purpose.
5. **Thin delivery.** One payer process change, or a free platform like Headway moving into PT, kills the edge.

**What would prove this wrong:** fewer than 2% positive replies, or prospects saying "we already use a vendor" or "we're cash-only."

## Cheap test and stop rule

- **Days 1–10 (under $100):**
  - Learn the CMS Medicare enrollment materials and the PECOS and CAQH steps.
  - Build a one-page status-sheet template.
  - Set up a domain and email address.
- **Days 8–30:**
  - Contact 150 PT/OT/speech practices registered in the last 90 days that publicly signal insurance intent.
  - For each: one email, one follow-up, and one hand-dialed call.
  - Log every result in a spreadsheet.
- **Success:**
  - By day 30: at least 6 positive replies (4%) and at least 3 free audits delivered.
  - By day 45: at least 1 paid invoice.
- **Stop rule:**
  - Fewer than 3 positive replies from 150 contacts by day 30: stop this segment.
  - 3 or more audits but 0 paid by day 45: change price or offer once, then stop for good at day 60 if still 0.
  - If the first client's applications take more than 6 hours each: stop, because the economics fail.

## Requirement check

All requirements are met except:
- **Partial:** the CMMC suspension, the FMCSA warnings and the 69-day median come from secondary sources only, because the primary pages returned 403.
- **Partial:** the NPI counts are lower bounds and include hospitals and chains.
- **Missing:** the errors-and-omissions insurance cost needs a real quote.

I can turn this into a shareable page if you want it.
