/**
 * Deployment decisions and policy (Slice 14). Pure data and pure functions. Execution stays DISABLED.
 *
 * Every deployment decision is a typed, versioned record with a status. A decision is DECIDED only when its value is represented
 * here and tested; anything the product has not decided is PENDING with a statement of exactly what is missing. Nothing is guessed
 * to make a launch look executable. The policy hash is part of every deployment plan, so changing a decision makes earlier plans stale.
 */
import { ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM } from "./chain/types";
import { CANONICAL_FEE_SPLIT, TOTAL_BPS } from "./feesplit";
import { sha256Hex } from "./hash";
import { base58ByteLength, isValidSolanaAddress } from "./solanaAddress";
import { stableStringify } from "./taxdata/report";
import type { LaunchConfig } from "./api/schemas";
import { percentToBps } from "./feesplit";
import { CANONICAL_SUPPLY_ALLOCATION, SUPPLY_ROLES, bpsSum, type SupplyRole } from "./supplyModel";

export const METAPLEX_METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

// ---------- the global execution gate ----------
/**
 * Real execution (signing, sending, confirming a real transaction) is DISABLED in this build. This is a compile-time constant on the
 * server side, not an environment variable and not something a client or a configuration file can flip. The API refuses to start if
 * REAL_EXECUTION_ENABLED is set to anything but false, and no route exists that could use it.
 */
export const REAL_EXECUTION_ENABLED = false as const;
export const EXECUTION_DISABLED_MESSAGE = "Real execution is disabled in this build. No transaction can be signed, sent or confirmed.";
export class ExecutionDisabledError extends Error {
  constructor(what: string) { super(`${EXECUTION_DISABLED_MESSAGE} (${what})`); this.name = "ExecutionDisabledError"; }
}
/** Call at the top of anything that would sign, send, broadcast or confirm. Always throws in this slice. */
export function assertExecutionDisabled(what: string): never {
  throw new ExecutionDisabledError(what);
}

// ---------- environments ----------
export const CLUSTERS = ["local-fake", "devnet", "mainnet-beta"] as const;
export type Cluster = (typeof CLUSTERS)[number];
export interface EnvironmentSpec {
  cluster: Cluster; launchAllowed: boolean; executionAllowed: false; environmentId: string; rpcEnvironment: string;
  programs: { systemProgram: string; tokenProgram: string; associatedTokenProgram: string; metadataProgram: string };
}
const PROGRAMS = { systemProgram: SYSTEM_PROGRAM, tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM, metadataProgram: METAPLEX_METADATA_PROGRAM };
/** The well-known programs have the same ids on every cluster. A cluster is still part of every plan so a plan can never cross clusters. */
export const ENVIRONMENTS: Readonly<Record<Cluster, EnvironmentSpec>> = Object.freeze({
  "local-fake": { cluster: "local-fake", launchAllowed: false, executionAllowed: false, environmentId: "local-fake", rpcEnvironment: "deterministic fake RPC (tests and local development only)", programs: PROGRAMS },
  devnet: { cluster: "devnet", launchAllowed: true, executionAllowed: false, environmentId: "devnet", rpcEnvironment: "devnet RPC endpoint configured on the server (never sent to the browser)", programs: PROGRAMS },
  "mainnet-beta": { cluster: "mainnet-beta", launchAllowed: true, executionAllowed: false, environmentId: "mainnet-beta", rpcEnvironment: "mainnet-beta RPC endpoint configured on the server (never sent to the browser)", programs: PROGRAMS },
});
export function environmentFor(network: string): EnvironmentSpec | null {
  return (CLUSTERS as readonly string[]).includes(network) ? ENVIRONMENTS[network as Cluster] : null;
}
/** A plan built for one cluster must never be accepted for another. */
export function assertPlanCluster(plan: { environment: { cluster: string } }, expected: Cluster): { ok: true } | { ok: false; code: "CLUSTER_MISMATCH"; message: string } {
  return plan.environment.cluster === expected ? { ok: true } : { ok: false, code: "CLUSTER_MISMATCH", message: `This plan was built for ${plan.environment.cluster}, not ${expected}.` };
}

// ---------- decision records ----------
export const DECISION_IDS = [
  "SUPPLY_SEMANTICS", "ALLOCATION_LOCKS_AND_VESTING", "CHARITY_VERIFICATION_GOVERNANCE", "TAX_RESERVE_FUNDING",
  "TOKEN_PROGRAM", "MINT_KEY_STRATEGY", "FEE_COMPUTE_POLICY", "METADATA_DOCUMENT", "METADATA_HOSTING", "SUPPLY_ALLOCATION_MODEL", "FEE_SPLIT", "FEE_SPLIT_SCOPE",
  "FEE_ROUTING_MECHANISM", "PROTOCOL_DESTINATION", "CHARITY_PAYOUT_MODEL", "TAX_RESERVE_MODEL", "LIQUIDITY_STRATEGY", "ENVIRONMENT_POLICY",
  "SECURITY_REVIEW", "SMART_CONTRACT_REVIEW", "LEGAL_REVIEW",
] as const;
export type DecisionId = (typeof DECISION_IDS)[number];
export type DecisionStatus = "DECIDED" | "PENDING";
export type DecisionCategory = "PRODUCT" | "TECHNICAL" | "SECURITY" | "LEGAL";
export type Provenance = "EXISTING_CONFIGURATION" | "ENGINEERING_DEFAULT" | "PRODUCT_OWNER_DECISION" | "NONE";
/**
 * Product approval is separate from a decision's value. An engineering default is a proposal until a named approver records it, and
 * an approval applies to ONE version of ONE decision (changing the decision invalidates it). There is no API that can set one: an
 * approval is a reviewed code change carrying the approver, the date and a reference. Approval is not on-chain implementation.
 */
