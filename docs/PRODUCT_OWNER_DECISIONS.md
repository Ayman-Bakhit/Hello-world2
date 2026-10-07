# PRODUCT_OWNER_DECISIONS: questionnaire

Fill this in by ticking one box per question (or writing your own under "Other") and returning it. **Nothing here is approved until you answer.** Each question maps to an option table in `docs/PRODUCT_ECONOMICS_OPTIONS.md` (same numbers); read the tradeoffs there first. Answering this does not change the code or enable anything: a later, reviewed change records your answers as approved decisions with your name, a date and a reference.

Name: ______________________  Date: ______________  Reference: ______________________

Use `[x]` to tick. Leave a question blank if you are not ready; a blank stays PENDING and keeps blocking.

## 1. Do charity, tax reserve and protocol receive any token supply?
- [ ] A. Fees only: 0 bps of supply for all three
- [ ] B. Charity and tax reserve fees only; protocol also holds a supply share (bps: ______)
- [ ] C. All three receive a supply share as well as fees (bps: charity ____ reserve ____ protocol ____)
- [ ] D. Some are paid in tokens instead of fees (which: ______________________)
- [ ] Other: ____________________________________________

## 2. Where does the rest of the supply go (the 52% in the reference configuration)?
- [ ] A. All non-creator supply seeds liquidity
- [ ] B. The remainder is burned
- [ ] C. A named controlled destination holds it (who controls it: ______________________)
- [ ] D. A split (liquidity ____ burn ____ destination ____ bps; must total the remainder)
- [ ] Other: ____________________________________________

## 3. Transferability, locks and vesting
Creator share:
- [ ] A. Immediately transferable, no lock
- [ ] B. Locked until (period): ______________  Release authority: ______________
- [ ] C. Vests over (schedule): ______________________
Other roles:
- [ ] D. Also locked or burned (roles and terms): ______________________
- [ ] No locks on other roles
- [ ] Other: ____________________________________________

## 4. What does 60/15/15/10 divide, and when?
- [ ] A. Trading fees collected on the launch venue (repeatedly, after launch)
- [ ] B. Only the creator fees a third-party venue grants
- [ ] C. Launch proceeds, once
- [ ] D. A platform-defined revenue stream (describe): ______________________
- [ ] Other: ____________________________________________
Also answer:
- Who pays it: ______________________
- Per transaction, or periodically: ______________________
- Applies to volume, or to actual fees collected: ______________________
- If the venue cannot support the split: ______________________

## 5. How is the split made real?
- [ ] A. Application-level routing (the platform forwards funds; cannot be called enforced)
- [ ] B. Venue or router support
- [ ] C. On-chain fee vault
- [ ] D. Custom on-chain program
- [ ] Other: ____________________________________________
- Is a custom on-chain program acceptable?  [ ] Yes  [ ] No
- Must the split be verifiable on-chain?  [ ] Yes  [ ] No

## 6. Liquidity
Pair and funding:
- [ ] A. Token/USDC, creator funds the quote side
- [ ] B. Token/SOL
- [ ] C. Platform-seeded pool (answer the custody question: ______________________)
- [ ] D. No pool at launch
- Approved venue (name, or "none yet"): ______________________
LP position:
- [ ] Held by the creator, unlocked
- [ ] Locked for (period): ______________  Release authority: ______________
- [ ] Burned
- [ ] Held by a protocol-controlled account
If pool creation fails after the mint exists:  [ ] Stop and retry  [ ] Cancel the launch  [ ] Other: ______________
Minting and pool creation:  [ ] One transaction group  [ ] Separate  [ ] No preference

## 7. Protocol destination and custody
- [ ] A. Multisig treasury, per cluster (signers / threshold: ______________)
- [ ] B. Program-controlled account
- [ ] C. Single-signer operational wallet
- [ ] D. Split destinations (describe): ______________________
- [ ] Other: ____________________________________________
- Address fixed, or changeable:  [ ] Fixed  [ ] Changeable
- Who approves a change: ______________________
- Address available now?  [ ] Yes (supply it through the secure process, not in this file)  [ ] Not yet

## 8. Metadata hosting and updates
- [ ] A. Platform-hosted JSON
- [ ] B. Content-addressed storage (approved service: ______________________)
- [ ] C. Creator-hosted URI
- [ ] D. On-chain name and symbol only, no hosted JSON
- [ ] Other: ____________________________________________
- Image assets supported?  [ ] Yes  [ ] No
- May creators update metadata after launch?  [ ] Yes  [ ] No  [ ] Only before mainnet
- Does an update change proof status?  [ ] Yes, show a mismatch  [ ] No

## 9. Charity verification governance
- [ ] A. Platform staff verify against a public registry
- [ ] B. A third-party verifier (name: ______________________)
- [ ] C. Creator-supplied evidence with a platform check
- [ ] D. Allowlist of pre-approved charities only
- [ ] Other: ____________________________________________
- If a payout wallet changes:  [ ] Plan goes stale, re-verify first  [ ] Other: ______________
- If a charity is suspended after launch:  [ ] Pause routing  [ ] Redirect (to: ______________)  [ ] Continue  [ ] Other: ______________
- May charity funds ever touch platform custody?  [ ] Never  [ ] Yes, in this case: ______________

## 10. Launch tax reserve
- [ ] A. Fee allocation, designated address only (nothing funds it)
- [ ] B. Fee allocation, funded by the routing mechanism in question 5
- [ ] C. A USDC reserve account
- [ ] D. A token supply allocation
- [ ] Other: ____________________________________________
- Withdrawal rules: ______________________
- Who may change the destination: ______________________

## 11. Engineering defaults
Mark each: A = approve as is, R = reject (say what instead), M = amend (say how).
| Default | A / R / M | Note |
|---|---|---|
| SPL Token classic | | |
| Client-held mint keypair, public key only | | |
| Creator pays rent and fees; platform pays nothing | | |
| No platform-funded priority fees | | |
| No automatic retry without user action | | |
| Metadata canonical format and sha256 | | |
| Devnet and mainnet separation | | |
| Cluster mismatch refusal | | |
| Supply semantics (fixed supply, bps, no silent remainder, burn explicit) | | |

## Appendix: reviews
Who will complete each, and by when?
- Security review: ______________________  Date: ______________
- Smart-contract review (only if a custom program is chosen): ______________________  Date: ______________
- Legal review: ______________________  Date: ______________

## Anything else the decisions must say
____________________________________________________________
____________________________________________________________

---
**Status:** answered on 2026-10-07 ("Product Economics decision pass 1"). The answers and what they changed are recorded in docs/PRODUCT_DECISIONS.md (section "Product owner decision pass 1"). Anything the answers left PENDING remains blocking.
