# PRODUCT_ECONOMICS_OPTIONS: concrete options for each open decision

Analysis only. This document lays out 2 to 4 concrete options for each open product decision so the product owner can choose. **It chooses nothing and approves nothing.** No option here is implemented, and real execution stays disabled. The canonical record of what is decided is `docs/PRODUCT_DECISIONS.md`; the questionnaire to answer is `docs/PRODUCT_OWNER_DECISIONS.md`.

How to read each option: **What it means** (the product behavior), **Needs** (what must exist for it to be real), **Tradeoffs** (what you gain and what you accept), **Verifiable?** (whether an outsider could confirm it from on-chain data). Statements about third-party venues describe categories, not any named product: no venue has been selected or assessed.

Source material: `docs/PRODUCT_DECISIONS.md`, `packages/shared/src/deploymentPolicy.ts` (policy v2), the Slice 11 launch configuration (`creatorAllocationPercent`, `liquidityConfiguration.supplyPercentage`, `initialLiquidityUsdc`, `lockDays`, the fixed 6000/1500/1500/1000 fee split, `taxReserveConfiguration` as `creator_controlled`), and the Slice 3 demo token data.

Facts that shape every option:
- The configuration defines only a creator share and a liquidity share of supply. In the reference fixture that is 8% and 40%, so **52% has no stated recipient**.
- Supply must be fully assigned: roles sum to exactly 10000 bps, with burn as an explicit role (decided as an engineering default, not yet product-approved).
- A plain SPL token enforces no revenue split. Any split is only as real as the mechanism that moves the money.
- The existing copy describes the charity, tax reserve and protocol shares as fee allocations, not token allocations.

---

## 1. Do charity, tax reserve and protocol receive any token supply?
| | Option | What it means | Needs | Tradeoffs | Verifiable? |
|---|---|---|---|---|---|
| A | **Fees only: 0 bps of supply for all three** | The 15/15/10 shares exist only as fee/revenue allocations. Supply roles are creator, liquidity and (per decision 2) the remainder | Decision 2 for the remainder; fee scope (decision 4) | Matches the existing copy; simplest supply story; charity and protocol get nothing from the token itself | Supply: yes (token accounts). Fees: depends on decision 5 |
| B | **Charity and tax reserve get fees, protocol gets a supply share** | The protocol holds some tokens as well as 10% of fees | A protocol destination (decision 7); an allocation bps for protocol | Aligns protocol incentives with the token; adds a holder the market can see and may sell | Yes for supply |
| C | **All three receive a supply share as well as fees** | Each of the three holds tokens in addition to its fee share | Three destinations, three bps values, lock rules (decision 3) | Most aligned with "stakeholders hold the token"; most complex; creates sell pressure and disclosure obligations | Yes for supply |
| D | **Supply instead of fees for some of them** | e.g. the charity is paid in tokens, not fees | A model that replaces a fee bucket | Changes the meaning of 60/15/15/10; invalidates the fee split definition | Yes |

## 2. Where does the rest of the supply go (the 52% in the fixture)?
| | Option | What it means | Needs | Tradeoffs | Verifiable? |
|---|---|---|---|---|---|
| A | **All non-creator supply seeds liquidity** | Liquidity share becomes 100% minus the creator share; nothing else is minted to anyone | A liquidity design able to take that amount (decision 6); a larger liquidity share in the configuration | One simple rule, no other holder at launch; the pool is the only source of tokens; depends heavily on the venue | Yes, via the pool and supply accounts |
| B | **The remainder is burned** | Supply that nobody receives is destroyed at launch (an explicit BURN role) | The burn mechanism and its observation | Fixed, smaller effective supply; the burned share is visible but irreversible | Yes, if burn is observable |
| C | **The remainder goes to a named controlled destination** | A treasury or distribution wallet holds it | The destination, its control model and release rules (decisions 3 and 7) | Flexible for later distribution; creates a large concentrated holding that must be disclosed and locked to build trust | Yes for the balance; its use is not verifiable |
| D | **Split across several of the above** | e.g. part to liquidity, part burned | Bps for each role summing to 10000 | Most flexible; most to explain | Yes |

## 3. Is the creator share transferable, locked or vested; is anything else locked or burned?
| | Option | What it means | Needs | Tradeoffs | Verifiable? |
|---|---|---|---|---|---|
| A | **Immediately transferable, no locks** | The creator can move or sell their share at once | Nothing new | Simplest; weakest trust signal; no lock mechanism needed | n/a |
| B | **Creator share locked for a fixed period** | Tokens cannot move until a date | A lock mechanism (program or custody service); duration; who can release | Stronger trust signal; requires building or choosing a lock; adds a release authority to audit | Yes if the lock is on-chain |
| C | **Creator share vests over time** | Released in steps | A vesting mechanism and schedule | Aligns the creator long term; most complex; schedule must be disclosed | Yes if on-chain |
| D | **Locked or burned for other roles too** | Treasury or remainder shares also locked or burned | A rule per role | Most protective; most mechanism required | Yes if on-chain |