export type ApprovalStatus = "APPROVED" | "PENDING_PRODUCT_APPROVAL" | "REJECTED";
export interface Approval { status: ApprovalStatus; approver: string | null; approvedAt: string | null; reference: string | null; approvedVersion: number | null }
export interface Decision {
  approval: Approval;
  /** decisions that must be settled first, because they change what this one can mean */
  dependsOn: readonly DecisionId[];
  /** the exact items a decision must pin down (shown while PENDING) */
  requires: readonly string[];
  /** product owner statements recorded against the decision (preferences and constraints on a pending item, or conditions on a decided one) */
  notes: readonly string[];
  id: DecisionId; title: string; category: DecisionCategory; status: DecisionStatus;
  /** the decided value; null while PENDING */
  value: Record<string, unknown> | null;
  version: number; provenance: Provenance;
  /** where the decision applies */
  environments: readonly Cluster[];
  /** a change to this decision makes earlier plans and any readiness result stale */
  invalidatesReadiness: boolean;
  summary: string;
  /** exactly what information or work is missing (null when DECIDED) */
  missing: string | null;
}
export interface DeploymentPolicy { version: number; decisions: readonly Decision[] }
type DecisionBase = Omit<Decision, "approval" | "dependsOn" | "requires" | "notes">;

/** A decision counts as approved only with a named approver, a date, a reference, and the SAME version that was approved. */
export function isApproved(d: Decision): boolean {
  const a = d.approval;
  return d.status === "DECIDED" && a.status === "APPROVED" && !!a.approver?.trim() && !!a.reference?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(a.approvedAt ?? "") && a.approvedVersion === d.version;
}

export function decisionOf(p: DeploymentPolicy, id: DecisionId): Decision {
  const d = p.decisions.find((x) => x.id === id);
  if (!d) throw new Error(`policy has no decision ${id}`);
  return d;
}
/** Hash of the whole policy. It is part of every deployment plan: a changed decision makes an earlier plan stale. */
export function policyHash(p: DeploymentPolicy): string {
  return sha256Hex(stableStringify({ version: p.version, decisions: p.decisions }));
}

// ---------- typed values ----------
/**
 * The fixed supply allocation, as a decision value. Every role is explicit: there is no remainder. The permanently unissued share is
 * NEVER minted (it is not a burn). Creator and liquidity shares must equal the launch configuration's; there is no editor for this.
 */
export interface SupplyAllocationModel {
  version: 2; creatorBps: number; liquidityBps: number; charityBps: number; taxReserveBps: number; protocolBps: number; permanentlyUnissuedBps: number;
}
export const CANONICAL_SUPPLY_MODEL: Readonly<SupplyAllocationModel> = Object.freeze({
  version: 2, creatorBps: CANONICAL_SUPPLY_ALLOCATION.CREATOR, liquidityBps: CANONICAL_SUPPLY_ALLOCATION.LIQUIDITY, charityBps: CANONICAL_SUPPLY_ALLOCATION.CHARITY,
  taxReserveBps: CANONICAL_SUPPLY_ALLOCATION.TAX_RESERVE, protocolBps: CANONICAL_SUPPLY_ALLOCATION.PROTOCOL, permanentlyUnissuedBps: CANONICAL_SUPPLY_ALLOCATION.PERMANENTLY_UNISSUED,
});
export type { SupplyRole };
export type SupplyResolution = { ok: true; entries: Array<{ role: SupplyRole; bps: number }> } | { ok: false; errors: string[] };
const modelBps = (m: SupplyAllocationModel): Record<SupplyRole, number> => ({
  CREATOR: m.creatorBps, LIQUIDITY: m.liquidityBps, CHARITY: m.charityBps, TAX_RESERVE: m.taxReserveBps, PROTOCOL: m.protocolBps, PERMANENTLY_UNISSUED: m.permanentlyUnissuedBps,
});
/**
 * Checks a launch against the decided model: every role is a whole non-negative number of basis points, they sum to exactly 10000,
 * and the launch's creator and liquidity shares equal the model's (they are not configurable in this version).
 */
export function resolveSupplyAllocation(c: LaunchConfig, m: SupplyAllocationModel): SupplyResolution {
  const errors: string[] = [];
  const bps = modelBps(m);
  for (const r of SUPPLY_ROLES) if (!Number.isSafeInteger(bps[r]) || bps[r] < 0) errors.push(`${r} must be a non-negative whole number of basis points`);
  if (errors.length === 0 && bpsSum(bps) !== TOTAL_BPS) errors.push(`allocations sum to ${bpsSum(bps)} bps, not ${TOTAL_BPS}`);
  const canonical = modelBps(CANONICAL_SUPPLY_MODEL);
  if (errors.length === 0) for (const r of SUPPLY_ROLES) if (bps[r] !== canonical[r]) errors.push(`${r} is ${bps[r]} bps; the only supported model is ${CANONICAL_SUPPLY_MODEL.creatorBps / 100}% creator, ${CANONICAL_SUPPLY_MODEL.liquidityBps / 100}% liquidity, ${CANONICAL_SUPPLY_MODEL.permanentlyUnissuedBps / 100}% permanently unissued, 0% to every other role`);
  let creator = -1, liquidity = -1;
  try { creator = percentToBps(c.creatorAllocationPercent); liquidity = percentToBps(c.liquidityConfiguration.supplyPercentage); } catch { errors.push("the launch's creator or liquidity share is not a valid percent"); }
  if (creator >= 0 && creator !== m.creatorBps) errors.push(`the creator allocation is fixed at ${m.creatorBps / 100}% in this version (this launch has ${creator / 100}%)`);
  if (liquidity >= 0 && liquidity !== m.liquidityBps) errors.push(`the liquidity allocation is fixed at ${m.liquidityBps / 100}% in this version (this launch has ${liquidity / 100}%)`);
  return errors.length ? { ok: false, errors } : { ok: true, entries: SUPPLY_ROLES.map((role) => ({ role, bps: bps[role] })) };
}

