# PRODUCT_DECISIONS: the canonical product decision record

This is the authoritative record of the product and economics decisions a launch depends on. It records what is **decided**, what is **pending**, what is only an **engineering default awaiting approval**, and what each open decision blocks. It is a decision-resolution document, not an execution one: real execution stays disabled, and nothing here signs, sends, mints, creates liquidity, routes fees or moves money.

Rules this record follows:
- Nothing is decided here that the existing product requirements do not support. Where they do not, the decision is **PENDING** and the exact decision needed is stated.
- No address, pool, mint, metadata URI, signature or observation appears anywhere in it (the only addresses in the code policy are public program ids).
- "Enforced", "immutable" and "on-chain" are not used for anything that is not.
- Code mirrors this record: `packages/shared/src/deploymentPolicy.ts` (`DEPLOYMENT_POLICY`, version 2, 21 decisions) and the readiness evaluator in `readiness.ts`. A test fails if the status table below disagrees with the code or omits a decision. Approvals are recorded only by a reviewed code change (approver, date, reference, version); no API, query or client field can approve anything.
- **Approval is not implementation.** An approved decision says what the product wants. It does not mean any mechanism exists, and readiness keeps blocking until the mechanism does.

## Status table (mirrors the code)
Approval is `PENDING PRODUCT APPROVAL` for every row: no approver, date or reference has been recorded for any decision, including the ones inherited from earlier slices. Pending decisions cannot be approved.

| Decision | Status | Approval | Depends on | Blocks milestones |
|---|---|---|---|---|
| `SUPPLY_SEMANTICS` | DECIDED (engineering default) | PENDING PRODUCT APPROVAL | none | PLAN_EXECUTABLE, MINT_CREATION, MAINNET |
| `SUPPLY_ALLOCATION_MODEL` | PENDING | PENDING PRODUCT APPROVAL | SUPPLY_SEMANTICS, FEE_SPLIT_SCOPE | PLAN_EXECUTABLE, MINT_CREATION, LIQUIDITY_CREATION, MAINNET |
| `ALLOCATION_LOCKS_AND_VESTING` | PENDING | PENDING PRODUCT APPROVAL | SUPPLY_ALLOCATION_MODEL | PLAN_EXECUTABLE, MINT_CREATION, LIQUIDITY_CREATION, MAINNET |
| `FEE_SPLIT` | DECIDED (existing configuration) | PENDING PRODUCT APPROVAL | none | PLAN_EXECUTABLE, FEE_ROUTING, MAINNET |
| `FEE_SPLIT_SCOPE` | PENDING | PENDING PRODUCT APPROVAL | none | PLAN_EXECUTABLE, FEE_ROUTING, MAINNET |
| `FEE_ROUTING_MECHANISM` | PENDING | PENDING PRODUCT APPROVAL | FEE_SPLIT_SCOPE, LIQUIDITY_STRATEGY, TOKEN_PROGRAM | PLAN_EXECUTABLE, FEE_ROUTING, PROOF_VERIFIED, MAINNET |
| `PROTOCOL_DESTINATION` | PENDING | PENDING PRODUCT APPROVAL | FEE_ROUTING_MECHANISM, SUPPLY_ALLOCATION_MODEL | PLAN_EXECUTABLE, MINT_CREATION, FEE_ROUTING, PROOF_VERIFIED, MAINNET |
| `CHARITY_PAYOUT_MODEL` | DECIDED (existing configuration) | PENDING PRODUCT APPROVAL | none | PLAN_EXECUTABLE, MINT_CREATION, FEE_ROUTING, PROOF_VERIFIED, MAINNET |
| `CHARITY_VERIFICATION_GOVERNANCE` | PENDING | PENDING PRODUCT APPROVAL | CHARITY_PAYOUT_MODEL | PLAN_EXECUTABLE, FEE_ROUTING, MAINNET |
| `TAX_RESERVE_MODEL` | DECIDED (existing configuration) | PENDING PRODUCT APPROVAL | none | PLAN_EXECUTABLE, MINT_CREATION, FEE_ROUTING, MAINNET |
| `TAX_RESERVE_FUNDING` | PENDING | PENDING PRODUCT APPROVAL | TAX_RESERVE_MODEL, FEE_SPLIT_SCOPE, FEE_ROUTING_MECHANISM | PLAN_EXECUTABLE, FEE_ROUTING, PROOF_VERIFIED, MAINNET |
| `LIQUIDITY_STRATEGY` | PENDING | PENDING PRODUCT APPROVAL | SUPPLY_ALLOCATION_MODEL, ALLOCATION_LOCKS_AND_VESTING | PLAN_EXECUTABLE, LIQUIDITY_CREATION, PROOF_VERIFIED, MAINNET |
| `METADATA_DOCUMENT` | DECIDED (engineering default) | PENDING PRODUCT APPROVAL | none | PLAN_EXECUTABLE, MINT_CREATION, MAINNET |
| `METADATA_HOSTING` | PENDING | PENDING PRODUCT APPROVAL | none | PLAN_EXECUTABLE, MINT_CREATION, PROOF_VERIFIED, MAINNET |
| `TOKEN_PROGRAM` | DECIDED (engineering default) | PENDING PRODUCT APPROVAL | none | PLAN_EXECUTABLE, SIGNING, MAINNET |
| `MINT_KEY_STRATEGY` | DECIDED (engineering default) | PENDING PRODUCT APPROVAL | TOKEN_PROGRAM | PLAN_EXECUTABLE, SIGNING, MAINNET |
| `FEE_COMPUTE_POLICY` | DECIDED (engineering default) | PENDING PRODUCT APPROVAL | none | PLAN_EXECUTABLE, SIGNING, MAINNET |
| `ENVIRONMENT_POLICY` | DECIDED (engineering default) | PENDING PRODUCT APPROVAL | none | PLAN_EXECUTABLE, SIGNING, MAINNET |
| `SECURITY_REVIEW` | PENDING | PENDING PRODUCT APPROVAL | FEE_ROUTING_MECHANISM, LIQUIDITY_STRATEGY, MINT_KEY_STRATEGY | SIGNING, LIQUIDITY_CREATION, FEE_ROUTING, MAINNET |
| `SMART_CONTRACT_REVIEW` | PENDING | PENDING PRODUCT APPROVAL | FEE_ROUTING_MECHANISM, LIQUIDITY_STRATEGY | LIQUIDITY_CREATION, FEE_ROUTING, MAINNET |
| `LEGAL_REVIEW` | PENDING | PENDING PRODUCT APPROVAL | FEE_SPLIT_SCOPE, CHARITY_VERIFICATION_GOVERNANCE, TAX_RESERVE_FUNDING | FEE_ROUTING, MAINNET |

