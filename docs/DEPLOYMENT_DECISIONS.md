# DEPLOYMENT_DECISIONS: economics and execution readiness (Slice 14)

> **Canonical source: docs/PRODUCT_DECISIONS.md.** That record is authoritative for what is decided, pending and approved, and for what each decision blocks. This file keeps the Slice 14 explanation of the mechanics. Where numbers differ, PRODUCT_DECISIONS.md and the code win: the policy is now version 3 with 22 decisions, after product owner decision pass 1 (2026-10-07).

Slice 14 turns every open deployment question into either a typed, versioned, tested decision or an explicit PENDING decision that blocks readiness. **Real execution stays disabled.** Nothing is signed, sent, confirmed or deployed, no program is deployed, no key is handled, and no funds move. A blocked launch is a correct result when the blocker is real.

Source of truth: `packages/shared/src/deploymentPolicy.ts` (`DEPLOYMENT_POLICY`, now 21 decision records) and `packages/shared/src/readiness.ts` (`evaluateExecutionReadiness`). This file explains them; it does not replace them. Each decision has an id, value, status (`DECIDED` or `PENDING`), version, provenance (`EXISTING_CONFIGURATION`, `ENGINEERING_DEFAULT`, `NONE`), the clusters it applies to, whether changing it invalidates readiness (always yes), and, when pending, exactly what is missing. "Engineering default" means a conservative technical default chosen in code and tested, not a product or legal approval.

Counts today: **12 DECIDED, 10 PENDING, 11 without product approval** (Slice 14 recorded 8 decided and 9 pending; pass 1 decided supply allocation, fee split scope and the fee routing choice and added the burn mechanism).

## A. Token economics (initial supply allocation): PENDING
Slice 11 defines a creator share and a liquidity share of supply (in the fixture: 8% and 40%). It does not say where the remaining 52% goes, and that is not derivable from the fee split. The decision `SUPPLY_ALLOCATION_MODEL` is PENDING. The code is ready for it: `SupplyAllocationModel` adds charity, tax reserve, protocol and burn shares in basis points, and `resolveSupplyAllocation` requires that creator + liquidity + charity + tax reserve + protocol + burn equal exactly **10000 bps** (whole numbers, non-negative; property-tested). Until a model is decided, `SUPPLY_ALLOCATION_DEFINED` and `ALLOCATIONS_SUM_10000_BPS` block readiness and the plan keeps the remainder UNASSIGNED. Initial token supply allocation and the fee split are different economic concepts and are never mixed.

## B. Fee economics: split DECIDED, scope and enforcement PENDING
- `FEE_SPLIT` (DECIDED, from existing configuration): creator 6000, tax reserve 1500, charity 1500, protocol 1000 bps, sum 10000. Any other split is refused (`FEE_SPLIT_VALID`), even if a decision record and a launch agree on it: changing the split is a product decision that must change the canonical definition.
- `FEE_SPLIT_SCOPE` (PENDING): which revenue stream and asset the split divides (launch proceeds, creator fees, trading fees, protocol fees, liquidity fees, or another). Not assumed.
- `FEE_ROUTING_MECHANISM` (PENDING): application-level routing, DEX or router configuration, fee vault, or a custom on-chain program. **FEE_ROUTING_ENFORCEMENT_NOT_IMPLEMENTED**: no mechanism exists, so the database split is configuration only. Words such as enforced, immutable, guaranteed and automatic are not used for it. The gate `FEE_ROUTING_ENFORCEABLE` passes only when a decided mechanism is marked implemented and enforcing, which no code or test outside the TEST-ONLY policy does.

## C. Protocol custody: PENDING (`PROTOCOL_DESTINATION_PENDING`)
Needed: an approved address, who controls it (multisig, program-controlled or other), whether it can change, per-cluster values, and how it is verified. No developer, fixture or random address stands in for it. When decided, the gate also requires a valid 32-byte address, a control model and a named approver. The product is non-custodial for user assets; nothing here introduces protocol-side custody of user funds.

## D. Charity payout model: DECIDED
`CHARITY_PAYOUT_MODEL = ONE_VERIFIED_WALLET_PER_CHARITY`: the charity is VERIFIED, exactly one verified, well-formed payout wallet exists, that address is in the plan and expected state, and any change to it changes the plan hash so a plan recorded earlier is stale (`PLAN_RECORDED_CURRENT`). Zero or several verified wallets leave it unresolved and block. No donation is executed.

## E. Tax reserve model: DECIDED
`TAX_RESERVE_MODEL`: the launch tax reserve allocation is a creator-controlled address in the launch configuration. It is unrelated to a user's personal Tax Reserve and shares none of its tables. The asset it receives depends on the pending fee split scope.

## F. Liquidity: PENDING
`LIQUIDITY_STRATEGY` needs: venue, pool type, quote asset, token and quote amounts, LP ownership, lock or burn and its duration, unlock authority, how the pool is observed and identified for Token Proof. No pool or lock is invented. Expected and observed liquidity are separate fields in the expected state (`LIQUIDITY_EXPECTED` and `liquidityObserved`, null). Even when a venue is named, the gate stays blocked with `LIQUIDITY_BUILD_NOT_IMPLEMENTED` until its builder exists.