export interface FeeComputePolicy {
  feePayer: "CREATOR_WALLET"; platformPays: false; rentPayer: "CREATOR_WALLET";
  priorityFees: { allowed: false; maxMicroLamportsPerComputeUnit: 0 };
  computeBudget: "RUNTIME_SIMULATION_REQUIRED"; maxTransactionBytes: 1232; maxTransactions: 2; retry: "NONE_AUTOMATIC";
  estimation: "ESTIMATED_UNTIL_CONFIRMED"; lamportFigures: "NONE_STATIC";
}
export interface EnvironmentPolicyValue { clusters: readonly Cluster[]; mainnetRequires: readonly DecisionId[]; crossClusterPlans: "REFUSED" }

export interface ReviewEvidence { evidenceRef: string; completedOn: string }
export function isCompleteReview(v: Record<string, unknown> | null): boolean {
  return !!v && typeof v.evidenceRef === "string" && v.evidenceRef.trim().length > 0 && typeof v.completedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.completedOn);
}

// ---------- the policy in force ----------
const ALL: readonly Cluster[] = ["devnet", "mainnet-beta"];
const pending = (id: DecisionId, title: string, category: DecisionCategory, summary: string, missing: string): DecisionBase =>
  ({ id, title, category, status: "PENDING", value: null, version: 1, provenance: "NONE", environments: ALL, invalidatesReadiness: true, summary, missing });

const NO_APPROVAL: Approval = { status: "PENDING_PRODUCT_APPROVAL", approver: null, approvedAt: null, reference: null, approvedVersion: null };
/** Dependencies and the exact items each decision must pin down. docs/PRODUCT_DECISIONS.md explains each. */
const ANNOTATIONS: Record<DecisionId, { dependsOn: DecisionId[]; requires: string[] }> = {
  SUPPLY_SEMANTICS: { dependsOn: [], requires: [] },
  SUPPLY_ALLOCATION_MODEL: { dependsOn: ["SUPPLY_SEMANTICS", "FEE_SPLIT_SCOPE"], requires: [] },
  ALLOCATION_LOCKS_AND_VESTING: { dependsOn: ["SUPPLY_ALLOCATION_MODEL"], requires: ["whether the creator share is immediately transferable", "any lock or vesting per issued role, with duration and who can release it", "how a lock would be observable for Token Proof"] },
  FEE_SPLIT: { dependsOn: [], requires: [] },
  FEE_SPLIT_SCOPE: { dependsOn: [], requires: [] },
  FEE_ROUTING_MECHANISM: { dependsOn: ["FEE_SPLIT_SCOPE", "LIQUIDITY_STRATEGY", "TOKEN_PROGRAM"], requires: [] },
  PROTOCOL_DESTINATION: { dependsOn: ["FEE_ROUTING_MECHANISM", "SUPPLY_ALLOCATION_MODEL"], requires: ["the approved address, per cluster (none exists or may be invented)", "who controls it: multisig or program-controlled are the stated preferences", "whether and how it can change and who approves a change", "how it is publicly verified and shown in Token Proof"] },
  CHARITY_PAYOUT_MODEL: { dependsOn: [], requires: [] },
  CHARITY_VERIFICATION_GOVERNANCE: { dependsOn: ["CHARITY_PAYOUT_MODEL"], requires: ["who verifies a charity and who controls verification", "evidence required for a real (non-fixture) verification", "what happens when a payout wallet changes", "what happens when a charity is suspended after launch", "whether charity funds ever touch platform custody", "how payouts are independently verified"] },
  TAX_RESERVE_MODEL: { dependsOn: [], requires: [] },
  TAX_RESERVE_FUNDING: { dependsOn: ["TAX_RESERVE_MODEL", "FEE_SPLIT_SCOPE", "FEE_ROUTING_MECHANISM"], requires: ["the destination address and its custody model (wallet or program-controlled)", "who controls it and who can change it", "withdrawal rules", "how it is reconciled and shown in Token Proof", "what happens when it is unavailable"] },
  LIQUIDITY_STRATEGY: { dependsOn: ["SUPPLY_ALLOCATION_MODEL", "ALLOCATION_LOCKS_AND_VESTING"], requires: ["the approved venue and pool type", "the pair and quote asset", "the initial amount model and who provides it", "who owns the LP position and whether it is locked, for how long, and who can unlock or remove it", "how ownership is observable and how Token Proof verifies it", "what happens if liquidity creation fails, and whether it shares a transaction group with minting"] },
  METADATA_DOCUMENT: { dependsOn: [], requires: [] },
  METADATA_HOSTING: { dependsOn: [], requires: ["hosting strategy and who operates it", "URI format", "whether content is content-addressed or can change", "whether image assets are supported", "whether the server hosts anything", "whether and how creators can update metadata after launch (an update must not silently stay verified)"] },
  TOKEN_PROGRAM: { dependsOn: [], requires: [] },
  MINT_KEY_STRATEGY: { dependsOn: ["TOKEN_PROGRAM"], requires: [] },
  FEE_COMPUTE_POLICY: { dependsOn: [], requires: [] },
  ENVIRONMENT_POLICY: { dependsOn: [], requires: [] },
  SECURITY_REVIEW: { dependsOn: ["FEE_ROUTING_MECHANISM", "LIQUIDITY_STRATEGY", "MINT_KEY_STRATEGY"], requires: ["a completed independent review with an evidence reference and date"] },
  SMART_CONTRACT_REVIEW: { dependsOn: ["FEE_ROUTING_MECHANISM", "LIQUIDITY_STRATEGY"], requires: ["a completed review of any custom program, with evidence and date (not applicable if none is chosen)"] },
  LEGAL_REVIEW: { dependsOn: ["FEE_SPLIT_SCOPE", "CHARITY_VERIFICATION_GOVERNANCE", "TAX_RESERVE_FUNDING"], requires: ["a completed legal review with an evidence reference and date"] },
};
/**
 * Product owner approvals recorded in "Product Economics decision pass 1" (2026-10-07). The form's name field was left as a template
 * placeholder, so the approver is recorded as the role and the name is NOT invented. Each entry approves ONE version of ONE decision;
 * bumping a decision's version drops its approval. Approval is a product statement, not an implementation, an audit or mainnet readiness.
 */
