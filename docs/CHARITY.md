# Charity registry, verification evidence, donation records and receipts (Slice 9)

Slice 9 is a data and provenance foundation. It is read-only, fixture-driven and does not move money. There is no code path that builds, signs or sends a transaction, and no endpoint that creates a donation.

## Four separate things
| Thing | Table | What it means | What it is NOT |
|---|---|---|---|
| Registry record | `charities`, `charity_wallets` | What a charity says it is: name, slug, description, website, logo URL, country, state | Proof the organization is legitimate |
| Verification evidence | `charity_verification_evidence` (append-only) | Someone checked something: source type, reference, result, when, by whom | A guarantee. A website alone is `WEBSITE_CLAIM` and can never support VERIFIED |
| Donation record | `donations` | A user's draft/pending/failed/cancelled record, or a confirmed one tied to an indexed chain transaction | A transfer. A record is not a transaction |
| Receipt | `donation_receipts` | A document reference (charity reference, optional https document URL, optional sha256 hash) | A tax receipt, or proof that a contribution is deductible |

## Verification states
`UNVERIFIED`, `PENDING_REVIEW`, `VERIFIED`, `SUSPENDED` (column `charities.verification_state`, replaces the old enum column).
- VERIFIED needs `verification_source` and `verification_checked_at`, and a deferred constraint trigger requires at least one `SUPPORTS` evidence row from `REGISTRY_LOOKUP`, `OFFICIAL_DOCUMENT`, `ADMIN_REVIEW` or `FIXTURE`. `WEBSITE_CLAIM`, `DOES_NOT_SUPPORT` and `INCONCLUSIVE` can never support it.
- `FIXTURE` is possible only for `data_source = 'demo'`, in both directions (charity, evidence). A fixture charity is therefore never "real-world verified". The UI says `VERIFIED (FIXTURE, NOT REAL-WORLD)` and uses the demo tone.
- Evidence rows are immutable. A correction is a new row. `last reviewed` is the latest evidence `checked_at`.
- Admin-only: `charities.verification_notes`, `evidence.internal_notes`, `evidence.verifier_user_id`. No public or user endpoint selects them; the public evidence view only says whether an admin review was recorded (`ADMIN` or `NOT_RECORDED`).
- Charity wallets keep their own `verification_status` (a destination address is verified separately from the organization). A charity is eligible for a donation review only when the organization is VERIFIED and a verified wallet supports the asset.

## Donation records
- Statuses: `draft`, `pending`, `confirmed`, `failed`, `cancelled`, and `demo`. `demo` is not a lifecycle state: it marks a fixture record and is inseparable from `data_source = 'demo'` and `provenance = 'DEMO_FIXTURE'` (DB constraint).
- `confirmed` requires, enforced by the database: an indexed transaction (`raw_transaction_id`) that belongs to the donor's own wallet (`transactions` row, `data_source = 'chain'`), `data_source = 'chain'`, `provenance = 'CHAIN_INDEXED'` and `donated_at`. Nothing in the API can produce one in this slice.
- Quantity is `numeric(40,0)` base units, returned as an integer string. USD value is a nullable reference (`usd_value_cents` plus a required `usd_reference_source`), never the deductible amount.
- Fixture donations are labeled `DEMO RECORD · NOT ON-CHAIN` and carry no signature.

## Receipts
`donation_receipts` gained `charity_receipt_reference`, `document_url` (https only), `receipt_hash` (64 hex), `verification_state` (`UNVERIFIED`, `CHARITY_REPORTED`, `VERIFIED`), `provenance_note`, `data_source`. A receipt must share its donation's data source, a non-fixture receipt needs a confirmed donation, and a fixture receipt can never be VERIFIED. Fixture receipts display `DEMO RECEIPT`, `FIXTURE DATA`, `NOT A TAX RECEIPT`. No receipt is ever generated.

## What the UI does
Give Center: registry with search and status filter, per-charity Verification status / Verification source / Last reviewed / Evidence, a selected-charity panel with the evidence list, a donation REVIEW (a stateless plan, final action disabled with "Donation transfers are not enabled in this beta."), donation history with receipt status, donation detail with receipt. A real wallet with no donations sees `NO DONATIONS YET`. The demo wallet stays labeled DEMO DATA.

Logos: `logo_url` is stored and validated (https only) but deliberately not rendered, so viewing the page never makes a request to a third-party host.

## Tax language
Every donation-related tax statement is qualified: "Potentially deductible charitable contribution. Consult a tax professional." The USD value is "a reference value, not automatically the deductible amount." Banned phrases (tax write-off, guaranteed deduction, tax loophole, guaranteed tax benefit, deductible donation, guaranteed legitimate, guaranteed tax deductible, IRS approved, safe charity) are linted in API, shared and web sources and in API responses.

## Decisions deliberately NOT made (need a decision before real donations)
- How a real on-chain donation is matched to a record (memo, reference account, or post-hoc matching of an indexed transfer). The DB only requires that a confirming transaction be an indexed chain transaction of the donor wallet.
- Who may verify a charity and what evidence is sufficient. Slice 9 has no admin mutation endpoints; verification data is seeded fixture/admin data.
- Jurisdiction-specific deductibility and receipt requirements.
- How the launch fee-split charity share relates to donation records. Launch review still treats a fixture-VERIFIED demo charity as verified (it deploys nothing); this must change before any real launch.

## Not real-world verified
Charity verification here is fixture/admin-data driven. Real Solana RPC has not been validated from this environment and real price providers are not connected. No real donation transfer occurs.
