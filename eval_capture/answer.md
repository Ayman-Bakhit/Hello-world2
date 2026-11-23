## Decision: no-go on Google Business Profile (high confidence)

Under the rules in force on November 23, 2026, there is no compliant way to list this business, either as a storefront or as a service-area business. Don't buy the $59/month virtual office for Google Maps. If you do it anyway, Google's policy says it can disable or suspend the profile.

## Why each configuration fails

All of these are Verified: I opened the Google help pages in this session on 2026-11-23. None of them shows a "last updated" date, only "©2026 Google", so I'm treating them as the current rules.

| Configuration | Result | Rule |
|---|---|---|
| Online-only business, no address | Ineligible | "To qualify for a Business Profile, a business must make in-person contact with customers during its stated hours." The ineligible list includes "Brands, organizations, artists, and other online-only businesses." ([13763036](https://support.google.com/business/answer/13763036?hl=en)) |
| Storefront at the $59 virtual office | Ineligible | If a business "rents a physical mailing address but doesn't operate out of that location… that location isn't eligible." Also: "P.O. boxes or mailboxes located at remote locations aren't acceptable." ([3038177](https://support.google.com/business/answer/3038177?hl=en)) |
| Service-area business with a virtual office | Ineligible | "Service-area businesses can't list a 'virtual' office unless that office is staffed during business hours." ([3038177](https://support.google.com/business/answer/3038177?hl=en)) |
| Storefront at your home | Ineligible | No customers visit, so there's no in-person contact. Also: "If your business doesn't have permanent on-site signage, it's not eligible as a storefront." ([9157481](https://support.google.com/business/answer/9157481?hl=en)) |
| Service-area business with home address hidden | Ineligible | A service-area business is defined as one that "visits or delivers to customers directly." ([9157481](https://support.google.com/business/answer/9157481?hl=en)) You never visit customers. |

Two notes on the last row:
- **Inference, not stated by Google:** emailing files probably doesn't count as "delivers to customers directly." Google's examples are cleaning services and plumbers.
- **Enforcement:** "If we determine that your business doesn't exist in the location you claim, Google will disable your profile." ([13762416](https://support.google.com/business/answer/13762416?hl=en)) Live video verification asks you to show "outside signs, nearby businesses, or a street sign" and the "tools you use to serve customers." ([7107242](https://support.google.com/business/answer/7107242?hl=en)) A rented mailbox can't pass that honestly.

The vendor saying the address "can be listed on Google Maps" is a sales claim, and Google's own policy contradicts it.

## What would actually make you eligible

There are no permitted configurations under your current model. Each of these is a real change to the business, and each one breaks a constraint you set:
1. **You travel to clients' sites** (on-site spreadsheet or reporting work). That makes you a service-area business, with your home address hidden and a service area of roughly 2 hours' drive or less. It breaks "never visit customers."
2. **You rent a staffed office with signage that receives customers during posted hours** (coworking counts only with "clear signage," customers received there, and your staff present). It breaks "works from home" and the $1,000 budget.

Neither is worth doing just to get a Maps listing.

## Alternative channel: direct outbound email and LinkedIn to small businesses

I couldn't evaluate Upwork: all three official fee pages returned 403, so its costs are unverified and I left it out.

| | GBP plus virtual office | Direct outbound |
|---|---|---|
| Eligible or legal | No | Yes, if you follow CAN-SPAM |
| Year-1 cost | $708, which is 71% of your $1,000 | About $131, which is 13% |
| First 2 weeks cash out | $59 | About $38 |
| Who reaches you | Local "near me" searches, which mostly isn't how people buy remote spreadsheet work (my judgment) | Buyers you pick yourself |

Outbound cost inputs (math was run in code):
- Carrd Pro Standard is $19/year with custom domains. Verified at [carrd.com/pro](https://carrd.com/pro).
- A .com domain is about $11. This is an estimate: Cloudflare says it sells "at cost" ([source](https://www.cloudflare.com/products/registrar/)), but I didn't see the actual price.
- Google Workspace is about $8.40/month. This is unverified: the pricing page loaded without dollar amounts.

**Legal requirement for outbound (Verified, [FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business), edited Jan 2024):**
- B2B email is covered: "The law makes no exception for business-to-business email."
- No misleading headers or subject lines, and the email must be identified as an ad.
- You must honor opt-outs within 10 business days.
- Penalties go up to $53,088 per email.
- Every email needs a postal address. A USPS P.O. box or a private mailbox at a registered commercial mail receiving agency is allowed. That's the one legitimate use for the virtual-office address: keeping your home address out of email footers. Check that the vendor is a registered receiving agency, and compare the price with a USPS P.O. box, which I didn't check.

**First two weeks:**
- **Days 1–2:** Buy the domain, set up Workspace, and publish a Carrd page with the copy below and an upload or booking form. Build a free sample: take one messy public dataset and produce a before/after file plus a one-page monthly report.
- **Days 3–4:** Build a list of 150 named decision-makers. Targets are owners or ops leads at 5–50 person businesses that run on spreadsheets (e-commerce shops, agencies, trades contractors) and small bookkeeping firms that could send you overflow work. Use public sites and LinkedIn. Don't invent contacts.
- **Days 5–10:** Send about 25 personal emails a day plus LinkedIn notes. The offer: a fixed-price cleanup of one file, with the first diagnosis free. Follow up once after 3 days.
- **Days 11–14:** Hold discovery calls, quote, and close a paid pilot.

**Go/stop thresholds** (my judgment, not sourced):
- **Validated:** at least 3 calls and at least 1 paid job by day 14.
- **Rewrite the message once:** fewer than 3 replies out of 150 (under 2%).
- **Stop or change who you're targeting:** still under 2% after the second batch of 150.

The funnel math explains why: a 1% reply rate on 150 sends is about 1.5 replies, and 5% is about 7.5. Reply rates are assumptions; I have no benchmark data.

## Landing-page description (106 words)

This replaces a profile description, because no compliant profile exists.

> Messy spreadsheets cost you hours and bad decisions. I clean, restructure, and automate Excel and Google Sheets files for small businesses, entirely online. Send a copy of the file; within 48 hours you get a fixed-price quote and a short list of what is broken: duplicates, inconsistent formats, broken formulas, missing data. After cleanup, I can build a monthly report that updates from your source data and lands in your inbox on a set date, with the same few numbers you actually use to run the business. No office visits, no long contracts. Start with one file. Book a 15-minute call or upload a sample below.

Only publish the "48 hours" promise if you can keep it.

## What would change this answer
- Google publishes a policy that explicitly allows online-only or virtual-office businesses. I found none.
- You decide to do on-site work, which makes the service-area listing legitimate.

## Requirement check
- **R1** (GBP decision): met. No-go for both storefront and service-area.
- **R2** (permitted configurations vs. eligibility changes): met. The table covers configurations; "What would actually make you eligible" covers the two changes.
- **R3** (alternative with costs and first two weeks): met, but partial on cost verification. The Workspace and domain prices are unverified, and Upwork's fee pages were blocked.
- **R4** (landing-page copy): met at 106 words.
- **R5** (official policies cited): met. Google help pages 3038177, 13763036, 9157481, 13762416 and 7400114 are linked; for CAN-SPAM I cited the FTC guide.
- **R6** (no-go allowed): used.