const OWNER_APPROVER = "Product owner (name not supplied: the form's name field was a template placeholder)";
/** Which pass approved which VERSION of which decision. A decision whose current version differs from its approved version is not approved. */
const OWNER_APPROVALS: Partial<Record<DecisionId, { version: number; pass: 1 | 2 }>> = {
  TOKEN_PROGRAM: { version: 1, pass: 1 }, MINT_KEY_STRATEGY: { version: 1, pass: 1 }, FEE_COMPUTE_POLICY: { version: 1, pass: 1 }, METADATA_DOCUMENT: { version: 2, pass: 1 },
  ENVIRONMENT_POLICY: { version: 1, pass: 1 }, FEE_SPLIT: { version: 1, pass: 1 }, FEE_SPLIT_SCOPE: { version: 1, pass: 1 }, FEE_ROUTING_MECHANISM: { version: 1, pass: 1 },
  CHARITY_PAYOUT_MODEL: { version: 2, pass: 1 }, TAX_RESERVE_MODEL: { version: 2, pass: 1 },
  // pass 2 (supply model clarification): the semantics and the corrected allocation (permanently unissued, not burned)
  SUPPLY_SEMANTICS: { version: 2, pass: 2 }, SUPPLY_ALLOCATION_MODEL: { version: 2, pass: 2 },
};
const PASS_REFERENCE: Record<1 | 2, string> = { 1: "Product Economics decision pass 1", 2: "Product Economics decision pass 2 (supply model clarification)" };
/** Owner statements on items that stay pending, or conditions on decided ones. They are recorded, not turned into values. */
const NOTES: Partial<Record<DecisionId, string[]>> = {
  SUPPLY_SEMANTICS: ["Owner (pass 2): approved. Fixed total supply, basis-point allocations, every unit has exactly one explicit role, no silent remainder, a permanent supply reduction must be explicit, and the product configuration must match the canonical allocation."],
  SUPPLY_ALLOCATION_MODEL: ["Owner (pass 2): the 52% is PERMANENTLY UNISSUED, not burned. Only 48% is ever minted. The allocation is fixed (creator 8%, liquidity 40%, permanently unissued 52%, charity, tax reserve and protocol 0%), not configurable, and there is no tokenomics editor. An earlier 'burn' wording (mint then burn) was rejected."],
  ALLOCATION_LOCKS_AND_VESTING: ["Owner: creator allocation is 8%. Transferability and vesting are PENDING. Do not assume immediate transferability."],
  FEE_SPLIT_SCOPE: ["Owner: the split divides ACTUAL FEES generated by the defined fee mechanism, whenever it generates one. It does NOT divide trading volume, token supply, market cap or gross launch volume. A $1,000 actual fee routes $600 creator, $150 tax reserve, $150 charity, $100 protocol.", "The exact fee source and venue are still to be specified as part of the liquidity and fee routing decisions."],
  FEE_ROUTING_MECHANISM: ["Owner: the split must be objectively verifiable from on-chain state and transactions. It is NOT implemented merely because a backend calculates or routes 60/15/15/10.", "A custom Solana program must enforce the routing rules, subject to security and smart-contract review before mainnet. The choice is a product decision; no program exists."],
  PROTOCOL_DESTINATION: ["Owner: PENDING. Preferred architecture: a multisig or program-controlled treasury. No address may be invented or approved yet. The final destination must be publicly verifiable and included in Token Proof."],
  LIQUIDITY_STRATEGY: ["Owner: venue NONE YET, pair PENDING, LP ownership PENDING, LP lock or burn PENDING. Do not guess the venue.", "Liquidity remains blocking until the venue and the resulting fee mechanics are evaluated."],
  CHARITY_PAYOUT_MODEL: ["Owner: charity receives NO initial token supply; it receives 15% of actual fees."],
  CHARITY_VERIFICATION_GOVERNANCE: ["Owner: PENDING. The charity payout wallet must be independently verifiable before the launch can claim verified charity routing."],
  TAX_RESERVE_MODEL: ["Owner (pass 2): the destination and custody are NOT decided. The creator-controlled address in the configuration is not approved economic policy.", "Owner: a fee/revenue allocation. It is not an initial token allocation, not the creator's personal Tax Reserve, and not a USDC account that is funded before any fee exists."],
  TAX_RESERVE_FUNDING: ["Owner: the exact destination and custody model remain PENDING.", "Owner (pass 2): the creator-controlled address in the launch configuration is a schema compatibility field, NOT an approved economic policy and NOT the final custody model. It stays visibly pending and blocks readiness."],
  METADATA_DOCUMENT: ["Owner: the canonical document and its SHA-256 hash remain the comparison anchor. A metadata change must not silently remain verified."],
  METADATA_HOSTING: ["Owner: hosting PENDING; creator updates PENDING."],
  SECURITY_REVIEW: ["Owner: REQUIRED. Reviewer to be determined."],
  SMART_CONTRACT_REVIEW: ["Owner: REQUIRED. Reviewer to be determined. A custom Solana program is the chosen fee routing direction, so this review applies."],
  LEGAL_REVIEW: ["Owner: REQUIRED. Reviewer to be determined. Mainnet approval only after all reviews and all blocking economic decisions are resolved."],
  TOKEN_PROGRAM: ["Owner (pass 2): SPL Token classic remains the product-approved default. Do not switch to Token-2022. If the custom-program design later proves Token-2022 is technically required, the decision is reopened with that evidence; there is no such evidence today."],
  ENVIRONMENT_POLICY: ["Owner: approvals are product approvals only; they do not mean any mechanism is implemented, audited or mainnet-ready."],
};
const annotate = (xs: DecisionBase[]): Decision[] => xs.map((d) => {
  const o = OWNER_APPROVALS[d.id];
  const approval: Approval = o !== undefined && o.version === d.version && d.status === "DECIDED"
    ? { status: "APPROVED", approver: OWNER_APPROVER, approvedAt: "2026-10-07", reference: PASS_REFERENCE[o.pass], approvedVersion: o.version }
    : NO_APPROVAL;
  return { ...d, approval, dependsOn: ANNOTATIONS[d.id].dependsOn, requires: ANNOTATIONS[d.id].requires, notes: NOTES[d.id] ?? [] };
});

