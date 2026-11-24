# Nonclinical Admin Opportunity for Independent Practices (as of Nov 23, 2026)

**Bottom line:** Of three options, **Medicare/CAQH enrollment upkeep (revalidation + re-attestation) for small independent groups** is the most feasible under the constraints. The business case is still **INCONCLUSIVE**. Spend nothing beyond about $150 until the 7-day test at the end clears its threshold. Confidence it is the best of the three: moderate-high. Confidence it becomes a meaningful income stream: low-moderate, because the work is commoditized and the wedge task is small.

Evidence labels: **[V]** = I opened the primary source or queried the dataset in this session. **[U]** = unverified (search summary, secondary source, memory, or a page my tools could not open). **[E]** = my estimate or scenario input.

---

## 1. Decision and constraints

- **Decision:** Which narrow nonclinical admin service, if any, a solo founder should pilot with one independent U.S. practice.
- **Success for the pilot:** One paid engagement completed with no PHI touched, and a repeatable offer that 15 cold contacts can understand.
- **Binding constraints:** $1,000 cash. 40 hrs/week. No clinical credential. **No access to patient records in pilot 1.** Solo.
- **Rule this imposes:** Any option that needs claims, EOBs, charts, schedules or patient lists fails. That removes billing, denials, prior auth, coding and no-show work.

## 2. Three alternatives, plus doing nothing

| Criterion | **A. Enrollment upkeep** (Medicare revalidation, CAQH re-attestation, roster changes) | **B. Website accessibility** (HHS Sec. 504, WCAG 2.1 AA) | **C. Listings / review management** |
|---|---|---|---|
| Pain | Real. Missing a revalidation can lead to a payment hold or deactivation [U: cms.gov search summary]. Vendor surveys report credentialing delays and revenue loss [U: Medallion/MGMA summaries]. | Weak near term. The 504 web deadline moved to **May 11, 2027 (15+ employees)** and **May 10, 2028 (<15 employees)** [U: law-firm alerts; the Federal Register page blocked my fetcher]. Enforcement appetite is reportedly falling [U]. | Moderate. Nice to have, not a compliance trigger. |
| Evidence buyers pay | Vendors charge about $100-300 per payer and $100-500 per provider per month for maintenance [U: vendor blogs, not quotes]. | Overlays are cheap. The FTC's 2025 accessiBe order undercuts "instant compliance" claims [U: ftc.gov summary]. Small practices rarely budget for audits [E]. | Low. It comes bundled in Weave, Birdeye and Podium-type tools [U]. |
| No-PHI feasibility | **Yes.** It uses provider data, not patient data. Provider SSN and DOB are sensitive PII. | **Best.** The work uses only the public website. | **Risky.** Replying to patient reviews can disclose PHI [U: memory of OCR enforcement]. |
| Delivery control | CMS has a sanctioned third-party path (surrogacy). The practice keeps signing authority [V]. | Usually blocked by the website vendor's CMS. The founder can audit but often cannot fix. | Needs Google login access. Easy. |
| Skill ramp | 2-4 weeks of learning PECOS, CAQH and the MAC's process [E]. | 4-8 weeks for credible manual WCAG testing [E]. | Days. |
| Incumbents | Heavy: billing companies, credentialing freelancers, Medallion, Modio, CAQH itself. | Agencies, overlays, the site vendors themselves. | Saturated. |
| Verdict | **Select (conditional)** | Reject for now: wrong timing for small independents. Revisit early 2027 for 15+ employee groups that take Medicaid. | Reject: commodity work with PHI risk. |

**D. Do nothing / cheaper path:** Take a paid part-time role at a billing or credentialing firm, or do one Upwork credentialing gig, to learn on someone else's risk. This is the honest benchmark. If the 7-day test fails, do this or nothing.

## 3. First prospective practice (real, reachable; no claim of interest)

