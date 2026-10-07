# SMART_CONTRACTS

No contract exists and none is deployed. Slice 11 (launch configuration) deliberately writes no on-chain code and builds no transaction.

What the launch configuration records for a FUTURE contract flow (all configuration, none enforced on-chain):
- the fixed fee split 60/15/15/10 (6000/1500/1500/1000 bps);
- the selected registry charity id and the tax reserve allocation destination;
- authorities (mint, freeze, update) and liquidity parameters;
- a configuration fingerprint (sha256 over the canonical configuration) that a deployment must be compared against.

Open decisions (see docs/LAUNCHPAD.md): token program, authorities on-chain, liquidity pool program, fee-routing program, payout and custody mechanisms, immutability of the split. Do not describe the split as immutable until a contract makes it so.