export const DEPLOYMENT_POLICY: DeploymentPolicy = Object.freeze({
  version: 3,
  decisions: Object.freeze(annotate([
    {
      id: "SUPPLY_SEMANTICS", title: "What the initial supply represents", category: "PRODUCT", status: "DECIDED", version: 2, provenance: "PRODUCT_OWNER_DECISION", environments: ALL, invalidatesReadiness: true,
      value: {
        model: "FIXED_TOTAL_SUPPLY", shares: "BASIS_POINTS", everyUnit: "EXACTLY_ONE_EXPLICIT_ROLE", silentRemainder: "NOT_ALLOWED", permanentSupplyReduction: "MUST_BE_EXPLICIT",
        productConfigurationMustMatchCanonicalAllocation: true, relationToFeeSplit: "NONE",
        quantities: { intended: "THE_MAXIMUM_THE_LAUNCH_IS_DEFINED_AROUND_NOT_ON_CHAIN", minted: "SUM_OF_ISSUED_ROLES_ACTUALLY_CREATED_ON_CHAIN", unissued: "PERMANENTLY_UNISSUED_ROLE_NEVER_MINTED_NOT_BURNED" },
      },
      missing: null,
      summary: "A fixed total supply, divided in basis points, where every unit has exactly one explicit role and there is no silent remainder. A permanent reduction of supply must be explicit: tokens that are never minted are the PERMANENTLY_UNISSUED role, not a burn, and they are permanent only once the mint authority is revoked. The product configuration must match the canonical allocation. Initial token supply allocation is a different economic concept from the 60/15/15/10 fee split.",
    },
    pending("ALLOCATION_LOCKS_AND_VESTING", "Locks and vesting of issued supply shares", "PRODUCT", "Whether the creator share is immediately transferable and whether any issued share is locked or vested.", "For each role: transferable now, locked or vested (duration and who releases it) or burned, and how a lock is observable. No lock or vesting mechanism exists in the product today."),
    pending("CHARITY_VERIFICATION_GOVERNANCE", "Charity verification governance", "LEGAL", "Who verifies a charity, with what evidence, and what happens when a wallet changes or a charity is suspended after launch. Current verification is fixture or admin data only.", "The verifier and who controls verification, real evidence requirements, wallet-change and post-launch suspension rules, whether charity funds ever touch platform custody, and how payouts are independently verified."),
    pending("TAX_RESERVE_FUNDING", "Launch tax reserve funding semantics", "PRODUCT", "Whether the launch tax reserve allocation is funded by a mechanism or is only a designated address, and in what asset.", "The asset, mechanism-funded versus designated-only, withdrawal rules, who may change the destination, and how it is verified and shown in Token Proof."),
    {
      id: "TOKEN_PROGRAM", title: "Token program", category: "TECHNICAL", status: "DECIDED", version: 1, provenance: "ENGINEERING_DEFAULT", environments: ALL, invalidatesReadiness: true,
      value: { name: "SPL_TOKEN", programId: TOKEN_PROGRAM, token2022: "NOT_USED" }, missing: null,
      summary: "V1 uses the classic SPL Token program. No V1 feature needs a Token-2022 extension (no transfer-fee, metadata-pointer, permanent-delegate or confidential-transfer requirement), and metadata uses Metaplex. If fee enforcement later needs the Token-2022 transfer-fee extension, that is a new decision.",
    },
    {
      id: "MINT_KEY_STRATEGY", title: "Mint key workflow", category: "SECURITY", status: "DECIDED", version: 1, provenance: "ENGINEERING_DEFAULT", environments: ALL, invalidatesReadiness: true,
      value: {
        generatedIn: "CLIENT", privateKeyLeavesClient: false, serverReceives: "PUBLIC_KEY_ONLY", mintIsClientHeldSigner: true,
        flow: [
          "The browser generates the mint keypair locally and keeps the private key.",
          "The browser sends ONLY the mint public key to the server.",
          "The server validates it (a 32-byte address, not a program or a destination, not secret-key shaped) and binds it to one plan.",
          "The server builds the transactions that reference that mint.",
          "The wallet signs; the mint keypair signs only the account-creation instruction that requires it.",
        ],
      },
      missing: null,
      summary: "The mint keypair is client-held. The server receives a public key only and never any private key, secret key, seed phrase or mnemonic. The mint account signs its own creation (a Solana requirement for a new account), so it is modeled as a client-held signer.",
    },
    {
      id: "FEE_COMPUTE_POLICY", title: "Rent, fee and compute policy", category: "TECHNICAL", status: "DECIDED", version: 1, provenance: "ENGINEERING_DEFAULT", environments: ALL, invalidatesReadiness: true,
      value: {
        feePayer: "CREATOR_WALLET", platformPays: false, rentPayer: "CREATOR_WALLET", priorityFees: { allowed: false, maxMicroLamportsPerComputeUnit: 0 },
        computeBudget: "RUNTIME_SIMULATION_REQUIRED", maxTransactionBytes: 1232, maxTransactions: 2, retry: "NONE_AUTOMATIC", estimation: "ESTIMATED_UNTIL_CONFIRMED", lamportFigures: "NONE_STATIC",
      } satisfies FeeComputePolicy as unknown as Record<string, unknown>,
      missing: null,
      summary: "The creator wallet pays rent and network fees; the platform pays nothing. No priority fee in V1. Compute needs come from a runtime simulation, never a static guess. There are at most two transactions, within the 1232-byte packet limit, and no retry without the user: a new attempt is a new, explicit action. Fee figures are ESTIMATES until a transaction confirms; no lamport amount is hard-coded.",
    },
    {
      id: "METADATA_DOCUMENT", title: "Metadata document format", category: "TECHNICAL", status: "DECIDED", version: 2, provenance: "ENGINEERING_DEFAULT", environments: ALL, invalidatesReadiness: true,
      value: {
        standard: "Metaplex token metadata JSON (name, symbol, description, image, external_url, seller_fee_basis_points)", canonicalization: "sorted keys, compact UTF-8 (stable stringify)",
        integrity: "sha256 of the canonical document, recorded in the plan and expected state", contentAddressed: false, updatePolicy: "follows the update authority policy in the launch configuration", onChange: "A METADATA CHANGE MUST NOT SILENTLY REMAIN VERIFIED: it is compared against the recorded hash",
      },
      missing: null,
      summary: "The document's fields and canonical form are fixed and hashed so Token Proof can later compare configured metadata with observed metadata. Hosting is a separate, pending decision; nothing is fetched or published.",
    },
    pending("METADATA_HOSTING", "Metadata hosting and URI", "PRODUCT", "Where the metadata JSON is hosted, who controls it, and whether its URI is content-addressed.", "A hosting location and owner, a versioning and update policy, and whether the URI is content-addressed or can change. Nothing may be claimed about decentralization or permanence until it is true."),
    {
      id: "SUPPLY_ALLOCATION_MODEL", title: "Initial token supply allocation", category: "PRODUCT", status: "DECIDED", version: 2, provenance: "PRODUCT_OWNER_DECISION", environments: ALL, invalidatesReadiness: true,
      value: { ...CANONICAL_SUPPLY_MODEL, fixed: true, configurable: false, permanentlyUnissuedMeaning: "NEVER_MINTED_NOT_BURNED" } as unknown as Record<string, unknown>, missing: null,
      summary: "Fixed in this version: creator 8%, liquidity 40%, permanently unissued 52%, and 0% for charity, tax reserve and protocol. Only the creator and liquidity shares (48%) are minted. The 52% is never minted: it is not burned, it does not exist on-chain, and it is permanent only once the mint authority is revoked. It is not configurable, and a launch with any other creator or liquidity share is blocked.",
    },
    {
      id: "FEE_SPLIT", title: "Fee split (basis points)", category: "PRODUCT", status: "DECIDED", version: 1, provenance: "EXISTING_CONFIGURATION", environments: ALL, invalidatesReadiness: true,
      value: { ...CANONICAL_FEE_SPLIT }, missing: null,
      summary: "Creator 60%, tax reserve 15%, charity 15%, protocol 10% (6000/1500/1500/1000 bps, sum 10000). This is the CONFIGURED split. It is not token supply allocation and nothing enforces it on-chain yet.",
    },
    {
      id: "FEE_SPLIT_SCOPE", title: "What the fee split applies to", category: "PRODUCT", status: "DECIDED", version: 1, provenance: "PRODUCT_OWNER_DECISION", environments: ALL, invalidatesReadiness: true,
      value: { divides: "ACTUAL_FEES_GENERATED_BY_THE_DEFINED_FEE_MECHANISM", when: "WHENEVER_AN_ACTUAL_FEE_IS_GENERATED", doesNotDivide: ["TRADING_VOLUME", "TOKEN_SUPPLY", "MARKET_CAP", "GROSS_LAUNCH_VOLUME"], feeSourceAndVenue: "TO_BE_SPECIFIED_WITH_LIQUIDITY_AND_FEE_ROUTING" }, missing: null,
      summary: "The 60/15/15/10 split divides actual fees generated by the defined fee mechanism, whenever that mechanism generates one. It does not divide trading volume, token supply, market cap or gross launch volume. A 1,000 USD actual fee routes 600 creator, 150 tax reserve, 150 charity, 100 protocol. The exact fee source and venue are not yet specified: they are part of the pending liquidity and fee routing work.",
    },
    {
      id: "FEE_ROUTING_MECHANISM", title: "Fee routing mechanism", category: "TECHNICAL", status: "DECIDED", version: 1, provenance: "PRODUCT_OWNER_DECISION", environments: ALL, invalidatesReadiness: true,
      value: { mechanism: "CUSTOM_SOLANA_PROGRAM", requiresCustomProgram: true, verifiableOnChain: true, implemented: false, enforcesSplit: false, programId: null }, missing: null,
      summary: "Product decision: a custom Solana program will enforce the routing, and users must be able to verify the split on-chain from state and transactions. This is a choice, not an implementation: no program exists, none is designed or deployed, and no program id exists. FEE_ROUTING_ENFORCEMENT_NOT_IMPLEMENTED stays in force: the split is not enforced because a backend calculates or routes it. The program is subject to security and smart-contract review before mainnet.",
    },
    pending("PROTOCOL_DESTINATION", "Protocol destination and custody", "SECURITY", "Which address receives the protocol share and who controls it.", "PROTOCOL_DESTINATION_PENDING: an approved address, who controls it (multisig, program-controlled or other), whether it can change, per-cluster values and how it is verified. No developer or fixture address may stand in for it."),
    {
      id: "CHARITY_PAYOUT_MODEL", title: "Charity payout destination", category: "PRODUCT", status: "DECIDED", version: 2, provenance: "PRODUCT_OWNER_DECISION", environments: ALL, invalidatesReadiness: true,
      value: { model: "ONE_VERIFIED_WALLET_PER_CHARITY", tokenSupplyAllocation: false, feeAllocationBps: 1500, rules: ["the charity is VERIFIED in the registry", "exactly one verified, well-formed Solana wallet exists for it", "that address is part of the plan and expected state", "a change to it makes the recorded plan stale", "the payout wallet must be independently verifiable before the launch claims verified charity routing"] },
      missing: null,
      summary: "The charity receives no initial token supply and 15% of actual fees. One verified payout wallet per charity; more than one, or none, leaves the destination unresolved and blocks readiness. No donation is executed and verified charity routing cannot be claimed until the wallet is independently verifiable.",
    },
    {
      id: "TAX_RESERVE_MODEL", title: "Launch tax reserve allocation", category: "PRODUCT", status: "DECIDED", version: 2, provenance: "PRODUCT_OWNER_DECISION", environments: ALL, invalidatesReadiness: true,
      value: { model: "FEE_REVENUE_ALLOCATION", share: "15_PERCENT_OF_THE_ACTUAL_FEE_STREAM", tokenAllocation: false, personalTaxReserve: false, usdcAccountFundedBeforeFeesExist: false, separateFromPersonalTaxReserve: true, usesPersonalReserveTables: false, destinationAndCustody: "PENDING" },
      missing: null,
      summary: "The launch tax reserve is a designated recipient of 15% of the actual fee stream. It is not an initial token allocation, not the creator's personal Tax Reserve and not a USDC account that is funded before any fee exists. It shares none of the personal Tax Reserve's tables. Its destination and custody model are pending.",
    },
    pending("LIQUIDITY_STRATEGY", "Liquidity venue and architecture", "TECHNICAL", "The venue, pool type, quote asset, amounts, LP ownership, lock, and how the pool is observed and identified.", "A selected venue with its program and instruction design, the pair and amounts, who owns the LP position, whether it is locked or burned and for how long, and how the pool address is identified for Token Proof. No pool or lock is invented."),
    {
      id: "ENVIRONMENT_POLICY", title: "Cluster policy", category: "SECURITY", status: "DECIDED", version: 1, provenance: "ENGINEERING_DEFAULT", environments: ALL, invalidatesReadiness: true,
      value: { clusters: ["local-fake", "devnet", "mainnet-beta"], mainnetRequires: ["SECURITY_REVIEW", "SMART_CONTRACT_REVIEW", "LEGAL_REVIEW"], crossClusterPlans: "REFUSED" } satisfies EnvironmentPolicyValue as unknown as Record<string, unknown>,
      missing: null,
      summary: "local-fake is for tests only and cannot host a launch; devnet and mainnet-beta are separate. Every plan carries its cluster and is refused on any other. mainnet-beta additionally requires the security, smart-contract and legal reviews.",
    },
    pending("SECURITY_REVIEW", "Security review", "SECURITY", "An independent security review of the signing and deployment path.", "A completed review with an evidence reference and completion date. None exists."),
    pending("SMART_CONTRACT_REVIEW", "Smart contract review", "SECURITY", "A review of any custom on-chain program the fee routing or liquidity design requires.", "A completed review with evidence, if a custom program is selected. No program exists."),
    pending("LEGAL_REVIEW", "Legal review", "LEGAL", "Legal review (money transmission, securities, charitable solicitation, tax reporting, sanctions).", "A completed review with an evidence reference and completion date. None exists; nothing here is legal approval."),
  ] as DecisionBase[])),
});

