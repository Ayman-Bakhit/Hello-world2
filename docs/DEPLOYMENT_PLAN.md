# DEPLOYMENT_PLAN: deployment architecture and transaction construction (Slice 13)

Slice 13 answers: "If a user later approves a launch, exactly which transactions would their wallet sign, which accounts would be affected, which authorities would be created or revoked, and what should the chain look like afterward?" It builds and reviews that plan. **It executes nothing.** No token is minted, no transaction is signed, serialized, sent or confirmed, no key is handled, no liquidity or payout exists, and no funds move. The plan is BLOCKED today, for reasons listed below, and a BLOCKED plan is the truthful output.

## BUILD, SIGN, SEND, CONFIRM, RECONCILE, VERIFY
| Step | Meaning | Status |
|---|---|---|
| BUILD | construct the intended transactions from the reviewed launch | implemented as a structured plan (instructions, accounts, signers, boundaries); not serialized |
| REVIEW | a human-readable description generated from that same plan | implemented |
| SIGN | the user's wallet signs locally | NOT implemented |
| SEND | a signed transaction is submitted | NOT implemented |
| CONFIRM | the network confirms it | NOT implemented |
| RECONCILE | observed chain state is compared with the expected state | NOT implemented (the expected state exists) |
| VERIFY | Token Proof (Slice 12) decides whether reality matches the configuration | exists, but has no observer yet |
Building a plan, or a transaction that would serialize, is not deployment and says nothing about safety.

