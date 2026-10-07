# SMART_CONTRACTS

No contract exists and none is deployed. Slice 11 (launch configuration) deliberately writes no on-chain code and builds no transaction.

What the launch configuration records for a FUTURE contract flow (all configuration, none enforced on-chain):
- the fixed fee split 60/15/15/10 (6000/1500/1500/1000 bps);
- the selected registry charity id and the tax reserve allocation destination;
- authorities (mint, freeze, update) and liquidity parameters;
- a configuration fingerprint (sha256 over the canonical configuration) that a deployment must be compared against.

Open decisions (see docs/LAUNCHPAD.md): token program, authorities on-chain, liquidity pool program, fee-routing program, payout and custody mechanisms, immutability of the split. Do not describe the split as immutable until a contract makes it so.

## Token proof (Slice 12)
Still no contract and no deployment. The proof layer defines what a FUTURE deployment must make observable (mint, decimals, supply, authorities, metadata, pool and liquidity, fee routing to the creator, tax reserve, charity and protocol) and compares the observation with the configuration. Fee routing, liquidity and recipient checks are required for VERIFIED but cannot be observed until those programs exist. See docs/TOKEN_PROOF.md.

## Deployment plan (Slice 13)
Token program decision: SPL Token (classic); Token-2022 not implemented. Metadata: Metaplex Token Metadata. Mint address: a client-generated keypair whose private key never reaches the server. Authorities are explicit instructions (a mint-authority revoke after minting). No custom program exists and none is assumed for fee routing or liquidity; those are open decisions. Details and the full list of open decisions: docs/DEPLOYMENT_PLAN.md.