// ---------- engineering milestones and what each depends on ----------
export const MILESTONE_IDS = ["PLAN_EXECUTABLE", "SIGNING", "MINT_CREATION", "LIQUIDITY_CREATION", "FEE_ROUTING", "PROOF_VERIFIED", "MAINNET"] as const;
export type MilestoneId = (typeof MILESTONE_IDS)[number];
export interface Milestone { id: MilestoneId; title: string; decisions: readonly DecisionId[]; after: readonly MilestoneId[]; engineering: readonly string[] }
const NON_REVIEW: DecisionId[] = DECISION_IDS.filter((d) => !["SECURITY_REVIEW", "SMART_CONTRACT_REVIEW", "LEGAL_REVIEW"].includes(d));
export const MILESTONES: readonly Milestone[] = Object.freeze([
  { id: "PLAN_EXECUTABLE", title: "A deployment plan can become executable", decisions: NON_REVIEW, after: [], engineering: ["instruction builders for every decided design", "a plan that has no BLOCKED instruction"] },
  { id: "SIGNING", title: "Wallet signing can be implemented", decisions: ["TOKEN_PROGRAM", "MINT_KEY_STRATEGY", "FEE_COMPUTE_POLICY", "ENVIRONMENT_POLICY", "SECURITY_REVIEW"], after: ["PLAN_EXECUTABLE"], engineering: ["serialization with a client-reported mint public key and a recent blockhash", "client signing UI", "REAL_EXECUTION_ENABLED review and a new migration widening attempt states"] },
  { id: "MINT_CREATION", title: "Mint creation can be implemented", decisions: ["SUPPLY_SEMANTICS", "SUPPLY_ALLOCATION_MODEL", "ALLOCATION_LOCKS_AND_VESTING", "METADATA_DOCUMENT", "METADATA_HOSTING", "PROTOCOL_DESTINATION", "CHARITY_PAYOUT_MODEL", "TAX_RESERVE_MODEL"], after: ["SIGNING"], engineering: ["submission, confirmation and reconciliation paths"] },
  { id: "LIQUIDITY_CREATION", title: "Liquidity creation can be implemented", decisions: ["LIQUIDITY_STRATEGY", "SUPPLY_ALLOCATION_MODEL", "ALLOCATION_LOCKS_AND_VESTING", "SMART_CONTRACT_REVIEW", "SECURITY_REVIEW"], after: ["MINT_CREATION"], engineering: ["the selected venue's instruction builder", "pool and LP observation"] },
  { id: "FEE_ROUTING", title: "Fee routing can be implemented", decisions: ["FEE_SPLIT", "FEE_SPLIT_SCOPE", "FEE_ROUTING_MECHANISM", "PROTOCOL_DESTINATION", "CHARITY_PAYOUT_MODEL", "CHARITY_VERIFICATION_GOVERNANCE", "TAX_RESERVE_MODEL", "TAX_RESERVE_FUNDING", "SMART_CONTRACT_REVIEW", "SECURITY_REVIEW", "LEGAL_REVIEW"], after: ["LIQUIDITY_CREATION"], engineering: ["the selected mechanism", "on-chain observation of the routing"] },
  { id: "PROOF_VERIFIED", title: "Token Proof can reach VERIFIED for a real token", decisions: ["LIQUIDITY_STRATEGY", "FEE_ROUTING_MECHANISM", "METADATA_HOSTING", "PROTOCOL_DESTINATION", "CHARITY_PAYOUT_MODEL", "TAX_RESERVE_FUNDING"], after: ["MINT_CREATION", "LIQUIDITY_CREATION", "FEE_ROUTING"], engineering: ["a privileged chain observer that records RPC observations", "fee-routing and liquidity observations"] },
  { id: "MAINNET", title: "A mainnet launch can be permitted", decisions: [...DECISION_IDS], after: ["PROOF_VERIFIED"], engineering: ["independent audits and legal clearance recorded as evidence", "a release decision by the product owner"] },
] as Milestone[]);

