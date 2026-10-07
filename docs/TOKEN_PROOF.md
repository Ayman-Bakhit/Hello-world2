# TOKEN_PROOF: transparency foundation (Slice 12)

Slice 12 builds the MODEL and the one authoritative rule for token proof. It is read-only and fixture-driven. It deploys nothing, mints nothing, creates no liquidity, moves no money, holds no keys, signs nothing, and does not poll a blockchain. Real Solana RPC is NOT VALIDATED here and no real token exists, so **no real launch is, or can currently become, VERIFIED**.

## Configured is not true
A launch configuration (Slice 11) is what the creator INTENDED. The fingerprint is a commitment to that configuration. Neither is blockchain proof. The proof layer keeps four things apart:

| Layer | Meaning | Where it comes from |
|---|---|---|
| CONFIGURED | the intended launch | the stored launch configuration |
| RECORDED | a deployment record: mint address, signature, the fingerprint it was deployed from | `token_proofs` (nothing writes it in production) |
| OBSERVED | what a chain read reported, with its own timestamp and source | `token_proof_observations` (nothing writes it in production) |
| COMPARED | deterministic checks of configured/recorded against observed | derived at read time by `evaluateProof` |

## Objective verification (the ONE rule)
`evaluateProof` (`packages/shared/src/proof.ts`) is the only place verification is decided. The server builds every response with it; the frontend formats and never decides; no request field, query string or body can influence it; there is no write endpoint. `verifiedOnChain` and `verifiedTransparency` are derived from check state and nowhere else.

A proof is **VERIFIED** only when every *required* check is PASS and the observation came from a blockchain read (`source: "RPC"`). The `OBSERVATION_FROM_CHAIN` check passes only for `RPC`; a `FIXTURE` observation yields UNAVAILABLE there, so a fixture can never reach VERIFIED however consistent it is. A value equal to itself is never a PASS: before any observation every comparison is UNKNOWN.

### Statuses
`NOT_DEPLOYED` (no deployment record: nothing to verify) · `AWAITING_OBSERVATION` (a record exists, no observation) · `PARTIAL` (some objective checks pass, required checks unknown or unavailable, or fixture data) · `VERIFIED` · `FAILED` (a required check fails) · `UNAVAILABLE` (the observation read nothing, or the stored history failed its integrity check).

### Check states
`PASS`, `FAIL`, `UNKNOWN` (not observed yet), `UNAVAILABLE` (the observer could not read it), `NOT_APPLICABLE` (informational; never required). UNKNOWN and UNAVAILABLE are never counted as PASS.

### Checks
`DEPLOYMENT_SIGNATURE_PRESENT`, `OBSERVATION_FROM_CHAIN`, `NETWORK_MATCH`, `MINT_ADDRESS_MATCH`, `DECIMALS_MATCH`, `SUPPLY_MATCH` (exact u64 base units via BigInt), `MINT_AUTHORITY_MATCH`, `FREEZE_AUTHORITY_MATCH`, `METADATA_MATCH` (on-chain name and symbol only), `CONFIGURATION_FINGERPRINT_MATCH`, `FEE_SPLIT_MATCH`, `CHARITY_MATCH`, `TAX_RESERVE_DESTINATION_MATCH`, `PROTOCOL_ALLOCATION_MATCH`, `CREATOR_ALLOCATION_MATCH`, `LIQUIDITY_CONFIGURATION_MATCH`, `METADATA_CONTENT_NOT_FETCHED` (NOT_APPLICABLE). Every one except the last is required for VERIFIED, so VERIFIED is unreachable until an observer supplies fee-routing and liquidity observations too.

## Fingerprint semantics
- CONFIGURED fingerprint: the current `launchFingerprint` of the stored configuration (Slice 11, reused; no second fingerprint exists).
- Deployed fingerprint: what the deployment record says it was built from.
- COMPARISON: match / mismatch / unknown (no deployed fingerprint recorded). A changed charity, supply, decimals, authority, fee split or reserve destination changes the fingerprint and the corresponding field comparison (tested).
- A fingerprint is a commitment, not a blockchain proof. It does not say anything is on-chain.

## Metadata provenance
Provenance values: `CONFIGURED`, `USER_PROVIDED`, `DEPLOYMENT_RECORD`, `FIXTURE`, `OBSERVED_ON_CHAIN`, `VERIFIED_MATCH`, `UNAVAILABLE`. Description, image and links are USER_PROVIDED and are never marked verified because the creator typed them; only on-chain name and symbol are compared. URLs are validated and shown as text links; nothing is fetched and no remote image is loaded. Everything is rendered escaped; on-chain Metaplex metadata is treated as untrusted text.