Counts: 9 DECIDED, 12 PENDING, 21 without product approval.

## Where the existing requirements conflict or are ambiguous
These are surfaced, not silently resolved. Nothing in the code was changed because of them.
1. **"Creator allocation" means two things.** `creatorAllocationPercent` in the launch configuration is a share of token SUPPLY. The 60% creator bucket of the fee split is a share of FEES, and the launch UI labels that bucket "Configured creator allocation" (`launchModel.ts`). The same word names two economic concepts.
2. **The 15/15/10 buckets read as fee allocations, but the Slice 14 allocation validator allowed them to hold supply.** All launch copy calls the tax reserve share "a launch fee allocation", and the charity and protocol shares appear only in the fee split. `resolveSupplyAllocation` (Slice 14) nevertheless accepts charity, tax reserve and protocol roles in the supply model. This is harmless because a role may be 0 bps, but whether those roles should exist in supply at all is an open question (decision 1 below).
3. **52% of supply has no stated recipient.** The configuration has a creator share and a liquidity share (the fixture: 8% and 40%) and nothing for the rest.
4. **The Slice 3 demo tokens use varying splits.** Demo tokens carry splits such as 7000/500/1500/1000 and 5000/1000/2500/1500 over a generic `lifetimeFeesCents`, while the launch configuration accepts only 6000/1500/1500/1000 "in this version". The demo implies the split is per-token and may vary and that it divides total "fees"; the launch code says it is fixed. Which is intended is undecided.
5. **The launch tax reserve is "creator controlled".** `taxReserveConfiguration.destinationType` is the literal `creator_controlled`, so 15% is routed to an address the creator controls, in addition to a 60% creator share. Whether the separate bucket is a bookkeeping designation, a ring-fenced reserve, or something else is undefined.
6. **Liquidity is denominated in USDC but no pair is chosen.** `initialLiquidityUsdc` implies a USDC quote asset and a creator-funded amount, yet the plan treats the pair, the provider and the LP owner as undecided.
7. **Metadata is mutable by default.** `updateAuthority` defaults to `creator`, so a launched token's metadata can change after launch, which interacts with Token Proof's metadata check. Whether that default is wanted for mainnet is undecided.
8. **Charity verification is fixture or admin data.** The registry marks charities VERIFIED through fixtures or admin review; there is no real verifier or evidence process, so "verified" does not yet mean verified in the real world.
9. **Stale docs.** `docs/DEPLOYMENT.md` said "Not started" and `docs/THREAT_MODEL.md` had not been updated since Slice 4. Both now point here.