**Amana Family Practice Clinic, PC**, 505 39th Ave, Amana, IA 52203. Phone (319) 622-3231. About 20 miles from Iowa City.
- **Medicare group revalidation due date: 02/28/2027.** Group Enrollment ID O20040401001334. 3 reassigned practitioners (2 Family Practice, 1 Registered Dietitian). Individual due dates are "TBD" [V: CMS Revalidation Reassignment List, Nov 2026 release, queried 2026-11-24].
- NPPES organization NPI 1073677019, Family Medicine, record last updated 2025-11-18 [V: NPPES API].
- Likely independent: the UIHC directory labels its physician "Independent Provider... not employees or agents of University of Iowa Health Care" [V: uihc.org provider page]. Its own Medicare group enrollment as a PC also points that way. Ownership is **not confirmed**: the clinic website returned HTTP 503. **Verify this on the first call.**
- **Buyer roles:** The **office/practice manager** is the first contact. They feel the paperwork. The **physician-owner** is the decision-maker and almost certainly the Medicare Authorized Official. Only they can approve surrogate access and e-sign.
- **What CMS dates mean:** CMS posts the next 6-7 months of due dates. "TBD" means no date has been set yet [V: CMS methodology PDF]. A listed future date shows a real upcoming obligation. It does **not** show the practice lacks someone to handle it. Their biller may already do this.
- **Backup prospect:** Corridor Ketamine LLC, 1900 James St Ste 1, Coralville. Group due 03/31/2027, 9 reassigned NPs/CRNAs [V: same dataset + NPPES].
- **Prospect pool:** In Iowa, **62 small groups (1-15 reassignments)** have future-dated revalidation deadlines from Nov 2026 to Apr 2027 [V: my query of the CMS list]. Caveat: 1,281 Iowa groups show *past* due dates. The methodology does not explain those, so I do not treat past dates as overdue. **Verify this.**

## 4. Pilot workflow: what information flows, and where access is blocked or reviewed

Scope of pilot 1: one group's Medicare revalidation (group + reassignments) plus a CAQH re-attestation check. Commercial payer enrollment is out of scope.

| Step | Action | Info the founder receives | Gate: blocked / reviewed |
|---|---|---|---|
| 0 | Pull the public CMS revalidation list and NPPES record | Group legal name, enrollment IDs, NPIs, practitioner names and specialties, due date. All public. | None. Public data. |
| 1 | Call or visit the office manager with a one-page "your revalidation is due 2/28/2027" note | Nothing new | **Review:** the manager decides whether to escalate to the owner. |
| 2 | 20-minute discovery: who handles enrollment now (biller? in-house?), CAQH status, recent provider changes | Verbal answers only | **Stop** if a biller already handles it and they are happy. |
| 3 | Sign a fixed-fee engagement letter with a confidentiality clause and a **"no PHI" clause**: the practice must not send patient data, and the founder deletes and reports anything received by mistake | Signed letter | **Review:** the owner signs. If they insist on a BAA, pause and assess. A BAA means the practice intends to share PHI, which breaks the pilot constraint. |
| 4 | Founder creates their own CMS I&A account as a third-party organization (free; needs an EIN, free from the IRS). The practice's Authorized/Delegated Official **approves a surrogacy connection**. | Access to the group's PECOS enrollment record | **Blocked:** login sharing. The I&A page says "Sharing of login information is strictly prohibited!" [V]. **Blocked:** a surrogate "can't represent the practice, manage staff, sign enrollment applications, or initiate or accept connections" [V: CMS MLN9658742]. |
| 5 | Review the PECOS record: practice locations, reassignments, Authorized Official, specialty, and banking (EFT) section | Provider PII (SSN, DOB, license numbers may be prefilled), practice EFT details | **Minimize:** take nothing off-platform. Never store SSNs or bank data locally. **Founder never edits EFT.** The practice confirms bank details itself. |
| 6 | Prepare the revalidation in PECOS. Collect changes from the manager on a worksheet with no SSNs. | Practice-confirmed updates | **Review:** PECOS sends an e-signature request to the Authorized or Delegated Official's email [V: CMS PECOS 101, Nov 2026]. The application is incomplete until every signature is in [V]. |
| 7 | Track MAC processing and development requests in PECOS. Draft responses for the practice to approve. | Status notices | **Review:** the practice approves anything sent. |
| 8 | CAQH: the practice's CAQH Practice Manager admin adds the founder as a user [V: CAQH allows a practice to add multiple users]. Check every provider's attestation date (every four months [V]). | Provider profile data | **Blocked:** using a provider's own login. **Reviewed:** providers authorize which organizations can see their data [V]. Whether a practice-manager user may attest on a provider's behalf is **unverified**. Assume the provider attests. |
| 9 | Close out: confirmation screenshot, calendar of next due dates, offer a monthly retainer | Nothing new | Revoke surrogacy if no retainer. |
| ✗ | Never in pilot: claims, remits/EOBs, EHR, schedules, patient lists | n/a | Refuse. Founder systems are not set up for PHI. |