## API (read-only)
- `GET /api/launches/:id/proof`: owner, authenticated, `Cache-Control: no-store`; a foreign and an unknown id are the same 404.
- `GET /api/public/launches/:id/proof`: only READY and published launches; everything else is an indistinguishable 404. The public form shows an abbreviated creator, no tax reserve destination or recipient, no user id, session or secret.
- No `POST`/`PUT`/`PATCH`/`DELETE` exists under any proof path. The privileged writers (`recordProofRecord`, `appendObservation` in `apps/api/src/db/proofRepos.ts`) are not imported by any route (a test asserts this).
- A launch with no proof record is NOT_DEPLOYED, with no mint, signature, explorer link or observed timestamp (all null; `explorerUrl` is always null: no explorer URL is generated).

## Database (`db/migrations/009_token_proof.sql`, additive)
- `token_proofs`: one per launch; base58-checked mint and signature, hex fingerprint; requires a READY launch on the same network; append-only (UPDATE and DELETE rejected by trigger).
- `token_proof_observations`: append-only and hash-chained (`prev_hash`, `row_hash`); `observed_at` may not be in the future; `FIXTURE` observations belong to `demo` proofs only and demo proofs take only `FIXTURE`. The read path re-verifies the whole chain; a broken chain makes the proof UNAVAILABLE and the observation is discarded.
- These are tamper-evident records for auditability. They are not a blockchain proof and not described as immutable (a database superuser can bypass the triggers; the hash chain then exposes it).

## Fixtures (A to J)
`NOT_DEPLOYED`, `DEPLOYED_BUT_UNOBSERVED`, `FULL_MATCH`, `SUPPLY_MISMATCH`, `DECIMALS_MISMATCH`, `AUTHORITY_MISMATCH`, `NETWORK_MISMATCH`, `PARTIAL_OBSERVATION`, `MISSING_METADATA`, `UNAVAILABLE_OBSERVATION` (`packages/shared/src/demo/proofFixtures.ts`). Deterministic, base58-shaped, labeled DEMO / FIXTURE / NOT VERIFIED ON-CHAIN. Even FULL_MATCH is PARTIAL PROOF. They are served only by mock mode (the public proof page of the demo launch has a scenario picker, hidden in API mode); the API's production path never reads them, and the database refuses fixture observations on non-demo proofs. A pure unit test feeds the same observation as `RPC` to show the machinery reaching VERIFIED; nothing persists that in demo or mock.

## Existing demo Token Proof / Discover
The Slice 3 demo token page used to let the frontend decide "VERIFIED TRANSPARENCY". It now formats a server field: `TokenSummary.verifiedTransparency` and `TokenProof.verifiedTransparency`, computed by `tokenVerifiedTransparency` (false for every demo token). The Discover "Verified Transparency" filter matches that flag, so it returns no demo token; "all checks reported" is a creator's own disclosure and is labeled as reported.

## Frontend
TOKEN PROOF header; status NOT DEPLOYED / AWAITING OBSERVATION / PARTIAL PROOF / VERIFIED TRANSPARENCY / VERIFICATION FAILED / PROOF UNAVAILABLE; sections A Identity, B Configuration, C Observed On-Chain, D Verification Checks, E Mismatches, F Provenance, G Disclosure. The public page opens with plain-words answers: what was promised, what was observed, do they match, what could not be verified. Unavailable values read UNAVAILABLE with a reason, never `$0`/`false`.

## NOT implemented
Minting, real deployment, liquidity creation or migration, fee routing, payouts, transfers, key handling, custody, signing, automatic transactions, real RPC polling as a production dependency, any real mainnet or devnet verification claim, explorer links, fetching off-chain metadata or images.

## Future work (design boundary, not built)
- **Real RPC observation**: a privileged observer reads the mint account (decimals, supply, authorities), the metadata account, the pool and the fee-routing accounts and appends a `RPC` observation with the chain's own slot time. That observer, its trust model and its failure handling need their own slice.
- **Deployment reconciliation**: the deployment slice records the mint and signature and the fingerprint it built from; the proof compares it to the current configuration and to what the chain reports. A configuration edited after deployment already fails the fingerprint check.
- **Liquidity verification**: needs the pool program decision (LAUNCHPAD.md); until then liquidity cannot be observed, so VERIFIED stays unreachable.
- **Fee-routing verification**: needs the fee-routing program and how 60/15/15/10 is enforced on-chain.
- **Charity, reserve and protocol routing verification**: needs the recipient addresses to be observable. No protocol address is configured, so only the protocol share (bps) is compared. The charity comparison uses the registry wallet only when exactly one verified wallet exists; otherwise it is UNKNOWN.

## Caveats
Real Solana RPC is not validated from this environment; no real token or verification exists; charity wallets and verification are fixture/admin driven; user-provided metadata is unverified.

## Expected state from the deployment plan (Slice 13)
`DeploymentPlan.expectedState` (and `expectedStateForProof`) restate what a deployment is expected to produce, in the proof's terms (network, decimals, supply in base units, final authorities, name and symbol, configured fee bps, configuration fingerprint, plan hash). A test shows it agrees with `evaluateProof`'s expectations for the same configuration. It is EXPECTED, not observed, and verifies nothing; VERIFIED still needs a real on-chain observation. See docs/DEPLOYMENT_PLAN.md.