No lock or vesting mechanism exists in the product today, and any option other than A requires choosing one.

## 4. What exactly does 60/15/15/10 divide, and when?
| | Option | What it means | Needs | Tradeoffs | Verifiable? |
|---|---|---|---|---|---|
| A | **Trading fees collected on the launch venue** | Fees the pool charges on each swap, split repeatedly after launch | A venue whose fee flow can be directed; decision 5 | Ongoing revenue; depends on the venue's fee model and whether the creator can receive or redirect those fees | Only if fee flows are observable |
| B | **Creator fees from a third-party venue** | Only the portion of fees the venue grants to the creator is split | A venue with a creator-fee feature | Smaller base; not controlled by the platform | Depends on the venue |
| C | **Launch proceeds, once** | Any amount raised at launch is split once | A defined proceeds source (the product has none today) | One-time; needs a sale or raise the product does not have | Yes if proceeds move on-chain |
| D | **A platform-defined revenue stream** | e.g. a fee the protocol itself charges | A defined stream and a payer | Fully designable; invents a new fee users must accept; legal review likely | Depends on design |

For any option the answer must also say: who pays, when it splits, whether it is per transaction, whether it applies to volume or actual fees, and what happens if the venue cannot support the split.

## 5. How is the split made real (enforcement mechanism)?
| | Option | What it means | Needs | Tradeoffs | Verifiable? |
|---|---|---|---|---|---|
| A | **Application-level routing** | The platform forwards funds according to the split | A platform-controlled flow | No program to build; **the platform touches funds**, which conflicts with the non-custodial rule for user assets; cannot be called enforced | No |
| B | **Venue or router support** | The venue's own fee settings direct fees | An approved venue that supports it | No custom program; limited to what the venue offers, and its admin or upgrade authority applies | Only if the venue's settings and payouts are observable |
| C | **On-chain fee vault** | Fees land in program-controlled accounts and are split by rule | A vault program and a smart-contract review | Strong enforcement of the split once funds arrive; still depends on fees reaching the vault | Yes if routing is complete |
| D | **Custom program for the whole flow** | A program encodes the split and authority limits | A program, audits, upgrade-authority policy | Strongest and most flexible; largest build and risk surface | Yes by design |

Also decide: is a custom on-chain program acceptable at all, and must the split be verifiable on-chain? If either answer is no, options C and D are out and the words "enforced" and "verifiable" cannot be used.

## 6. Liquidity: venue, pair, LP ownership and lock
| | Option | What it means | Needs | Tradeoffs | Verifiable? |
|---|---|---|---|---|---|
| A | **Token/USDC pool, creator funds the quote side** | Matches the configuration's `initialLiquidityUsdc`; the creator supplies USDC | A venue with a token/USDC pool; the creator wallet holding USDC | Familiar pair; the creator needs capital; price discovery depends on the seed amounts | Yes, via the pool |
| B | **Token/SOL pool** | The quote asset is SOL | A venue with a token/SOL pool; a quote amount in SOL | More common on Solana; changes the meaning of the USDC field; SOL price risk | Yes |
| C | **Platform-seeded pool** | The platform supplies some quote liquidity | A funding source and a custody answer | Easier for creators; the platform holds and risks funds, which conflicts with the non-custodial rule | Yes |
| D | **No pool at launch** | The token is minted and liquidity added later | Nothing now | Removes the venue dependency from launch; the token is untradable until then | n/a |

LP ownership and locking are separate: the LP position can be (i) held by the creator unlocked, (ii) locked for a stated time with a named release authority, (iii) burned (liquidity permanently committed), or (iv) held by a protocol-controlled account. Each needs a mechanism and an observation method, and the answer must say what happens if pool creation fails after the mint exists, and whether minting and pool creation share a transaction group.

## 7. Protocol destination and custody
| | Option | What it means | Needs | Tradeoffs | Verifiable? |
|---|---|---|---|---|---|
| A | **Multisig treasury, per cluster** | A multi-signer account receives the protocol share | The signers, threshold, approved addresses per cluster | Stronger security; operational overhead; a change needs several signers | Yes, the address and its signers |
| B | **Program-controlled account** | A program decides how the protocol share is held or released | A program and its review | Rules are visible; needs a custom program (ties to decision 5) | Yes |
| C | **Single-signer operational wallet** | One key controls it | One address | Simplest; single point of failure; weakest trust story | Address yes, control no |
| D | **Split destinations** | e.g. part treasury, part operations | Several addresses and shares | Clear purpose per part; more to disclose | Yes |

For any option: whether the address is fixed or changeable, who approves a change (a change makes recorded plans stale and blocks readiness until re-reviewed), and that it appears in the public Token Proof expected state.

