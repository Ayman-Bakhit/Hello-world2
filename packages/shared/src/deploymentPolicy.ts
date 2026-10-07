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
  "TOKEN_PROGRAM", "MINT_KEY_STRATEGY", "FEE_COMPUTE_POLICY", "METADATA_DOCUMENT", "METADATA_HOSTING", "SUPPLY_ALLOCATION_MODEL", "FEE_SPLIT", "FEE_SPLIT_SCOPE",
  "FEE_ROUTING_MECHANISM", "PROTOCOL_DESTINATION", "CHARITY_PAYOUT_MODEL", "TAX_RESERVE_MODEL", "LIQUIDITY_STRATEGY", "ENVIRONMENT_POLICY",
  "SECURITY_REVIEW", "SMART_CONTRACT_REVIEW", "LEGAL_REVIEW",
] as const;
export type DecisionId = (typeof DECISION_IDS)[number];
export type DecisionStatus = "DECIDED" | "PENDING";
export type DecisionCategory = "PRODUCT" | "TECHNICAL" | "SECURITY" | "LEGAL";
export type Provenance = "EXISTING_CONFIGURATION" | "ENGINEERING_DEFAULT" | "NONE";
export interface Decision {
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
/** Initial token supply allocation. Creator and liquidity shares come from the launch configuration; the model defines the rest. */
export interface SupplyAllocationModel { version: 1; charityBps: number; taxReserveBps: number; protocolBps: number; burnBps: number }
export type SupplyRole = "CREATOR" | "LIQUIDITY" | "CHARITY" | "TAX_RESERVE" | "PROTOCOL" | "BURN";
export type SupplyResolution = { ok: true; entries: Array<{ role: SupplyRole; bps: number }> } | { ok: false; errors: string[] };
/** One canonical allocation: every unit of initial supply belongs to exactly one role and the roles sum to exactly 10000 bps. */
export function resolveSupplyAllocation(c: LaunchConfig, m: SupplyAllocationModel): SupplyResolution {
  const errors: string[] = [];
  const entries: Array<{ role: SupplyRole; bps: number }> = [
    { role: "CREATOR", bps: percentToBps(c.creatorAllocationPercent) }, { role: "LIQUIDITY", bps: percentToBps(c.liquidityConfiguration.supplyPercentage) },
    { role: "CHARITY", bps: m.charityBps }, { role: "TAX_RESERVE", bps: m.taxReserveBps }, { role: "PROTOCOL", bps: m.protocolBps }, { role: "BURN", bps: m.burnBps },
  ];
  for (const e of entries) if (!Number.isSafeInteger(e.bps) || e.bps < 0) errors.push(`${e.role} must be a non-negative whole number of basis points`);
  const sum = entries.reduce((a, e) => a + (Number.isSafeInteger(e.bps) ? e.bps : 0), 0);
  if (errors.length === 0 && sum !== TOTAL_BPS) errors.push(`allocations sum to ${sum} bps, not ${TOTAL_BPS}`);
  return errors.length ? { ok: false, errors } : { ok: true, entries };
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
const pending = (id: DecisionId, title: string, category: DecisionCategory, summary: string, missing: string): Decision =>
  ({ id, title, category, status: "PENDING", value: null, version: 1, provenance: "NONE", environments: ALL, invalidatesReadiness: true, summary, missing });

export const DEPLOYMENT_POLICY: DeploymentPolicy = Object.freeze({
  version: 1,
  decisions: Object.freeze([
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
      id: "METADATA_DOCUMENT", title: "Metadata document format", category: "TECHNICAL", status: "DECIDED", version: 1, provenance: "ENGINEERING_DEFAULT", environments: ALL, invalidatesReadiness: true,
      value: {
        standard: "Metaplex token metadata JSON (name, symbol, description, image, external_url, seller_fee_basis_points)", canonicalization: "sorted keys, compact UTF-8 (stable stringify)",
        integrity: "sha256 of the canonical document, recorded in the plan and expected state", contentAddressed: false, updatePolicy: "follows the update authority policy in the launch configuration",
      },
      missing: null,
      summary: "The document's fields and canonical form are fixed and hashed so Token Proof can later compare configured metadata with observed metadata. Hosting is a separate, pending decision; nothing is fetched or published.",
    },
    pending("METADATA_HOSTING", "Metadata hosting and URI", "PRODUCT", "Where the metadata JSON is hosted, who controls it, and whether its URI is content-addressed.", "A hosting location and owner, a versioning and update policy, and whether the URI is content-addressed or can change. Nothing may be claimed about decentralization or permanence until it is true."),
    pending("SUPPLY_ALLOCATION_MODEL", "Initial token supply allocation", "PRODUCT", "The launch configuration defines a creator share and a liquidity share of supply. Where the rest goes is undecided.", "Basis-point shares for charity, tax reserve, protocol and burn such that creator + liquidity + charity + tax reserve + protocol + burn = 10000. Not derivable from the fee split, which is a different economic concept."),
    {
      id: "FEE_SPLIT", title: "Fee split (basis points)", category: "PRODUCT", status: "DECIDED", version: 1, provenance: "EXISTING_CONFIGURATION", environments: ALL, invalidatesReadiness: true,
      value: { ...CANONICAL_FEE_SPLIT }, missing: null,
      summary: "Creator 60%, tax reserve 15%, charity 15%, protocol 10% (6000/1500/1500/1000 bps, sum 10000). This is the CONFIGURED split. It is not token supply allocation and nothing enforces it on-chain yet.",
    },
    pending("FEE_SPLIT_SCOPE", "What the fee split applies to", "PRODUCT", "Whether 60/15/15/10 applies to launch proceeds, creator fees, trading fees, protocol fees, liquidity fees or another stream.", "The revenue stream the split divides, and the asset it is paid in."),
    pending("FEE_ROUTING_MECHANISM", "Fee routing mechanism", "TECHNICAL", "The mechanism that would make the split real: application-level routing, a DEX or router setting, a fee vault, or a custom on-chain program.", "A selected mechanism with its program and instruction design. FEE_ROUTING_ENFORCEMENT_NOT_IMPLEMENTED: no such mechanism exists, so the database split is configuration only."),
    pending("PROTOCOL_DESTINATION", "Protocol destination and custody", "SECURITY", "Which address receives the protocol share and who controls it.", "PROTOCOL_DESTINATION_PENDING: an approved address, who controls it (multisig, program-controlled or other), whether it can change, per-cluster values and how it is verified. No developer or fixture address may stand in for it."),
    {
      id: "CHARITY_PAYOUT_MODEL", title: "Charity payout destination", category: "PRODUCT", status: "DECIDED", version: 1, provenance: "EXISTING_CONFIGURATION", environments: ALL, invalidatesReadiness: true,
      value: { model: "ONE_VERIFIED_WALLET_PER_CHARITY", rules: ["the charity is VERIFIED in the registry", "exactly one verified, well-formed Solana wallet exists for it", "that address is part of the plan and expected state", "a change to it makes the recorded plan stale"] },
      missing: null,
      summary: "One verified payout wallet per charity. More than one verified wallet, or none, leaves the destination unresolved and blocks readiness. No donation is executed.",
    },
    {
      id: "TAX_RESERVE_MODEL", title: "Launch tax reserve allocation", category: "PRODUCT", status: "DECIDED", version: 1, provenance: "EXISTING_CONFIGURATION", environments: ALL, invalidatesReadiness: true,
      value: { model: "CREATOR_CONTROLLED_ADDRESS_FROM_LAUNCH_CONFIGURATION", separateFromPersonalTaxReserve: true, usesPersonalReserveTables: false },
      missing: null,
      summary: "The launch tax reserve allocation is a creator-controlled address stored in the launch configuration. It is unrelated to a user's personal Tax Reserve and shares none of its tables. The asset it would receive depends on the pending fee split scope.",
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
  ] as Decision[]),
});

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
