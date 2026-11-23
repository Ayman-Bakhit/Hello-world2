# Can you legally broker this first load within 30 days?

**Decision: no-go on getting your own broker authority in time for this load. Confidence is moderately high.** Your own authority clears the 30-day window only if everything goes perfectly, and $1,000 covers the bond only if a surety quotes you under about 0.93%. I haven't seen a quote, but I'd expect a first-year solo broker to be priced above that. There's a **conditional go** on a different path: work the load as an agent of a broker that's already licensed. Its legality turns on the contract terms, which I couldn't verify against an official source.

## The two online pitches are both wrong

- **"$300 is all it costs."** Misleading. $300 is only the application fee. The official fee table says: "application for … property broker authority … $300" ([49 CFR 360.3T(f)(1), LII mirror](https://www.law.cornell.edu/cfr/text/49/360.3T), Verified). You also need $75,000 of financial security on file before you can operate.
- **"Every broker must deposit $75,000 in cash."** False. The rule requires "a surety bond or trust fund of $75,000" ([49 CFR 387.307, LII](https://www.law.cornell.edu/cfr/text/49/387.307), Verified). The bond (form BMC-84) needs no cash deposit, only an annual premium. Cash is only required if you choose a trust (form BMC-85).

## Requirements in effect on Nov 23, 2026

| Requirement | What applies | Label |
|---|---|---|
| Authority | Register as a property broker under 49 U.S.C. 13904. FMCSA's notice says brokers must "complete their registration transactions with FMCSA using Motus." First-time applicants apply for a USDOT number and authority there. ([FR 2026-08334, Apr 29, 2026](https://www.govinfo.gov/content/pkg/FR-2026-04-29/html/2026-08334.htm)) | Verified |
| Identity check (2026 change) | "all new applicants will be required to pass identity proofing and verification" (same notice) | Verified |
| Review time (2026 change) | "a minimum timeframe of eight business days for the initial review," and longer if an application is "flagged for further investigation or vetting" (same notice) | Verified |
| MC numbers | Phase II "will not include … the elimination of MC/FF numbers" (same notice). I didn't confirm the status after April. | Verified as of April 2026 |
| Did Motus Phase II actually launch? | Secondary sources say May 14 or May 19, 2026. FMCSA's own pages returned an access error. | Unverified |
| Protest period | Anyone can protest "within 10 days after notice of the application appears in the FMCSA Register" ([365.203T](https://www.law.cornell.edu/cfr/text/49/part-365)) | Verified |
| Deadline to file bond and process agent | 365.109T says "within 20 days" of publication. The suspended non-T version says 90 days. I couldn't open eCFR or FMCSA to confirm which one FMCSA applies under Motus. Either way, file immediately. | Contradicted |
| Financial security | $75,000 by bond (BMC-84) or trust (BMC-85). A trust may hold only "cash, irrevocable letters of credit … and Treasury bonds" that can be liquidated within 7 calendar days ([387.307](https://www.law.cornell.edu/cfr/text/49/387.307)) | Verified |
| 2026 financial-responsibility change | All provisions of the 2023 rule became mandatory **Jan 16, 2026** ([89 FR 107021, Dec 31, 2024](https://www.govinfo.gov/content/pkg/FR-2024-12-31/pdf/2024-30509.pdf), which I read myself). Brokers whose security drops below $75k now face suspension "within 7 business days of service of the notice." Loan and finance companies can no longer serve as trustees ([88 FR 78656](https://www.govinfo.gov/content/pkg/FR-2023-11-16/html/2023-25312.htm)). | Verified |
| July 21, 2026 amendment | 387.307 lists a further amendment at 91 FR 45661. I couldn't open it, so I don't know what it changed. | Unverified (open gap) |
| Process agent (BOC-3) | Brokers must designate an agent "for each State in which its offices are located or in which contracts will be written," on Form BOC-3 ([366.4T](https://www.law.cornell.edu/cfr/text/49/366.4T), [366.2T](https://www.law.cornell.edu/cfr/text/49/366.2T)). The BOC-3 fee is $0. Whether you can name yourself as agent comes only from a search snippet of FMCSA's broker page, which blocked me. | Rule verified; self-filing unverified |

## Timing gate (calculated in code)

The window runs from Nov 23 to **Dec 23, 2026**. Thanksgiving (Nov 26) is excluded as a business day. The 8-day minimum review is sourced; the slower scenarios are my assumptions.

| Scenario | Published | Protest ends | Authority active | Slack |
|---|---|---|---|---|
| Best case: apply Nov 24, minimum review | Dec 8 | Dec 18 | ~Dec 21 | **+2 days** |
| Review takes 10 more business days | Dec 24 | Jan 3 | ~Jan 7 | −15 days |
| Application flagged for vetting | Jan 12 | Jan 22 | ~Jan 29 | −37 days |

The best case also assumes the bond is underwritten and filed before Dec 18. **The timing gate effectively fails.**

## Funding gate (calculated in code)

- $1,000 − $300 fee = **$700 left**.
- A trust (BMC-85) needs $75,000 + $300 = $75,300. You're **$74,300 short. Dead.**
- With a bond (BMC-84), the highest premium you can afford is $700 / $75,000 = **0.93%**. If a blanket process agent costs ~$100 (my estimate), the ceiling is 0.80%.
- Illustrative premium rates, not quotes: 1% = $750, 3% = $2,250, 5% = $3,750. Anything at or above 1% breaks $1,000.
- Payback at an assumed $250 net margin per load: a $2,250 premium takes ~9 loads. **One load doesn't cover the bond.**

---

## Email requesting the information needed for a comparable surety quote

> **Subject:** BMC-84 ($75,000) freight broker bond: quote requirements for a new applicant
>
> Hello,
>
> I'm a first-time applicant for FMCSA property broker authority through Motus and would like a quote for a $75,000 BMC-84 surety bond. Before I submit personal information, could you tell me:
>
> 1. What you need to underwrite: credit check type (soft or hard pull), personal and business financial statements, résumé or industry experience, entity documents.
> 2. Your annual premium rate or range for an applicant with no broker history and a credit score of [XXX]. Can you also quote at the 650, 700 and 750 credit tiers so I can compare sureties?
> 3. Whether collateral or an indemnity agreement is required, and how much.
> 4. Whether you offer payment plans, and the minimum amount due at binding.
> 5. How long underwriting takes, and how many business days until the BMC-84 is filed electronically with FMCSA.
> 6. Your cancellation terms and claim-handling process under the January 2026 financial responsibility rules.
>
> Business: [Legal name / entity type / state]. Owner: [Name]. USDOT number: application pending. Bond needed by: [date].
>
> Thank you,
> [Name], [phone]

Send it to at least 3 sureties so you can compare. Don't email your SSN; give it only through their secure application.

---

## Counterarguments and alternatives

- **Strongest case for "go":** if FMCSA finishes review in the 8-business-day minimum, your credit earns a premium under 0.93%, and the customer's load date slips past Dec 21, it works. That's three independent things that all have to break your way.
- **Do nothing:** costs $0. You lose this load and the customer relationship.
- **Agent under a licensed broker (cheapest viable path):** the licensed broker holds the authority, the bond, and the customer and carrier contracts, and you earn a commission split. This is common in the industry, but I didn't verify its legal boundaries from an official source. Arranging transportation for pay without registration is the risk, so the host broker must be the contracting and invoicing party. Your cost is about $0, and you can start immediately once onboarded.
- **Hybrid:** run this load as an agent and apply for your own authority in parallel once your cash covers a real quote.
- **Demand is unproven:** "could offer a load" is not a commitment. Get the lane, date, and rate in writing.

**What would overturn this:** a written bond quote at or below ~0.9% with no collateral, plus evidence that Motus is approving brokers in about 2 weeks right now. Either one alone isn't enough.

## Cheapest next verification step

**Today, at $0:** send the email above to 3 sureties. Also ask the customer for the actual pickup date and lane. Stop the own-authority path if every quote's amount due at binding is over $700, or if the load picks up before ~Dec 21. Then email 2–3 licensed brokers that run agent programs and ask for their commission split and agent agreement.

## Requirements check

- Met: authority, financial responsibility, process agent, timelines, 2026 changes, funding and timing gates without an invented quote, mid-response email, decision, cheapest next step.
- **Partial: official sources.** fmcsa.dot.gov and eCFR blocked automated access, so CFR text comes from Cornell's LII mirror and the FR text from govinfo. The shell download attempt was also denied, and I didn't work around it.
- **Partial:** I couldn't read the July 21, 2026 amendment to 387.307, so I don't know what it changed. The 20-vs-90-day filing deadline and whether you can file your own BOC-3 are unconfirmed. Before filing, check the FMCSA broker page and Motus yourself in a browser.

Update on the one open gap. I found the July 21, 2026 Federal Register table of contents. The amendment at 91 FR 45661 sits inside an FMCSA rule called **"General Technical, Organizational, Conforming, and Correcting Amendments to the Federal Motor Carrier Safety Regulations"** (pages 45653–45662). Source: [FR Vol. 91 No. 138 front matter, p. IV](https://www.govinfo.gov/content/pkg/FR-2026-07-21/pdf/FR-2026-07-21-FrontMatter.pdf).

- **Verified:** it's a technical and conforming cleanup rule, not a new financial-responsibility rulemaking.
- **Unverified:** what exactly it changed in 49 CFR 387.307. I couldn't open the rule text itself.

So it's unlikely to have changed the $75,000 requirement or the January 2026 suspension rules, but I haven't confirmed that. **The decision stands:** no-go on getting your own authority in time for this load. The conditional go is acting as an agent of a broker that's already licensed. The cheapest next step is still $0: send the surety email to 3 sureties and get the customer's actual pickup date.

Before you file, read pages 45653–45662 of the July 21, 2026 Federal Register on govinfo.gov or federalregister.gov in a normal browser and check the 387.307 change.