Privacy note: The data used here is provider and business data. It is not PHI under HIPAA, which covers health information about individual patients [U: my reading of 45 CFR 160.103]. SSNs are still covered by Iowa's data-breach law (Iowa Code ch. 715C) [U: memory]. Use a password manager, 2FA everywhere, and no local copies.

## 5. Licensing and contracting gates

- **Clinical license:** none needed. This is administrative work.
- **State business license for credentialing:** none found. I checked only the index of Iowa Code Title XIII (insurance). The ch. 510 third-party-administrator license appears aimed at administering insurance plans, not provider enrollment [U: section text not read]. **Verify with a 15-minute call to the Iowa Insurance Division before charging recurring fees.**
- **CMS:** the surrogacy path is sanctioned. The founder can never sign or represent the practice [V].
- **Practice-side asks:** a W-9, possibly proof of E&O insurance, and possibly a BAA (see step 3).
- **E&O insurance:** cost is unknown. I estimate $500-1,500 per year [E]. That would consume 50-150% of the budget, so get a quote but don't bind it before a paying client asks for it.

## 6. First-customer economics (run in `econ.py`; inputs labeled)

| Item | Value | Label |
|---|---|---|
| Startup cash for test + pilot (optional LLC $50, Workspace $14, password manager $40, mileage $112) | **$216** | E |
| Pilot fixed fee: Medicare group revalidation + CAQH check | $250, payable on submission | E (below the $100-300/payer vendor range [U]) |
| First-timer hours | 10 | E |
| Effective rate | **$25/hr gross** | calc |
| Retainer at $150/provider/mo × 3 providers | $450/mo per practice. ~8.9 practices for $4,000/mo gross | calc on E |
| Retainer at $75/provider/mo | ~17.8 practices for $4,000/mo | calc |
| Solo capacity at 1.5 hrs per provider-month | ~115 provider-months, ~$17.3k/mo gross ceiling at $150 | calc on E |
| New-provider enrollment upsell (6 payers × $100-300) | $600-1,800 one-time | calc on U |
| E&O at $500-1,500/yr | equals 2-6 pilot fees | calc on E |

Cash timing is favorable: fixed fee, no inventory, paid within weeks. **The flip variable is willingness to pay for upkeep.** Practices that already have a biller doing this pay $0 extra. If more than about 80% of contacts say "our biller handles it," the wedge dies.

## 7. Contrary evidence (strongest first)

1. **The wedge task is small and free to do in-house.** Physician groups pay no Medicare application fee [V: MLN9658742]. An office manager can revalidate in PECOS themselves. A $250 fee for a once-every-5-years task is a thin hook.
2. **Bundling kills standalone pricing.** At least one RCM vendor advertises credentialing included at $99 per clinician per month [U: Carepatron help page summary]. Billing companies routinely throw it in.
3. **Trust gap.** A student with no track record asking for surrogate access to a practice's Medicare enrollment is a hard first ask. One error (a missed reassignment) can cause a payment hold [U].
4. **The data is weaker than it looks.** 45% of listed Iowa groups show past due dates I can't interpret. A future due date shows an obligation, not unmet need.
5. **Low ceiling.** This is a labor-bound services business (~$17k/mo gross at full solo capacity [E]). It is not equity-scale wealth unless it becomes software or a team.
6. **Survey evidence is vendor-sourced.** Medallion and HealthStream sell credentialing software, so their pain statistics are not neutral [U].

**What would overturn "select A":** 15 contacts with zero paid acceptances, or a finding that surrogates can't view the records needed. That would make A no-go. B would only come back with a confirmed Medicaid-accepting 15+ employee practice facing the May 2027 deadline.

## 8. Seven-day test (cost ≤ $150)

