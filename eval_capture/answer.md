## Decision: inconclusive (confidence moderate)

**Pick:** payer-enrollment and CAQH upkeep for independent Iowa behavioral-health group practices that are adding clinicians. You never touch patient records. Of the three ideas, it's the only one that passes the legal, $1,000 and no-PHI constraints.

**Not a go yet.** I found no evidence that any specific practice will pay you. There are cheap incumbents ($99 per application, paid only after approval). And at full capacity it tops out around $30k-48k a year in gross revenue. That's a service job, not a wealth engine.

**Do now:** the 7-day test below (cost about $0-30). Hold off on the LLC, insurance and tooling until it passes.

---

## 1. The decision and the constraints

**Objective:** make the first paid sale of a nonclinical admin service to an independent US practice. You're solo, with $1,000 and 40 hours a week, no clinical credential, and no patient-record access in the pilot.

| Constraint | Credentialing / enrollment | Rate benchmarking (public price-transparency data) | Google profile and review management |
|---|---|---|---|
| No PHI in the pilot | Pass. It uses clinician data, not patient data (see §3) | Pass on public data, but it needs the practice's confidential contracted rates | Risky. Replying to reviews is where HHS has fined practices |
| $1,000 | Pass (about $270 to start, below) | Fail in practice. The files are huge and the data engineering is heavy | Pass |
| No license | No Iowa license found (Unverified: I didn't find one, which doesn't prove none exists) | None | None |
| First buyer reachable | Plausible (hiring signals are public) | Weak. Small practices have little leverage to renegotiate rates | Easy to reach, low willingness to pay |
| Incumbents | Crowded, but price-transparent | Turquoise Health and others sell to hospitals and health systems | Saturated |
| **Verdict** | **Most feasible** | Reject | Reject |

**Do nothing:** a valid choice. It costs nothing, but you learn nothing.

**Cheaper option:** the 7-day test, which is just interviews and costs no build.

## 2. Evidence