## 1. Initial token supply and allocation model
**Decided (engineering default, `SUPPLY_SEMANTICS`):** total supply is fixed at launch in base units (a whole number scaled by decimals that fits a u64). Allocation shares are basis points of that total. Every unit of supply belongs to exactly one role; there is no silent remainder, and a burned share is an explicit `BURN` role. The roles are creator, liquidity, charity, tax reserve, protocol and burn, and they must sum to exactly 10000 bps (`resolveSupplyAllocation`, property-tested). Initial token supply allocation and the fee split are different economic concepts; neither is derived from the other.

**Not decided (`SUPPLY_ALLOCATION_MODEL`, PENDING):** where the supply beyond the creator and liquidity shares goes. Needed from the product owner:
- Do charity, tax reserve and protocol receive any token supply at all? (The existing copy describes them as fee allocations; if so, their supply share is 0.)
- Who receives the remainder (for the fixture, 52%)? Candidate answers, none chosen: all non-creator supply seeds liquidity; the remainder is burned; the remainder is held by a named, controlled destination; another model.
- Who controls each destination, and is any allocation intentionally unassigned? (Under the decided semantics it may not be.)

**Not decided (`ALLOCATION_LOCKS_AND_VESTING`, PENDING):** whether the creator share is immediately transferable, and whether any share is locked, vested or burned, with duration and a release authority. No lock or vesting mechanism exists in the product. Whatever is chosen must be observable for Token Proof.

Recommendation (not a decision): treat charity, tax reserve and protocol as fee/revenue concepts and give them 0 bps of supply, because every existing description of them is a fee allocation. This still leaves the remainder question open.

## 2. What the 60/15/15/10 split divides
**Decided (existing configuration, `FEE_SPLIT`):** the numbers: creator 6000, tax reserve 1500, charity 1500, protocol 1000 bps, summing to 10000. It is a configured split. Nothing enforces it on-chain.

**Not decided (`FEE_SPLIT_SCOPE`, PENDING).** The product has not said what is split. Each of these is a different product and none is assumed: launch proceeds; creator revenue; trading fees; protocol or platform fees; DEX swap fees; creator fees generated by a third-party venue; a custom post-launch revenue stream. For whichever is chosen the record must state: the exact fee source; when the split occurs; who pays it; who receives each share; whether it happens once or repeatedly and at launch, after launch or both; whether it is per transaction; whether it applies to trading volume or to actual fees collected; and what happens when the underlying venue does not support the split.

A normal SPL token does not enforce a revenue split. Nothing may be called enforced until a mechanism in section 3 is selected, implemented, reviewed and observable. The readiness gate stays blocked with `FEE_ROUTING_ENFORCEMENT_NOT_IMPLEMENTED`.

## 3. Fee routing and enforcement mechanism (PENDING, `FEE_ROUTING_MECHANISM`)
Evaluated options. "Verifiable" means an observer could objectively confirm the 60/15/15/10 outcome from chain data.

| | A. Application-level routing | B. Venue or router support | C. On-chain fee vault | D. Custom program |
|---|---|---|---|---|
| Can enforce | Nothing on-chain: the platform chooses to forward funds | Whatever the venue's fee settings allow; typically one fee recipient or a venue-defined split | Splitting funds deposited into the vault, if the vault program is the only way out | Any rule the program encodes, including the split and authority limits |
| Cannot enforce | That the platform actually forwards, or forwards the right amounts | A split the venue does not support; changes the venue's admin can make | That fees reach the vault in the first place, unless the venue pays into it | Anything outside the program's own accounts |
| Custody | Platform or a platform-controlled wallet touches funds: conflicts with the non-custodial rule for user assets | Venue and fee recipient hold funds; platform custody only if it is the recipient | Funds sit in program-controlled accounts | Funds sit in program-controlled accounts |
| Upgrade or admin risk | The platform can change behavior at will | The venue's admin and upgrade authority | Program upgrade authority and any vault admin | Program upgrade authority; the largest surface |
| Works with SPL Token | Yes | Yes, venue permitting | Yes, with a program | Yes, with a program |
| Needs a custom program | No | No | Yes | Yes |
| Needs an external venue | Optional | Yes | Optional | Optional |
| Audit burden | Low code, but no on-chain guarantee to audit | Review of the integration; trust in the venue | Program audit | Program audit plus governance review |
| User signing | Minimal | The creator signs setup at launch | Creator and users sign vault interactions | Same, per program design |
| 60/15/15/10 objectively verifiable | No | Only if the venue's configuration and payouts are observable and match | Yes, if routing is complete and observable | Yes, by design |