/** Decisions a milestone still waits on: not DECIDED, or DECIDED but not approved at its current version. Reviews that do not apply are not exempted here. */
export function milestoneBlockers(p: DeploymentPolicy, id: MilestoneId): DecisionId[] {
  const m = MILESTONES.find((x) => x.id === id)!;
  return m.decisions.filter((d) => !isApproved(decisionOf(p, d)));
}
/** A milestone is unblocked only when its own decisions are approved AND every milestone it comes after is unblocked. Decisions are necessary, never sufficient: engineering prerequisites remain. */
export function milestoneStatus(p: DeploymentPolicy, id: MilestoneId): { blockedByDecisions: DecisionId[]; blockedByMilestones: MilestoneId[]; unblocked: boolean } {
  const m = MILESTONES.find((x) => x.id === id)!;
  const blockedByDecisions = milestoneBlockers(p, id);
  const blockedByMilestones = m.after.filter((a) => !milestoneStatus(p, a).unblocked);
  return { blockedByDecisions, blockedByMilestones, unblocked: blockedByDecisions.length === 0 && blockedByMilestones.length === 0 };
}

/** A copy of the policy with some decisions replaced (tests and what-if analysis). It never mutates the policy in force. */
export function withDecisions(base: DeploymentPolicy, over: Partial<Record<DecisionId, Partial<Decision>>>): DeploymentPolicy {
  return { version: base.version, decisions: base.decisions.map((d) => (over[d.id] ? ({ ...d, ...over[d.id] } as Decision) : d)) };
}