**Market pain**
- **Verified.** MGMA Stat poll of Nov. 4, 2025 (131 responses):
  - 65% of medical groups say their provider files are on time.
  - 32% report a backlog, a CVO delay, or a slip into Q1.
  - Causes: payer enrollment delays, thin staffing, and slow third-party vendors.
  - Source: [mgma.com](https://www.mgma.com/mgma-stat/confronting-credentialing-reappointment-crunch-time)
  - **Contrary reading:** most groups are *not* in pain.
- **Unverified (search snippet only):** Medallion's 2025 vendor survey says 33% of organizations see 30-45 day delays and 18% see 60+ days. Medallion sells credentialing, so it has a commercial interest. ([prnewswire](https://prnewswire.com/news-releases/slow-credentialing-and-enrollment-are-draining-revenueand-most-healthcare-teams-arent-tracking-the-loss-according-to-medallion-report-302352239.html))

**Incumbent pricing**
- **Verified (vendor blogs, not quotes):**
  - Carepatron puts the typical outsourced price at "$100 to $300 per payer per provider" and maintenance at "$100 to $500 per provider per month". It notes these are "not quotes" and that it has a commercial interest. ([carepatron](https://www.carepatron.com/blog/how-much-does-credentialing-cost), Jul 2026)
  - MedSole charges "$99 per payer application, only after the payer approves it," with "no monthly fee". ([medsolercm](https://medsolercm.com/blog/credentialing-cost), Oct 2026)
- **Unverified (search snippet):** Talkspace handles credentialing for its contract therapists. Platforms like this remove solo therapists as buyers, which is why the target is group practices that bill under their own tax ID.

## 3. Privacy and contracting gates

- **Clinician data isn't patient data.** Verified: 45 CFR 160.103 (Cornell LII) makes someone a business associate only when their service "involves the disclosure of protected health information." PHI also excludes "employment records held by a covered entity in its role as employer." So credentialing a practice's own clinicians doesn't require a BAA, as long as no patient data ever reaches you. ([law.cornell.edu](https://www.law.cornell.edu/cfr/text/45/160.103))
- **You'd still hold sensitive data.** Verified: Iowa Code 715C (2026) counts name plus Social Security number, or name plus driver's license number, as "personal information." Anyone who "maintains or otherwise possesses" that data for someone else must notify the owner "immediately" after a breach. Clinician SSNs put you under this law. ([legis.iowa.gov 715C.pdf](https://www.legis.iowa.gov/docs/code/715C.pdf))
- **Medicare access has a defined route for consultants.** Verified: the Noridian page (updated Oct 13, 2026) says:
  - Surrogacy connections are "frequently used by... credentialing specialists."
  - Surrogacy "must be requested and approved before access is granted."
  - A role "does not automatically grant authority to sign, certify, or submit."
  - Source: [noridian](https://med.noridianmedicare.com/en/web/jfb/enrollment/medicare-provider-enrollment-systems)
- **CAQH:** Unverified (search snippets of CAQH guides). The provider must re-attest every 120 days, and only the provider authorizes which plans can see the profile. A practice manager can enter shared data but can't attest for the clinician.
- **Review-response risk (for the rejected option):** Unverified (HHS snippet, page not opened). Manasa Health Center paid $30,000 in 2023 over review replies that disclosed patients' diagnoses.

## 4. Pilot workflow: what reaches you, and where access is blocked or reviewed

| # | Step | What reaches you | Gate |
|---|---|---|---|
| 0 | Sign a services agreement plus a data addendum: "no patient information will be shared"; the practice owns storage; you delete everything at the end | Nothing yet | **Review:** practice owner signs. If they insist on a BAA, stop and decide deliberately, because a BAA means accepting PHI duties |
| 1 | Practice shares roster data in a folder *the practice owns* (its own Drive or OneDrive, with 2-factor login) | Clinician names, NPIs, license numbers and expirations, taxonomy codes, group NPI and tax ID, office addresses, current payer list | None. This is business data |
| 2 | Each clinician uploads their own documents to that folder | SSN, DOB, home address, malpractice certificate, diploma, CV | **Blocked:** email and text. Iowa 715C applies. You view the files and never download them |
| 3 | CAQH profile | You prepare data, through the Practice Manager module if granted | **Blocked:** attestation and plan authorization. Only the clinician can do these |
| 4 | Medicare (PECOS) through CMS Identity & Access | You create your own account and request surrogacy | **Review:** the practice's Authorized Official approves. **Blocked:** you can't sign or certify |
| 5 | Commercial and Medicaid plan portals | Enrollment-only role | **Blocked:** claims, eligibility and remittance roles. If a portal can't separate roles, practice staff submits and you only prepare the packet |
| 6 | Submission | Application or reference numbers | **Review:** clinician or authorized official signs each application |
| 7 | Follow-up calls to plan enrollment lines | Status and effective dates | Use reference numbers only, never patient data |
| 8 | Status tracker (sheet the practice owns) | Clinician, plan, submitted date, reference #, effective date | No PHI fields allowed |
| 9 | Handoff | Effective dates go to the practice's billing staff | **Blocked:** you never see claims or denials. If patient data reaches you anyway, delete it, notify the practice in writing, and log it |
| 10 | Offboarding | Nothing | Access revoked, files deleted, written confirmation sent |

**Deliberately out of scope:** analyzing credentialing-related claim denials. That needs claims data, which is PHI, so it waits until after the pilot.

## 5. First prospect (evidence of reachability, not demand)

**Green Counseling Services, PLLC**
- **Who they are:** Iowa behavioral-health group. Verified on [their site](https://shallot-chartreuse-tpkc.squarespace.com/our-locations): 8 Iowa offices, including the Iowa City office at 1700 South 1st Ave, Ste 21/23/25. Phone 319-800-5564.
- **Buyer role:** Verified on [their staff page](https://shallot-chartreuse-tpkc.squarespace.com/administrative-staff): Doug Green, "Practice Manager, Chief Financial Officer". Secondary contact: Austin Green, COO.
- **Signal:** Verified on [their job post](https://shallot-chartreuse-tpkc.squarespace.com/iowacitytherapistposition): they're recruiting therapists for an "expanding team in Iowa City" on a W2 model and will consider provisional licenses. Every new hire needs payer enrollment.
- **Counter-signal:** they list 10 executive and operations staff, so credentialing is probably already in-house. There's no evidence they want to buy.
- **Unresolved:** the job post's email domain (greencounselingservice.com) differs from a Tulsa, Oklahoma practice at greencounselingservices.com. Confirm by phone before emailing.

## 6. First-customer economics

All inputs are estimates; I ran the math in code.

- **Startup cost:** about $270 (LLC about $50 [Iowa fee unverified], domain and email $40, password manager and storage $30, insurance for 3 months about $150 [estimate]). That leaves about $730.
- **Pilot:** 2 clinicians × 4 plans = 8 applications, plus 3 months of CAQH upkeep at $75 per clinician per month.

| Price per application | 3 hrs per application | 5 hrs | 8 hrs |
|---|---|---|---|
| $99 | $1,242 → $34/hr | $24/hr | $16/hr |
| $150 | $1,650 → $46/hr | $32/hr | $22/hr |
| $250 | $2,450 → $68/hr | $47/hr | $32/hr |

**Cash timing:** if you match MedSole's pay-on-approval model, cash arrives 60-120 days late. Take a 50% deposit instead ($600 on this pilot).

**Ceiling:** with half your time spent selling, capacity is 192-320 applications a year, about $29k-48k gross at $150. Getting meaningfully past that requires recurring maintenance revenue (100 clinicians × $75 × 12 = $90k a year) and hiring.

**Sensitivity:** the result flips on hours per application. Above about 8 hours, or below $150, the work pays less than a part-time job.

## 7. Contrary evidence

1. 65% of groups report being on time (MGMA), so pain is a minority condition.
2. A $99 pay-on-approval competitor already exists, and therapist platforms credential clinicians for free.
3. A stranger asking for clinicians' SSNs with no references is a real trust barrier.
4. The prospect likely staffs this work internally.
5. The income ceiling is low compared with your stated wealth goals.

**What would overturn "inconclusive":** in the test below, 3 or more decision-makers describing 60+ day enrollment delays that cost them revenue, plus 1 who pays a deposit, would make it a go. Fewer than 2 real conversations from 30 contacts would make it a no-go.

## 8. Seven-day test (about $0-30)

- **Day 1:** Write a one-page offer: "New-hire payer enrollment for Iowa group practices, $150 per application, 50% deposit, no patient data." Build the intake checklist and tracker in a free Google Sheet.
- **Day 2:** List 30 Iowa independent behavioral-health groups with 3-15 clinicians that are posting therapist jobs (Indeed, Psychology Today). Note the practice-manager or owner name for each.
- **Days 3-5:** Call and email all 30. Start with Green Counseling (319-800-5564; ask for Doug Green). Ask:
  1. How many clinicians did you add in the last 12 months?
  2. Who handles enrollment today?
  3. How many days from hire to first in-network claim?
  4. What does a delay cost you?
  5. Would you pay $150 per application for a 2-clinician pilot?
- **Days 6-7:** Score the results.
  - **Go:** at least 5 decision-maker conversations, at least 3 reporting 60+ day delays, and at least 1 deposit or signed price letter.
  - **No-go:** none of them willing to pay $150, or fewer than 2 conversations.
  - Stop at day 7 either way.

**Bottom line: inconclusive.** Run the test. Spend nothing beyond it until a practice pays a deposit.

---

**Requirements check**
- **Met:** R1 (scope respected), R2 (three options compared in §1, one chosen), R3 (sources dated to 2025-2026, with page dates noted), R4 (prospect and buyer role in §5, with no demand claimed), R5 (§2, §3, §6), R6 (workflow in §4), R7 (§7, §8, decision).
- **Partial:**
  - The Iowa LLC fee, insurance cost, the CAQH 120-day rule, and the HHS review settlement are unverified because their pages blocked access or I saw only search snippets.
  - "No Iowa license needed" rests on not finding one, not on a source saying so.
  - A second, smaller Iowa prospect (Counseling and Health Center, Iowa City) couldn't be checked: its job post was removed (410) and its site blocked access (403).

I can turn this into a shareable page if you want.