No option is selected. The requirements do not say whether a custom program is acceptable, which venue is approved, or whether users must be able to verify the split on-chain; those are the inputs the choice needs. A supported conclusion is narrower: option A cannot support the words "enforced" or "verifiable"; options C and D require a program that does not exist and a smart-contract review; option B depends on the liquidity venue decision. So the decisions should be taken in this order: fee split scope, then liquidity venue, then fee routing mechanism.

## 4. Protocol destination and custody (PENDING, `PROTOCOL_DESTINATION`)
The 10% protocol share has no defined meaning beyond a bucket. To be decided: whether it is a treasury or operational revenue; the destination type (multisig, single signer or program-controlled); who controls it; whether it is fixed or configurable and per cluster; who approves a change; and how users independently verify it. The address itself is not available and is not invented. No developer, fixture or random address may stand in for it.

Policy to adopt once an address exists (a recommendation, pending approval): the destination is per cluster; a change requires a new approval record, a new policy version and therefore a new plan hash, so a previously recorded plan goes stale and readiness is blocked until the plan is recorded again; the destination appears in the public Token Proof expected state so any user can compare it with the observed routing; the protocol never takes custody of user assets, only of its own share. A multisig or program-controlled destination is recommended over a single signer, as a security preference rather than a stated requirement.

## 5. Liquidity design (PENDING, `LIQUIDITY_STRATEGY`)
Everything below is open, and no venue is chosen for convenience: the venue and pool type; the pair and quote asset (the configuration's USDC amount suggests USDC but does not decide it); the initial amount model and who provides the quote side; who owns the LP position; whether it is locked, for how long, who can unlock it and whether it can be removed; how ownership becomes observable; how Token Proof verifies the pool, the amounts and the lock; what happens when liquidity creation fails (for example after the mint exists); and whether it shares a transaction group with minting or runs separately. Liquidity is part of the initial supply allocation as the LIQUIDITY role (the configuration's supply percentage), so it depends on `SUPPLY_ALLOCATION_MODEL` and `ALLOCATION_LOCKS_AND_VESTING`. The expected state already keeps expected liquidity apart from observed liquidity. Readiness stays blocked, with `LIQUIDITY_BUILD_NOT_IMPLEMENTED` even after a venue is named, until its builder exists.

## 6. Metadata hosting (PENDING hosting, DECIDED document format)
Decided (engineering default, `METADATA_DOCUMENT`): a Metaplex-style JSON document (name, symbol, description, image if set, external_url if set, `seller_fee_basis_points: 0`), canonicalized with sorted keys and compact UTF-8, with its **sha256 recorded in the plan and the expected state**. Metadata stays user-provided and unverified; the hash lets Token Proof compare configured with observed metadata. The URI is not content-addressed by this decision.

Pending (`METADATA_HOSTING`): the hosting strategy and who operates it; the URI format; whether content is immutable or content-addressed (nothing may be claimed about decentralization or permanence until true); whether image assets are supported; whether the server hosts anything (today it hosts and fetches nothing, and adds no storage dependency); whether and how creators may update metadata after launch (the default update authority is the creator); and whether an update changes proof status. Recommendation that follows from the existing design: whichever hosting is chosen, the sha256 of the canonical document must remain the comparison anchor, and a metadata update after launch should show as a mismatch against the recorded hash rather than silently pass.

## 7. Charity model
Decided (existing configuration, `CHARITY_PAYOUT_MODEL`): one verified payout wallet per charity. The charity must be VERIFIED; exactly one verified, well-formed wallet must exist; that address is part of the plan and expected state; a change to it changes the plan hash so a recorded plan goes stale. No donation is executed and no charity funds touch platform custody under this model (nothing is routed at all today).

Pending (`CHARITY_VERIFICATION_GOVERNANCE`): who verifies a charity and who controls verification; the evidence required for a real, non-fixture verification; what happens when a wallet changes; what happens when a charity is suspended after launch (for example whether routing pauses, redirects or continues); whether charity funds ever touch platform custody; and how payouts are independently verified. Fixture charities (marked demo, verified by a labeled FIXTURE source) are separate from real verified charities and cannot satisfy a real launch's readiness in a future production policy; this separation must be kept when real verification exists. Whether the charity share is token supply or fee routing follows from sections 1 and 2; the existing copy says fee routing.