## G. Metadata: document DECIDED, hosting PENDING
- `METADATA_DOCUMENT` (DECIDED): Metaplex-style JSON with name, symbol, description, image (if set), external_url (if set) and `seller_fee_basis_points: 0`; canonicalized with sorted keys and compact UTF-8; **sha256 of the canonical document** is recorded in the plan and expected state so Token Proof can compare configured with observed metadata. The URI is not content-addressed. Updates follow the update authority policy of the launch configuration.
- `METADATA_HOSTING` (PENDING): where the JSON is hosted, who controls it, versioning, whether the URI can change. Nothing is fetched or published, and nothing may be claimed about decentralization or permanence until true.

## H. Token program: DECIDED (SPL Token classic)
No V1 feature needs a Token-2022 extension (no transfer fee, metadata pointer, permanent delegate or confidential transfer requirement; metadata uses Metaplex). One program per launch, recorded in the policy, plan, expected state and readiness. If fee enforcement later needs the Token-2022 transfer-fee extension, that is a new decision with its own version.

## I. Mint strategy: DECIDED
The browser generates the mint keypair and keeps the private key. The server receives only the mint public key, validates it (32-byte address; not a program or an address already used as a destination; a value that decodes to 64 or more bytes is refused as secret-key shaped and is never stored or echoed) and would bind it to one plan. The mint account signs its own creation, a Solana requirement, so it is modeled as a client-held signer. The server never receives a private key, secret key, seed phrase or mnemonic. No endpoint accepts the public key yet; reporting it belongs to the execution slice. (`validateMintPublicKey`, and the attempt record stores the public key only.)

## J. Fee and compute policy: DECIDED
The creator wallet pays rent and network fees; the platform pays nothing; no priority fee in V1; compute comes from a runtime simulation; at most two transactions within the 1232-byte limit; no retry without the user; fee figures are ESTIMATES until confirmed, and no lamport amount is hard-coded.

## K. Environment policy: DECIDED
Clusters: `local-fake` (tests only, cannot host a launch), `devnet`, `mainnet-beta`. Every plan carries its cluster, environment id, expected program ids and RPC environment label; `assertPlanCluster` refuses a plan on another cluster; an attempt's environment must equal the launch network (database trigger). `mainnet-beta` additionally requires the security, smart-contract and legal reviews (`CLUSTER_VALID`). Server RPC credentials never go to the browser.

## L. Deployment state machine
Launch configuration state (DRAFT, CONFIGURED, REVIEW, READY, CANCELLED) is unchanged and is not an attempt state. A **deployment attempt** is a separate, append-only record (`deployment_attempts` and hash-chained `deployment_attempt_events`): PLAN_BUILT, AWAITING_SIGNATURE, SIGNED, SUBMITTED, CONFIRMING, CONFIRMED, RECONCILING, VERIFIED, FAILED, CANCELLED, with a closed transition table and failure categories. A READY launch can have no attempt, and a failed attempt never rewrites the launch. Today the database and the writers can record only PLAN_BUILT, FAILED and CANCELLED, signatures cannot be stored, no route creates an attempt, and the later states are not representable until a reviewed migration widens the constraints.

## M. Security gate: PENDING
`SECURITY_REVIEW` of the signing and deployment path. Requires an evidence reference and completion date. None exists.

## N. Legal gate: PENDING
`LEGAL_REVIEW` (money transmission, securities, charitable solicitation, tax reporting, sanctions). None exists. Nothing in this repository is legal approval.

## O. Audit gate: PENDING
`SMART_CONTRACT_REVIEW` applies only if a custom on-chain program may exist; it is PENDING because the fee routing and liquidity designs are undecided, and NOT APPLICABLE only once decisions rule a custom program out. No audit report exists or is implied.

## Execution readiness
`evaluateExecutionReadiness` returns 28 gates (23 in Slice 14; later added locks, charity governance, tax reserve funding, product approval and the burn mechanism), each with status (`PASS`, `BLOCKED`, `PENDING`, `NOT_APPLICABLE`), reason, provenance, category (product, technical, security, legal), what must be decided, and a blocking flag. The overall answer is `BLOCKED` or `EXECUTION_DISABLED` (every prerequisite passes, but the last gate, `REAL_EXECUTION_ENABLED`, never does). `executionPermitted` is the literal `false`. Inputs are the stored launch, the registry charity, the policy and the recorded plan state; no client field, query, or body can change it (tested).

Change invalidation reuses the existing mechanisms: the launch fingerprint (configuration), the plan hash (which includes the policy hash, destinations, cluster and metadata document hash) and the recorded-plan gate. A changed decision, charity wallet or configuration makes an earlier plan stale.

## Execution hard gate
`REAL_EXECUTION_ENABLED = false` is a server-side constant (not a frontend variable). The API refuses to start if the environment variable of that name is anything but `false`. `assertExecutionDisabled` throws for anything that would sign, send or confirm; the attempt writer calls it for any state implying execution. No route exists for signing, sending, submitting, broadcasting, confirming, approving or starting an attempt (probed), and a source scan asserts no route can.

## P. Remaining blockers
1. Initial supply allocation model (A).
2. Fee split scope (B).
3. Fee routing mechanism and its enforcement (B).
4. Protocol destination and custody (C).
5. Liquidity venue and builder (F).
6. Metadata hosting and URI (G).
7. Security review (M).
8. Smart-contract review, if a custom program is chosen (O).
9. Legal review (N).
10. Product approval of the engineering defaults (token program, mint key flow, fee/compute policy, metadata document format, environment policy).
11. The execution slice itself: reporting the mint public key, signing, submission, confirmation, reconciliation and the migration that widens attempt states.