| Day | Action | Output |
|---|---|---|
| 1 | Read CMS PECOS 101 (Nov 2026) and MLN9658742. Create your own I&A account. Get a free EIN. | Can explain surrogacy in 2 sentences |
| 1 | Filter the 62 Iowa small groups to those within about 60 miles of Iowa City (NPPES city lookup). Build a call sheet. | 15+ targets |
| 2 | Call Amana Family Practice: "I saw on CMS's public list that your group's Medicare revalidation is due Feb 28. Who handles that for you?" Ask the 4 questions below. | Notes |
| 2-5 | Same script with 14 more groups. Visit 2-3 nearby in person with the one-pager. | 15 conversations logged |
| 5 | 15-minute call to the Iowa Insurance Division on whether ch. 510 applies. Get one E&O quote (don't buy). | Licensing answer, quote |
| 6-7 | Offer a $250 fixed fee, payable on submission, to every "maybe." | Signed letters |

**Questions:** (1) Who handles revalidation/CAQH now, and is that internal or a biller? (2) When did a provider last get a payment hold, denial or delay from an enrollment issue? (3) Are any new providers joining in the next 6 months? (4) Would you pay $250 for done-for-you revalidation where you approve and sign everything?

**Thresholds:**
- **GO** (proceed to the pilot): at least 1 signed paid engagement, and at least 3 of 15 decision-makers confirming no one owns this work.
- **NO-GO:** 0 paid and at least 12 of 15 say the biller or in-house staff has it. Stop and take path D.
- **INCONCLUSIVE:** in between. Run one more week aimed at groups adding providers.

## 9. Decision

**INCONCLUSIVE. Select A as the most feasible option, but do not commit the $1,000.** A passes every hard constraint: no PHI, no license found, under $250 to start, and a sanctioned access path. Demand at a price that pays more than about $25/hr is unproven. The 7-day test decides it. B and C are rejected under current facts.

---

### Sources (accessed Nov 23-24, 2026)
- [V] CMS Revalidation Reassignment List, Nov 2026 release (API): https://data.cms.gov/data-api/v1/dataset/20f51cff-4137-4f3a-b6b7-bfc9ad57983b/data
- [V] CMS Revalidation Due Date List Methodology: https://data.cms.gov/sites/default/files/2020-08/Revalidation_Due_Date_Methodology.pdf
- [V] CMS PECOS 101, National Provider Enrollment Conference, Nov 18-19, 2026: https://www.cms.gov/files/document/2026-cms-npec-pecos-101.pdf
- [V] CMS MLN9658742, Medicare Provider Enrollment (fee exemptions, surrogate limits): https://www.cms.gov/Outreach-and-Education/Medicare-Learning-Network-MLN/MLNProducts/EnrollmentResources/provider-resources/provider-enrolment/Med-Prov-Enroll-MLN9658742.html
- [V] CMS I&A login terms: https://nppes.cms.hhs.gov/IAWeb/
- [V] NPPES NPI Registry API: https://npiregistry.cms.hhs.gov/api/?version=2.1
- [V] CAQH ProView Practice Manager login and help pages: https://proview.caqh.org/Login?Type=PM ; https://proview.caqh.org/PM/Registration/Help ; https://proview.caqh.org/PR/Registration/Help
- [V] UIHC independent provider listing: https://uihc.org/providers/timothy-momany
- [U] Missed revalidation consequences (cms.gov search summary): https://www.cms.gov/Medicare/Provider-Enrollment-and-Certification/MedicareProviderSupEnroll/Downloads/Reval_Cycle2_FAQs.pdf
- [U] HHS 504 web deadline extension: https://www.duanemorris.com/alerts/health_human_services_follows_department_justices_lead_extends_section_504_web_mobile_0526.html ; https://leadingage.org/web-accessibility-compliance-date-delayed-under-hhs-section-504-regulations/ ; Federal Register 2026-09266 (blocked to my fetcher): https://www.federalregister.gov/documents/2026/05/11/2026-09266/extension-of-compliance-dates-for-nondiscrimination-on-the-basis-of-disability-accessibility-of-web
- [U] FTC accessiBe final order (Apr 2025): https://ftc.gov/news-events/news/press-releases/2025/04/ftc-approves-final-order-requiring-accessibe-pay-1-million
- [U] Credentialing pain surveys: https://www.medallion.co/resources/guides/the-2025-state-of-payer-enrollment-and-credentialing ; https://www.mgma.com/mgma-stat/confronting-credentialing-reappointment-crunch-time
- [U] Pricing ranges (vendor blogs): https://www.carepatron.com/blog/how-much-does-credentialing-cost ; https://medwave.io/2026/03/how-much-does-medical-credentialing-cost/
- [U] Iowa Code Title XIII index (ch. 510 TPA): https://www.legis.iowa.gov/law/iowaCode/sections?codeChapter=510&year=2026