## 8. Tax reserve model
Decided (existing configuration, `TAX_RESERVE_MODEL`): the **launch tax reserve allocation** is a creator-controlled address stored in the launch configuration. It is unrelated to a user's **personal Tax Reserve** (Slice 10), which is an estimate, a user-chosen target and an unavailable balance, and shares none of its tables or logic. The two concepts are not merged.

Pending (`TAX_RESERVE_FUNDING`): whether the launch allocation is token supply, fee/revenue (the existing copy says fee allocation) or a USDC reserve; the asset; whether it is funded by a mechanism or merely designated as a destination; withdrawal rules; who may change the destination; how it is verified; and how it appears in Token Proof. Today it is a designated address only. Nothing funds it and no money movement is implemented.

## 9. Engineering defaults: explicit approval
Each default below came from Slice 14. None is approved: none has an approver, date or reference recorded. The status is **PENDING PRODUCT APPROVAL**. No default is REJECTED. Recommendations are advisory.

| Default | Approval | Note |
|---|---|---|
| SPL Token classic (`TOKEN_PROGRAM`) | PENDING PRODUCT APPROVAL | No V1 feature needs a Token-2022 extension; revisit if the fee mechanism needs the transfer-fee extension. Recommend approving. |
| Browser/client-held mint keypair; only the public key reaches the server (`MINT_KEY_STRATEGY`) | PENDING PRODUCT APPROVAL | Preserves the no-key-material rule. Recommend approving. |
| Creator pays rent and network fees; the platform pays nothing (`FEE_COMPUTE_POLICY`) | PENDING PRODUCT APPROVAL | Consistent with the non-custodial rule. |
| No platform-funded priority fees | PENDING PRODUCT APPROVAL | Part of `FEE_COMPUTE_POLICY`; conservative. |
| No automatic retry without user action | PENDING PRODUCT APPROVAL | Part of `FEE_COMPUTE_POLICY`; avoids duplicate launches. |
| Metadata canonical format and sha256 (`METADATA_DOCUMENT`) | PENDING PRODUCT APPROVAL | Hosting is separate and pending. |
| Devnet and mainnet-beta separation; local-fake cannot host a launch (`ENVIRONMENT_POLICY`) | PENDING PRODUCT APPROVAL | Mainnet additionally needs the three reviews. |
| Cluster mismatch refusal | PENDING PRODUCT APPROVAL | Part of `ENVIRONMENT_POLICY`. |
| Supply semantics (`SUPPLY_SEMANTICS`) | PENDING PRODUCT APPROVAL | Fixed supply, basis points, no unassigned remainder. |

An approval applies to one version of one decision; bumping a decision's version invalidates its approval. Approving a decision changes the policy hash and therefore the plan hash, so a recorded plan must be recorded again.

## 10. Decision dependency graph
```
SUPPLY_SEMANTICS ─┐
FEE_SPLIT_SCOPE ──┼─> SUPPLY_ALLOCATION_MODEL ─> ALLOCATION_LOCKS_AND_VESTING ─> LIQUIDITY_STRATEGY ─┐
                  │                                                                                  ├─> FEE_ROUTING_MECHANISM ─> PROTOCOL_DESTINATION
FEE_SPLIT_SCOPE ──┴──────────────────────────────────────────────────────────────────────────────────┘          │                         │
TOKEN_PROGRAM ──────────────────────────────────────────────────────────────────────────────────────────────────┘                         │
FEE_ROUTING_MECHANISM + FEE_SPLIT_SCOPE + TAX_RESERVE_MODEL ─> TAX_RESERVE_FUNDING                                                          │
CHARITY_PAYOUT_MODEL ─> CHARITY_VERIFICATION_GOVERNANCE                                                                                    │
(FEE_ROUTING, LIQUIDITY, MINT_KEY) ─> SECURITY_REVIEW; (FEE_ROUTING, LIQUIDITY) ─> SMART_CONTRACT_REVIEW; (FEE_SPLIT_SCOPE, CHARITY_GOVERNANCE, TAX_RESERVE_FUNDING) ─> LEGAL_REVIEW
```
Decide in this order: fee split scope, supply semantics approval, supply allocation model, locks and vesting, liquidity venue, fee routing mechanism, protocol destination, then funding, governance, reviews. Metadata hosting and the engineering default approvals are independent and can be decided at any time.