## 8. Metadata hosting and updates
| | Option | What it means | Needs | Tradeoffs | Verifiable? |
|---|---|---|---|---|---|
| A | **Platform-hosted JSON** | The platform serves the metadata document | A hosting service and its operation | Simple; the platform controls availability and could change content; "immutable" cannot be claimed | Via the sha256 of the document |
| B | **Content-addressed storage** | The URI is derived from the content hash | A storage service the product approves | Changing content changes the URI; stronger permanence story; adds a storage dependency | Yes, URI matches content |
| C | **Creator-hosted URI** | The creator supplies a URL | URL validation and a policy for dead links | No hosting for the platform; availability and content are outside the platform's control | Via the sha256 only |
| D | **No hosted JSON; on-chain fields only** | Only name and symbol on-chain; no URI | Nothing hosted | Smallest surface; no image or description on-chain | Yes for what exists |

Also decide: are image assets supported; can creators update metadata after launch (the default update authority is the creator); and does an update change proof status (recommended anchor: a mismatch against the recorded document hash).

## 9. Charity verification governance
| | Option | What it means | Needs | Tradeoffs | Verifiable? |
|---|---|---|---|---|---|
| A | **Platform staff verify against a public registry** | Internal reviewers check official records | A reviewer role, an evidence standard, an audit trail | Direct control; the platform is the trust root; staffing and liability | By evidence record |
| B | **Third-party verifier** | An outside organization attests | A chosen verifier and an integration | Independent; dependency and cost | By the verifier's records |
| C | **Creator-supplied evidence with platform check** | The creator submits, staff confirm | Evidence rules | Scales better; weaker assurance | By evidence record |
| D | **Allowlist of pre-approved charities only** | Only charities on a curated list can be selected | A curated list and its owner | Strongest control; the smallest choice | By the list |

For any option: what happens when a payout wallet changes (recommended: the plan goes stale and readiness blocks until re-verified), what happens when a charity is suspended after launch (pause, redirect or continue), whether charity funds ever touch platform custody, and how payouts are independently verified.

## 10. Launch tax reserve: what is it and is it funded?
| | Option | What it means | Needs | Tradeoffs | Verifiable? |
|---|---|---|---|---|---|
| A | **Fee allocation, designated address only** | A creator-controlled address is named; nothing funds it automatically | Nothing new | Matches today's code; the 15% is a label, not a mechanism | Only that the address is named |
| B | **Fee allocation, funded by the routing mechanism** | The mechanism in decision 5 pays 15% of the stream to that address | Decision 5 and the asset | Real money flow; depends on enforcement | Yes if routing is observable |
| C | **A USDC reserve** | The allocation is held in USDC in a ring-fenced account | An asset, an account and withdrawal rules | Clear purpose; adds custody and control rules | Yes if on-chain |
| D | **Token supply allocation** | The reserve holds tokens | A supply share (decision 1) | Value tied to the token's price; not a stable reserve | Yes |

Also: withdrawal rules, who may change the destination, and that this stays separate from a user's personal Tax Reserve.

## 11. Engineering defaults: approve, reject or amend
For each default the choices are the same three: **Approve as is**, **Reject** (and say what instead), **Amend** (and say how).

| Default | What it is | A reason to approve | A reason to hesitate |
|---|---|---|---|
| SPL Token classic | The classic token program, no extensions | No V1 feature needs an extension; simplest | If fee enforcement later wants the transfer-fee extension, this reverses |
| Client-held mint keypair, public key only | The browser generates and keeps the mint key; the server sees only the public key | Keeps all key material off the server | Requires a client signing flow |
| Creator pays rent and fees; platform pays nothing | The creator wallet funds transactions | Consistent with non-custodial | Creators need SOL up front |
| No platform-funded priority fees | No fee boost | Conservative cost control | Slower inclusion under congestion |
| No automatic retry without user action | A failed attempt needs a new explicit action | Prevents duplicate launches | More manual recovery |
| Metadata canonical format and sha256 | A fixed document form with a recorded hash | Gives Token Proof a comparison anchor | Hosting still open (decision 8) |
| Devnet and mainnet separation; local-fake cannot host a launch | Plans are cluster-bound | Prevents cross-cluster mistakes | None known |
| Cluster mismatch refusal | A plan is refused on another cluster | Same | None known |
| Supply semantics | Fixed supply, basis points, no silent remainder, burn explicit | Removes ambiguity | Forces decisions 1 and 2 to be made |

## Appendix: reviews (not an economics decision)
Security review, smart-contract review (only if a custom program is chosen) and legal review each need an owner, a completion date and an evidence reference. Options for who: an independent external firm, an internal reviewer for the security path only (weaker), or defer mainnet until funded. Nothing is claimed complete.

## Suggested order to decide
1 and 4 first, then 2 and 3, then 6 and 5, then 7, 9, 10, then 8, then 11 and the reviews. This follows the dependency graph in `docs/PRODUCT_DECISIONS.md`: fee scope and supply semantics before the allocation, the allocation before liquidity, liquidity before fee routing, routing before the protocol destination.
