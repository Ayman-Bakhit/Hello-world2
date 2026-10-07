# LAUNCHPAD: launch configuration foundation (Slice 11)

Slice 11 builds launch CONFIGURATION, validation, persistence, review and a public read-only view. It deploys nothing: no token, no mint, no liquidity, no swap, no fee routing, no payout, no donation, no transfer, no transaction, no signature. "Actual on-chain launch" is a later, isolated slice.

## What a launch is (today)
A server-side record the creator owns: token name, symbol, description, decimals, total supply, network, USER-PROVIDED metadata (image URL, website, social links), supply allocation and authorities, liquidity configuration, the fee split, the selected charity (registry id), and the tax reserve allocation destination. Everything is configuration. `deployment` is always `{ status: "not_deployed", mintAddress: null, transactionSignature: null, contractAddress: null }`.

## Lifecycle (server-controlled)
`DRAFT -> CONFIGURED -> REVIEW -> READY`, plus `CANCELLED`. `DEPLOYING`, `LIVE` and `FAILED` exist only as words for the future: the API response schema, the transition table (`packages/shared/src/launchModel.ts`) and a database constraint (`launch_status_reachable`) all exclude them.
| Action | From | To | Notes |
|---|---|---|---|
| create | | DRAFT | validated body; wallets must be the actor's; the charity must exist in the registry |
| update (`PUT`) | DRAFT, CONFIGURED, REVIEW, READY | DRAFT | clears the review, un-publishes, new fingerprint, new revision |
| configure | DRAFT | CONFIGURED | server validation passes; a failure stays DRAFT with the errors recorded |
| review | CONFIGURED | REVIEW | re-validates; records the reviewed fingerprint and the charity's registry state |
| ready | REVIEW | READY | needs `{ fingerprint, confirmed: true, publish }`; the fingerprint must equal the current one |
| cancel | any non-cancelled | CANCELLED | terminal |
A client can never send a status: every body is strict, and there is no field for it. READY means "Configuration validated and ready for a future deployment flow. No on-chain transaction has been submitted." It does NOT mean launched, deployed or live.

## Fee split: fixed 60/15/15/10, a configuration (not an on-chain rule)
Creator 6000, tax reserve 1500, charity 1500, protocol 1000 basis points, total 10000. The shared `validateFeeSplit` invariant is reused (no duplicated math); the server additionally requires the split to equal `CANONICAL_FEE_SPLIT` exactly, so a user cannot reallocate it (a split that totals 10000 but differs is rejected). The database also refuses a non-canonical split for new rows (`launch_fee_split_canonical`, `NOT VALID` so legacy rows are untouched). The editor shows it as read-only. It is never called immutable: nothing enforces it on-chain.

## Allocations are labels, not payments
"Configured creator allocation", "Configured tax reserve allocation (launch fee)", "Configured charity allocation", "Configured protocol allocation". Nothing says earned, received or paid. The launch tax reserve allocation is a launch fee allocation: it is unrelated to the user's personal Tax Reserve target or balance (Slice 10) and shares no table or field with it. No protocol address is configured or hardcoded. Selecting a charity does not execute a donation.

## Charity
Chosen by registry id (a name is rejected). Existence is checked on save; verification is judged at configure / review / ready time against the registry's CURRENT state, which is shown with its source and last-reviewed date. A charity that is not `VERIFIED` blocks CONFIGURED. A `VERIFIED` charity whose source is `FIXTURE` is allowed but flagged: "This charity's verification rests on a labeled fixture. It is not a real-world verification." (Decision: with no real charity data this is the only way to exercise the flow; it must change before any real launch.)

## Metadata is USER-PROVIDED
Image, website and social links are validated URLs (https for image and socials, http or https for the website; no credentials, whitespace, `javascript:`, `data:`, `file:`, `ftp:`, protocol-relative or over 500 characters). The server never fetches them and the UI never loads the image. Names, symbols and descriptions are plain text (no control or bidi characters, no angle brackets). Everything is labeled `USER-PROVIDED`, `verifiedOnChain: false`. No mint address, metadata hash or explorer link is ever invented.

## Supply
A positive integer string of at most 30 digits, decimals 0 to 9, and the scaled supply (`totalSupply * 10^decimals`) must fit a u64 (18446744073709551615), checked with exact BigInt arithmetic.

## Fingerprint and history (auditability, not a blockchain proof)
`launchFingerprint` is sha256 over the canonical configuration (percent strings become basis points, optional fields null, keys sorted): token, network, supply and authorities, liquidity, fee split, charity id, tax reserve allocation destination, protocol and creator allocations. Any change changes it; no secret, session, user id or time is included. It is recomputed from the stored configuration on every read, never trusted from a column.
Every action appends a row to `launch_configuration_revisions` (append-only: UPDATE and DELETE are rejected) with a hash chain, so an edit made outside the API is detectable (`historyIntact`). This is tamper-evident auditability for the owner, not a cryptographic guarantee and not a blockchain proof.

## Public view
`GET /api/public/launches` and `/:id` expose only READY configurations whose creator chose to publish them: name, symbol, description, network, abbreviated creator address, supply, allocations, the charity's current registry state, fingerprint, metadata provenance. Never a user id, session, full wallet address, tax reserve destination, review internals or history. Labeled CONFIGURED / NOT DEPLOYED / NOT VERIFIED ON-CHAIN. Editing or cancelling hides it again.

## Future deployment boundary (NOT implemented)
A later slice may: take the reviewed configuration; build a real transaction; require the creator's explicit signature; create the mint; set authorities; create liquidity; establish fee routing; verify the resulting on-chain state; produce the Token Proof. It must compare the reviewed fingerprint against the actual deployed configuration. The reviewed fingerprint stored at REVIEW / READY is the anchor for that comparison.

## Decisions NOT made (stop conditions, documented not invented)
Token program (SPL Token vs Token-2022); mint and freeze authority policy on-chain; the liquidity pool program; the fee-routing program and how 60/15/15/10 is enforced; the creator payout mechanism; protocol wallet custody; the charity payment mechanism; tax-reserve custody; whether the split can ever be changed after deployment.

## Caveats that still apply
Real Solana RPC has not been validated from this environment; real historical prices are not connected; tax calculations are not jurisdiction-complete; user-provided cost basis is unverified; charity verification is fixture/admin-data driven; no real money movement; no real token deployment.

## Token proof (Slice 12)
A READY launch has a read-only proof view (`GET /api/launches/:id/proof`, `GET /api/public/launches/:id/proof`). Without a deployment record it is NOT DEPLOYED; nothing in this repo records a deployment or an observation in production, so no real launch can be VERIFIED. The fingerprint stored at READY stays the anchor a deployment is compared against (`CONFIGURATION_FINGERPRINT_MATCH`). See docs/TOKEN_PROOF.md.

## Deployment plan (Slice 13)
A READY launch has an owner-only, read-only deployment PLAN and review (`docs/DEPLOYMENT_PLAN.md`). It is BLOCKED today: the supply allocation model, metadata URI, protocol destination, liquidity venue and fee routing are undecided and nothing is invented. BUILD and REVIEW exist; SIGN, SEND, CONFIRM, RECONCILE are not implemented. The plan hash derives from the configuration fingerprint, so editing a launch makes its earlier plan stale.