Milestones (`MILESTONES` in code; a milestone is unblocked only when its own decisions are approved and every earlier milestone is unblocked; decisions are necessary, never sufficient, because engineering prerequisites remain):

| Milestone | Waits on decisions | Comes after | Also needs (engineering) |
|---|---|---|---|
| `PLAN_EXECUTABLE`: a deployment plan can become executable | every decision except the three reviews | none | instruction builders for each decided design |
| `SIGNING`: wallet signing can be implemented | TOKEN_PROGRAM, MINT_KEY_STRATEGY, FEE_COMPUTE_POLICY, ENVIRONMENT_POLICY, SECURITY_REVIEW | PLAN_EXECUTABLE | serialization with a client-reported mint public key, signing UI, a migration widening attempt states |
| `MINT_CREATION`: mint creation can be implemented | SUPPLY_SEMANTICS, SUPPLY_ALLOCATION_MODEL, ALLOCATION_LOCKS_AND_VESTING, METADATA_DOCUMENT, METADATA_HOSTING, PROTOCOL_DESTINATION, CHARITY_PAYOUT_MODEL, TAX_RESERVE_MODEL | SIGNING | submission, confirmation, reconciliation |
| `LIQUIDITY_CREATION`: liquidity creation can be implemented | LIQUIDITY_STRATEGY, SUPPLY_ALLOCATION_MODEL, ALLOCATION_LOCKS_AND_VESTING, SMART_CONTRACT_REVIEW, SECURITY_REVIEW | MINT_CREATION | the venue's builder, pool and LP observation |
| `FEE_ROUTING`: fee routing can be implemented | FEE_SPLIT, FEE_SPLIT_SCOPE, FEE_ROUTING_MECHANISM, PROTOCOL_DESTINATION, CHARITY_PAYOUT_MODEL, CHARITY_VERIFICATION_GOVERNANCE, TAX_RESERVE_MODEL, TAX_RESERVE_FUNDING, the three reviews | LIQUIDITY_CREATION | the selected mechanism and its observation |
| `PROOF_VERIFIED`: Token Proof can reach VERIFIED for a real token | LIQUIDITY_STRATEGY, FEE_ROUTING_MECHANISM, METADATA_HOSTING, PROTOCOL_DESTINATION, CHARITY_PAYOUT_MODEL, TAX_RESERVE_FUNDING | MINT_CREATION, LIQUIDITY_CREATION, FEE_ROUTING | a privileged chain observer recording RPC observations |
| `MAINNET`: a mainnet launch can be permitted | every decision, including all reviews | PROOF_VERIFIED | audits and legal clearance recorded as evidence; a release decision |

## 11. Reviews (PENDING)
`SECURITY_REVIEW`, `SMART_CONTRACT_REVIEW` (applicable only if a custom program may exist) and `LEGAL_REVIEW` need a completed review with an evidence reference and date. None exists, none is claimed, and mainnet is blocked until all are recorded.

## 12. How this appears in the product
The deployment readiness screen and `GET /api/launches/:id/deployment-decision-summary` (owner only, read only) show, per decision: status, value, source, approver, approved at, dependencies, what is missing, and whether it blocks; and per milestone what it waits on. There is no admin bypass and no way for a client to approve anything. Readiness adds `PRODUCT_APPROVAL_COMPLETE`, which stays pending while any decided item lacks a recorded approval, and gates for locks, charity governance and tax reserve funding. `executionPermitted` remains the literal false and real execution is disabled.

## Decisions the product owner must make next
1. Do charity, tax reserve and protocol receive any token supply, or only fees?
2. Where does the rest of the supply go (for the fixture, 52%)?
3. Is the creator share transferable immediately, and is any share locked, vested or burned?
4. What exactly does 60/15/15/10 divide, and when?
5. Is a custom on-chain program acceptable, and must the split be verifiable on-chain?
6. Which liquidity venue and pair are approved, who owns and locks the LP position?
7. What is the protocol destination, who controls it, and who approves changes?
8. How is metadata hosted, and may creators update it after launch?
9. Who verifies real charities, on what evidence, and what happens on a wallet change or suspension?
10. Is the launch tax reserve a fee allocation, token supply or a USDC reserve, and is it funded or only designated?
11. Approve, reject or amend each engineering default in section 9.
12. Appoint who completes the security, smart-contract and legal reviews.