## Token program decision
**SPL Token (classic), program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`.** Token-2022 and its extensions are NOT implemented and are refused with `UNSUPPORTED_TOKEN_PROGRAM`. The program is recorded in the plan identity rather than hidden, and a different program is a new, reviewed decision. (The launch configuration has no token-program field, so Slice 11 fingerprints are unchanged; the selection lives in the builder.)

## The plan (`packages/shared/src/deployment.ts`)
`buildDeploymentPlan` is pure: no I/O, clock or randomness. Input is the authoritative stored launch plus the registry charity; the request carries no parameters. Output is a plan or `BUILD_ERROR`s.
- Identity: launch id, network, token program, creator wallet, plan version, builder version, plan id, plan hash, configuration fingerprint, reviewed fingerprint.
- Token, authorities, metadata, supply allocations, fee allocations, destinations, transactions and instructions (ordered, with accounts, signers, writable and read-only sets, dependencies), movements, compute and rent (explicitly NOT MEASURED / REQUIRES RPC), signing boundary, expected post-deployment state.
- **Plan hash**: sha256 over the canonical plan (every semantic field; no timestamps, revision counters or random values). A changed configuration, charity wallet, decision or instruction changes it; `createdAt`, `updatedAt`, `readyAt` and review time do not. The plan id is `launchId:vN:hash16`.
- **Idempotency**: the hash is derived from the configuration fingerprint, so a changed launch yields a new plan and the old one stops being current. Recorded plans (`deployment_plans`) are append-only, unique per (launch, hash); recording the same plan twice is a no-op; plans for older hashes remain as history and are reported as `supersededPlans`. A previous plan is never silently reused.

## READY gate (server side)
Only a READY launch whose review fingerprint equals its current fingerprint, recomputed from the stored configuration, can produce a plan. Refused: DRAFT, CONFIGURED, REVIEW, CANCELLED (`LAUNCH_NOT_READY`, 409), a missing, failed, stale or post-review-modified review (`STALE_REVIEW`, 409), an unknown or foreign launch (404), and invalid network, supply, decimals, authority policy, fee split, addresses, charity, or allocations (422, with the build error code). The client cannot supply parameters; the POST body must be empty.

## Precision
All quantities are BigInt strings (never floats). Decimals 0 to 9. `supply x 10^decimals` must fit a u64 (checked at the boundary: 18446744073 at 9 decimals builds, 18446744074 does not). The creator and liquidity shares must be exact whole base-unit amounts; a share that would need rounding is `PRECISION_LOSS`; shares above 100% are `ALLOCATION_OVERFLOW`. Exponent notation, NaN, Infinity, negatives and fractions are refused.

## Allocation semantics (and what is NOT decided)
Three different things are kept apart: **token supply allocation**, **fee allocation** (the 60/15/15/10 split, reused from `CANONICAL_FEE_SPLIT`, a configuration), and **future fee routing**. The configuration defines a creator share and a liquidity share of supply. It does not define where the remainder goes. The plan shows that remainder as `UNASSIGNED` / `UNDEFINED` and blocks minting (`ALLOCATION_MODEL_UNDEFINED`). No formula is invented, and the charity, tax reserve and protocol receive no token supply in the plan.

## Authorities
Mint authority: the creator holds it during deployment (needed to mint). If the policy is `disabled`, an explicit `setAuthority(MintTokens, none)` instruction (`revoke-mint-authority`) runs after the supply is minted; the expected end state is none, and until that instruction executes the creator still holds it. Freeze authority: `disabled` means no freeze authority is set at mint initialization, so no revoke instruction exists. Update authority: the creator, and metadata is created mutable unless the policy is `disabled`. Nothing is called "immutable".

## Metadata
Metaplex Token Metadata (`metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`), `createMetadataAccountV3`, name and symbol from the configuration, seller fee 0, no creators or collection. The metadata URI is **undecided** (`METADATA_URI_UNDEFINED`), so the instruction is blocked. Nothing is fetched or loaded; metadata stays USER_PROVIDED and `verified: false`; the account (a PDA of the mint) is not computed because the mint is unknown.

## Mint address strategy
**Client-generated keypair.** The mint keypair is generated in the wallet context at signing time; its private key never reaches the server, and the server never generates or stores one. The mint address is therefore `null` in the plan and in the expected state, and metadata and token-account addresses (derived from it) are `null` with a note. Nothing is invented; Slice 14 must define how the client reports the public key.

## Destinations
Creator, tax reserve (from the launch configuration), charity (the registry wallet, only when exactly one verified, well-formed wallet exists; otherwise `CHARITY_DESTINATION_UNRESOLVED`), protocol (no address configured: `PROTOCOL_DESTINATION_NOT_CONFIGURED`), liquidity (reserved). Each shows role, address, provenance and validation. Addresses must be base58 that decode to exactly 32 bytes. No destination is derived from a label.

## Liquidity
`LIQUIDITY_BUILD_NOT_IMPLEMENTED`. The configured amounts, supply share and lock days are shown. No venue, pool address, LP representation or liquidity transaction is invented.

## Fee routing
The split is a database configuration (`not_enforced`). The plan states `NOT_IMPLEMENTED`, no program, no on-chain enforcement (`FEE_ROUTING_NOT_IMPLEMENTED`). No program id is assumed or fabricated. Whether it needs a custom program, router or AMM integration is an open decision.

## Expected post-deployment state
`expectedState` (labeled `EXPECTED_NOT_OBSERVED`): network, token program, decimals, supply in base units, final mint and freeze authority, metadata, allocations, destinations, fee routing (not implemented, configured bps), liquidity (not implemented), configuration fingerprint and plan hash. `expectedStateForProof` projects it into Slice 12's terms, and a test shows it agrees with what the proof evaluator expects for the same configuration. It is the bridge: Slice 13 EXPECTED, Slice 14 ACTUAL, Slice 12 OBSERVED and compared. By itself it proves nothing.

## User signing boundary (for Slice 14)
Server: validates the launch and builds the unsigned plan. Browser and wallet: show the review, sign locally. Then: submit, track the signature, confirm, reconcile. In this slice `serverSigns`, `serverHoldsKeys` and `serverAcceptsKeyMaterial` are literal `false` in the schema, a global request hook refuses key-material field names (`SECRET_MATERIAL_REJECTED`; only names are inspected, values are never echoed), no route imports a signing or sending API (a test scans the sources), and the plan carries no serialized transaction (it would need the mint public key and a blockhash, both unknown until signing).

## Failure model
Stages: `BUILD_ERROR` (implemented: `LAUNCH_NOT_READY, STALE_REVIEW, INVALID_NETWORK, INVALID_SUPPLY, INVALID_DECIMALS, INVALID_AUTHORITY_POLICY, INVALID_FEE_SPLIT, INVALID_ADDRESS, UNSUPPORTED_TOKEN_PROGRAM, PRECISION_LOSS, ALLOCATION_OVERFLOW, CHARITY_NOT_FOUND, CHARITY_NOT_VERIFIED`), then `SIGNING_ERROR`, `SUBMISSION_ERROR`, `CONFIRMATION_ERROR`, `RECONCILIATION_ERROR`, whose codes are listed (`FUTURE_FAILURES`: user rejected, wallet mismatch, insufficient SOL, transaction too large, compute exceeded, blockhash expired, RPC unavailable, confirmation timeout, state mismatch) and are not implemented or faked.

## API (owner only; no public plan)
- `GET /api/launches/:id/deployment-plan` returns `{ plan, review, recorded, supersededPlans }`; `GET /api/launches/:id/deployment-review` returns the review; `POST /api/launches/:id/deployment-plan` (empty body) records the current plan (201 new, 200 existing). `no-store`; foreign equals unknown (404).
- There is no sign, send, submit, deploy, execute, broadcast or confirm endpoint (a test probes each).

## Database (`010_deployment_plans.sql`, additive)
`deployment_plans`: one row per (launch, plan hash), the canonical plan as jsonb, append-only. Constraints: the stored plan must say `executionEnabled=false`, `mint.address=null`, `serverSigns=false`, and its hash and fingerprint must equal the columns; a trigger requires a READY launch whose current fingerprint equals the plan's, recorded by the launch owner. No unsigned transaction bytes and no key material are stored (none exist). Tamper-evident auditability only.

## RPC
No RPC is used: the plan needs none, and values that would need it (rent, compute, blockhash) are explicit `null` / `NOT_MEASURED`. When a later slice reads the cluster, fixture and real observations must stay distinguishable (as in Slice 12) and server RPC credentials must stay server-side.

## What Slice 13 does NOT implement
Minting, deployment, signing, sending, confirming, reconciling, serializing transactions, wallet integration for signing, liquidity, fee routing, payouts, key handling, custody, rent or fee estimation, simulation, Token-2022, off-chain metadata hosting or fetching.

## OPEN DEPLOYMENT DECISIONS
1. **Initial supply allocation model**: where the supply beyond the creator and liquidity shares goes; whether charity, reserve or protocol receive tokens at all. (Blocks `mintTo`, the creator token account and the mint-authority revoke.)
2. **Metadata JSON hosting**: the URI and who maintains it. (Blocks the metadata instruction.)
3. **Protocol destination**: address and custody.
4. **Liquidity**: venue, pair (token/SOL or token/USDC), LP position handling, lock mechanism.
5. **Fee routing**: custom program, router or AMM integration; how 60/15/15/10 is enforced; whether it can ever change.
6. **Mint public key reporting**: how the client reports the mint public key to the server without the server ever holding a key.
7. **Charity wallet resolution**: exactly one verified registry wallet per charity.
8. **Rent, fee and compute policy**: who pays, how estimated, how simulated.
9. **Token-2022**: whether any extension is wanted (today: no).
10. **Mainnet gating**: audit and legal review (see MVP_PLAN gates).

## Slice 14 additions
Plans now carry the policy hash and version, the cluster environment (id, programs, RPC environment label, execution not allowed), the metadata document sha256, and an expected liquidity that is separate from observed liquidity. The plan hash includes the policy hash, so a changed decision makes an earlier plan stale. Readiness (`GET /api/launches/:id/execution-readiness`) evaluates the plan together with every decision: see docs/DEPLOYMENT_DECISIONS.md. The ten open decisions listed above are now represented as decision records: token program decided (SPL Token), mint key flow decided (public key only), fee/compute policy decided, metadata document decided; supply allocation, metadata hosting, protocol destination, liquidity and fee routing remain PENDING.