// ---------- metadata document (canonical, hashed, never fetched or published here) ----------
export function canonicalMetadataDocument(c: LaunchConfig): Record<string, string | number> {
  const doc: Record<string, string | number> = { name: c.name, symbol: c.symbol, description: c.description, seller_fee_basis_points: 0 };
  if (c.imageUri) doc.image = c.imageUri;
  if (c.website) doc.external_url = c.website;
  return doc;
}
export function metadataDocumentSha256(c: LaunchConfig): string {
  return sha256Hex(stableStringify(canonicalMetadataDocument(c)));
}

// ---------- mint public key binding ----------
export type MintKeyCheck = { ok: true; address: string } | { ok: false; code: "NOT_A_STRING" | "SECRET_KEY_SHAPED" | "INVALID_ADDRESS" | "RESERVED_ADDRESS"; message: string };
/**
 * Validates a client-reported mint PUBLIC key. A value that decodes to 64 bytes (the shape of a secret key) is refused as such and
 * never stored. Nothing here accepts, derives or stores a private key. (No endpoint calls this yet: reporting happens in a later slice.)
 */
export function validateMintPublicKey(input: unknown, reserved: readonly string[] = []): MintKeyCheck {
  if (typeof input !== "string") return { ok: false, code: "NOT_A_STRING", message: "The mint public key must be a string." };
  const n = base58ByteLength(input);
  if (n === 64 || n === 65 || n === 66) return { ok: false, code: "SECRET_KEY_SHAPED", message: "That value has the shape of a secret key. Never send one. Send only the public key." };
  if (!isValidSolanaAddress(input)) return { ok: false, code: "INVALID_ADDRESS", message: "The mint public key is not a valid 32-byte Solana address." };
  const known = [...reserved, ...Object.values(PROGRAMS)];
  if (known.includes(input)) return { ok: false, code: "RESERVED_ADDRESS", message: "The mint address may not be a program or an address already used as a destination." };
  return { ok: true, address: input };
}

// ---------- deployment attempt state machine (separate from the launch configuration state) ----------
export const ATTEMPT_STATES = ["PLAN_BUILT", "AWAITING_SIGNATURE", "SIGNED", "SUBMITTED", "CONFIRMING", "CONFIRMED", "RECONCILING", "VERIFIED", "FAILED", "CANCELLED"] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];
export const ATTEMPT_TRANSITIONS: Readonly<Record<AttemptState, readonly AttemptState[]>> = Object.freeze({
  PLAN_BUILT: ["AWAITING_SIGNATURE", "CANCELLED", "FAILED"], AWAITING_SIGNATURE: ["SIGNED", "CANCELLED", "FAILED"], SIGNED: ["SUBMITTED", "FAILED"], SUBMITTED: ["CONFIRMING", "FAILED"],
  CONFIRMING: ["CONFIRMED", "FAILED"], CONFIRMED: ["RECONCILING"], RECONCILING: ["VERIFIED", "FAILED"], VERIFIED: [], FAILED: [], CANCELLED: [],
});
/** States that can be recorded while real execution is disabled: none of them involves a signature, a send or a confirmation. */
export const ATTEMPT_STATES_WITHOUT_EXECUTION: readonly AttemptState[] = ["PLAN_BUILT", "FAILED", "CANCELLED"];
export const FAILURE_CATEGORIES = ["BUILD_ERROR", "READINESS_BLOCKED", "SIGNING_ERROR", "SUBMISSION_ERROR", "CONFIRMATION_ERROR", "RECONCILIATION_ERROR", "CANCELLED_BY_USER"] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];
export function canTransition(from: AttemptState, to: AttemptState): boolean { return ATTEMPT_TRANSITIONS[from].includes(to); }
/** Whether recording this state is allowed right now. Anything that implies a signature, send or confirmation is not, while execution is disabled. */
export function attemptStateRecordable(to: AttemptState): boolean { return (REAL_EXECUTION_ENABLED as boolean) ? true : ATTEMPT_STATES_WITHOUT_EXECUTION.includes(to); }
export function attemptEventHash(i: { attemptId: string; seq: number; status: AttemptState; failureCategory: FailureCategory | null; note: string | null; prevHash: string | null }): string {
  return sha256Hex(stableStringify({ v: 1, ...i }));
}
