/**
 * Deployment plan / transaction construction layer (Slice 13). Pure and deterministic. It BUILDS and REVIEWS. It never signs, sends,
 * confirms or reconciles, holds no key, and nothing here can move funds.
 *
 *   BUILD  -> REVIEW -> SIGN -> SEND -> CONFIRM -> RECONCILE -> VERIFY      (only BUILD and REVIEW exist; SIGN..VERIFY are not implemented)
 *
 * The plan is derived from the authoritative stored launch (never from a client-supplied parameter) and is a description of what a
 * user's wallet WOULD need to sign. Where the product has not decided something (supply allocation model, metadata URI, protocol
 * destination, liquidity venue, fee routing), the plan says so as an explicit blocker and is BLOCKED. Nothing is invented: no mint
 * address, no signature, no pool, no program id for fee routing, no allocation formula, no serialized transaction.
 * A plan that serializes would still not be "safe": safety is for the user to judge from the review, and verification is Slice 12's job.
 */
import { z } from "zod";
import type { Launch, LaunchConfig } from "./api/schemas";
import { ASSOCIATED_TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM } from "./chain/types";
import { CANONICAL_FEE_SPLIT, FEE_BUCKETS, isCanonicalFeeSplit, percentToBps, TOTAL_BPS, type FeeBucket } from "./feesplit";
import { sha256Hex } from "./hash";
import { DEPLOYMENT_POLICY, decisionOf, environmentFor, metadataDocumentSha256, policyHash, type DeploymentPolicy } from "./deploymentPolicy";
import { LAUNCH_NETWORKS, MAX_U64 } from "./launchConstants";
import { launchFingerprint } from "./launchModel";
import { stableStringify } from "./taxdata/report";

export const DEPLOYMENT_PLAN_VERSION = 1;
export const BUILDER_VERSION = "deployment-builder/1";

/** The single selected token program. Token-2022 and its extensions are NOT implemented and are refused. */
export const TOKEN_PROGRAM_IDS = { SPL_TOKEN: TOKEN_PROGRAM } as const;
export type TokenProgramName = keyof typeof TOKEN_PROGRAM_IDS;
export const SELECTED_TOKEN_PROGRAM: TokenProgramName = "SPL_TOKEN";
export const METAPLEX_TOKEN_METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
export const SPL_MINT_ACCOUNT_SIZE = 82;
export const MAX_DECIMALS = 9;

// ---------- explicit open decisions (facts, not guesses) ----------
export interface DeploymentFacts {
  // The three booleans below are the literal `false`: flipping any of them is a product decision that needs new instruction builders,
  // so it cannot be expressed as data. Only the metadata URI and the protocol destination are values a decision can supply.
  /** how initial token supply is distributed beyond the creator and liquidity shares */
  allocationModelDecided: false;
  /** where the metadata JSON lives (a URI the metadata account points at) */
  metadataUri: string | null;
  /** an address for the protocol allocation */
  protocolDestination: string | null;
  /** a liquidity venue and its instruction builder */
  liquidityBuilderImplemented: false;
  /** an on-chain mechanism that enforces the fee split */
  feeRoutingImplemented: false;
}
/** Today's truth. Changing any of these is a product decision that needs its own reviewed change. */
export const CURRENT_DEPLOYMENT_FACTS: Readonly<DeploymentFacts> = Object.freeze({
  allocationModelDecided: false, metadataUri: null, protocolDestination: null, liquidityBuilderImplemented: false, feeRoutingImplemented: false,
});

export const BLOCKER_CODES = [
  "ALLOCATION_MODEL_UNDEFINED", "METADATA_URI_UNDEFINED", "PROTOCOL_DESTINATION_NOT_CONFIGURED", "LIQUIDITY_BUILD_NOT_IMPLEMENTED",
  "FEE_ROUTING_NOT_IMPLEMENTED", "CHARITY_DESTINATION_UNRESOLVED",
] as const;
export type BlockerCode = (typeof BLOCKER_CODES)[number];
const BLOCKER_TEXT: Record<BlockerCode, { message: string; decision: string }> = {
  ALLOCATION_MODEL_UNDEFINED: { message: "The configuration defines a creator share and a liquidity share of supply, but not where the rest goes. No allocation formula is invented.", decision: "Decide the initial token supply allocation model (who receives which share, and whether charity, reserve or protocol receive tokens at all)." },
  METADATA_URI_UNDEFINED: { message: "No metadata JSON URI is configured, so the metadata account cannot be fully specified. Nothing is fetched or invented.", decision: "Decide where token metadata JSON is hosted and who maintains it." },
  PROTOCOL_DESTINATION_NOT_CONFIGURED: { message: "No protocol destination address is configured. The protocol share has no recipient.", decision: "Decide the protocol wallet and its custody." },
  LIQUIDITY_BUILD_NOT_IMPLEMENTED: { message: "Liquidity is configured but no venue or instruction builder exists. No pool is invented.", decision: "Decide the liquidity venue, the pair (token/SOL or token/USDC) and the LP position handling." },
  FEE_ROUTING_NOT_IMPLEMENTED: { message: "The 60/15/15/10 split is a configuration. No on-chain mechanism enforces it, and no program is invented.", decision: "Decide whether fee routing needs a custom program or an AMM integration, and how the split is enforced." },
  CHARITY_DESTINATION_UNRESOLVED: { message: "The registry has no single verified wallet address for the selected charity.", decision: "Resolve exactly one verified charity wallet in the registry." },
};

// ---------- failure model ----------
export const FAILURE_STAGES = ["BUILD_ERROR", "SIGNING_ERROR", "SUBMISSION_ERROR", "CONFIRMATION_ERROR", "RECONCILIATION_ERROR"] as const;
export type FailureStage = (typeof FAILURE_STAGES)[number];
export const BUILD_ERROR_CODES = [
  "LAUNCH_NOT_READY", "STALE_REVIEW", "INVALID_NETWORK", "INVALID_SUPPLY", "INVALID_DECIMALS", "INVALID_AUTHORITY_POLICY", "INVALID_FEE_SPLIT", "INVALID_ADDRESS",
  "UNSUPPORTED_TOKEN_PROGRAM", "PRECISION_LOSS", "ALLOCATION_OVERFLOW", "CHARITY_NOT_FOUND", "CHARITY_NOT_VERIFIED",
] as const;
export type BuildErrorCode = (typeof BUILD_ERROR_CODES)[number];
/** Failures that can only happen after BUILD. Listed so the vocabulary is fixed before Slice 14; NONE of these is implemented or ever faked. */
export const FUTURE_FAILURES: ReadonlyArray<{ stage: Exclude<FailureStage, "BUILD_ERROR">; code: string; meaning: string }> = [
  { stage: "SIGNING_ERROR", code: "USER_REJECTED_SIGNATURE", meaning: "The user declined to sign in their wallet." },
  { stage: "SIGNING_ERROR", code: "WALLET_MISMATCH", meaning: "The signing wallet is not the configured creator wallet." },
  { stage: "SUBMISSION_ERROR", code: "INSUFFICIENT_SOL", meaning: "The fee payer cannot cover rent and network fees." },
  { stage: "SUBMISSION_ERROR", code: "TRANSACTION_TOO_LARGE", meaning: "The serialized transaction exceeds the packet limit." },
  { stage: "SUBMISSION_ERROR", code: "COMPUTE_BUDGET_EXCEEDED", meaning: "Simulation or execution needs more compute than requested." },
  { stage: "SUBMISSION_ERROR", code: "BLOCKHASH_EXPIRED", meaning: "The recent blockhash expired before submission." },
  { stage: "SUBMISSION_ERROR", code: "RPC_UNAVAILABLE", meaning: "No RPC endpoint accepted the transaction." },
  { stage: "CONFIRMATION_ERROR", code: "CONFIRMATION_TIMEOUT", meaning: "The network did not confirm in time. The outcome is unknown, not failed." },
  { stage: "RECONCILIATION_ERROR", code: "STATE_MISMATCH", meaning: "Observed on-chain state differs from the expected state." },
];
export interface BuildError { stage: "BUILD_ERROR"; code: BuildErrorCode; field: string; message: string }

export { base58ByteLength, base58Encode, fixtureAddress, isValidSolanaAddress } from "./solanaAddress";
import { isValidSolanaAddress } from "./solanaAddress";

// ---------- secret material guard ----------
const SECRET_KEY_RE = /^(private[_-]?key|secret[_-]?key|seed[_-]?phrase|mnemonic|recovery[_-]?phrase|keypair|secret|private)$/i;
/** Names of any property (at any depth) that looks like key material. Used to refuse such input outright; values are never inspected or echoed. */
export function findSecretFields(v: unknown, path = "", depth = 0): string[] {
  if (depth > 6 || v === null || typeof v !== "object") return [];
  const out: string[] = [];
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) out.push(path ? `${path}.${k}` : k);
    out.push(...findSecretFields(x, path ? `${path}.${k}` : k, depth + 1));
  }
  return out;
}

// ---------- plan shape ----------
const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const Raw = z.string().regex(/^(0|[1-9]\d{0,19})$/);
const NullableRaw = Raw.nullable();
export const DeploymentBlocker = z.object({ code: z.enum(BLOCKER_CODES), message: z.string(), decision: z.string() });
const AccountRef = z.object({ ref: z.string(), role: z.string(), signer: z.boolean(), writable: z.boolean(), address: z.string().nullable(), addressNote: z.string().nullable() });
export const PlannedInstruction = z.object({
  id: z.string(), txIndex: z.number().int().min(0), order: z.number().int().min(0),
  program: z.enum(["SYSTEM", "SPL_TOKEN", "ASSOCIATED_TOKEN", "METAPLEX_TOKEN_METADATA"]), programId: z.string(), kind: z.string(), description: z.string(),
  accounts: z.array(AccountRef), data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  status: z.enum(["PLANNED", "BLOCKED"]), blockedBy: z.array(z.enum(BLOCKER_CODES)), dependsOn: z.array(z.string()),
});
export const PlannedTransaction = z.object({
  index: z.number().int().min(0), id: z.string(), label: z.string(), instructionIds: z.array(z.string()), dependsOnTransactions: z.array(z.number().int()),
  requiredSigners: z.array(z.string()), writableAccounts: z.array(z.string()), readonlyAccounts: z.array(z.string()),
  status: z.enum(["PLANNED", "BLOCKED"]),
  /** never populated here: serializing needs the mint public key and a recent blockhash, both unknown until signing time */
  unsignedBytes: z.null(), unsignedBytesNote: z.string(),
});
const Destination = z.object({
  role: z.enum(["CREATOR", "TAX_RESERVE", "CHARITY", "PROTOCOL", "LIQUIDITY"]), address: z.string().nullable(),
  provenance: z.enum(["LAUNCH_CONFIGURATION", "CHARITY_REGISTRY", "NOT_CONFIGURED", "RESERVED_FOR_FUTURE"]),
  validation: z.enum(["VALID_ADDRESS", "INVALID_ADDRESS", "NOT_CONFIGURED", "UNRESOLVED", "RESERVED"]),
});
const AuthorityPlan = z.object({
  policy: z.enum(["disabled", "creator"]), initial: z.string().nullable(), final: z.string().nullable(),
  /** the exact instruction that reaches the final state, or null when no instruction is needed */
  instruction: z.string().nullable(), note: z.string(),
});
export const ExpectedState = z.object({
  provenance: z.literal("EXPECTED_NOT_OBSERVED"),
  network: z.enum(LAUNCH_NETWORKS), cluster: z.enum(["devnet", "mainnet-beta"]), tokenProgram: z.string(), tokenProgramName: z.literal("SPL_TOKEN"),
  /** null until the mint keypair exists in the wallet context; an observation fills it later */
  mintAddress: z.null(), decimals: z.number().int(), supplyRaw: Raw,
  mintAuthority: z.string().nullable(), freezeAuthority: z.string().nullable(),
  metadata: z.object({ name: z.string(), symbol: z.string(), uri: z.string().nullable(), documentSha256: Hex64, updateAuthority: z.string(), isMutable: z.boolean(), sellerFeeBasisPoints: z.literal(0), provenance: z.enum(["USER_PROVIDED", "TO_BE_WRITTEN"]) }),
  allocations: z.array(z.object({ role: z.string(), recipient: z.string().nullable(), amountRaw: NullableRaw, status: z.enum(["DEFINED", "UNDEFINED"]) })),
  destinations: z.array(z.object({ role: z.string(), address: z.string().nullable() })),
  feeRouting: z.object({ status: z.literal("NOT_IMPLEMENTED"), configuredBps: z.object({ creator: z.number().int(), taxReserve: z.number().int(), charity: z.number().int(), protocol: z.number().int() }), onChainEnforced: z.literal(false) }),
  liquidity: z.object({ kind: z.literal("LIQUIDITY_EXPECTED"), status: z.literal("LIQUIDITY_BUILD_NOT_IMPLEMENTED"), initialLiquidityUsdc: z.string(), lockDays: z.number().int(), poolAddress: z.null() }),
  /** what an observer found; always null here. Expected and observed liquidity are different things. */
  liquidityObserved: z.null(),
  configFingerprint: Hex64, planHash: Hex64,
});
export type ExpectedState = z.infer<typeof ExpectedState>;

export const DeploymentPlan = z.object({
  identity: z.object({
    launchId: z.string().uuid(), network: z.enum(LAUNCH_NETWORKS), tokenProgram: z.object({ name: z.enum(["SPL_TOKEN"]), programId: z.string(), token2022: z.literal("NOT_IMPLEMENTED") }),
    creatorWallet: z.string(), planVersion: z.number().int(), builderVersion: z.string(), planId: z.string(), planHash: Hex64, configFingerprint: Hex64, reviewedFingerprint: Hex64,
    /** the deployment policy (decisions) this plan was built under; a changed decision changes the plan hash */
    policyVersion: z.number().int(), policyHash: Hex64,
  }),
  environment: z.object({
    cluster: z.enum(["devnet", "mainnet-beta"]), environmentId: z.string(), rpcEnvironment: z.string(), executionAllowed: z.literal(false),
    programs: z.object({ systemProgram: z.string(), tokenProgram: z.string(), associatedTokenProgram: z.string(), metadataProgram: z.string() }),
  }),
  status: z.enum(["BLOCKED", "READY_FOR_REVIEW"]),
  blockers: z.array(DeploymentBlocker),
  /** always false in this slice: there is no execution path */
  executionEnabled: z.literal(false),
  labels: z.tuple([z.literal("NOT DEPLOYED"), z.literal("NOT SIGNED"), z.literal("NO FUNDS MOVED")]),
  token: z.object({ name: z.string(), symbol: z.string(), decimals: z.number().int(), totalSupply: z.string(), supplyRaw: Raw }),
  mint: z.object({
    strategy: z.literal("CLIENT_GENERATED_KEYPAIR"), address: z.null(),
    note: z.string(),
  }),
  authorities: z.object({ mint: AuthorityPlan, freeze: AuthorityPlan }),
  metadata: z.object({
    program: z.literal("METAPLEX_TOKEN_METADATA"), programId: z.string(), name: z.string(), symbol: z.string(), uri: z.string().nullable(), sellerFeeBasisPoints: z.literal(0),
    updateAuthority: z.string(), isMutable: z.boolean(), account: z.null(), accountNote: z.string(),
    provenance: z.enum(["USER_PROVIDED", "TO_BE_WRITTEN"]), verified: z.literal(false), documentSha256: Hex64, imageUri: z.string().nullable(), website: z.string().nullable(), contentFetched: z.literal(false),
  }),
  supplyAllocations: z.array(z.object({ role: z.enum(["CREATOR", "LIQUIDITY", "UNASSIGNED"]), bps: z.number().int().nullable(), amountRaw: NullableRaw, status: z.enum(["DEFINED", "UNDEFINED"]), note: z.string() })),
  feeAllocations: z.object({
    label: z.literal("Configured fee split (not token supply)"), enforcement: z.literal("not_enforced"),
    buckets: z.array(z.object({ bucket: z.enum(["creator", "taxReserve", "charity", "protocol"]), bps: z.number().int(), destinationRole: z.string() })),
  }),
  feeRouting: z.object({ status: z.literal("NOT_IMPLEMENTED"), onChain: z.literal(false), program: z.null(), note: z.string() }),
  liquidity: z.object({
    status: z.literal("LIQUIDITY_BUILD_NOT_IMPLEMENTED"), venue: z.null(), poolAddress: z.null(), initialLiquidityUsdc: z.string(), supplyBps: z.number().int(), lockDays: z.number().int(),
    tokensRaw: NullableRaw, note: z.string(),
  }),
  destinations: z.array(Destination),
  transactions: z.array(PlannedTransaction),
  instructions: z.array(PlannedInstruction),
  movements: z.array(z.object({ kind: z.enum(["LAMPORTS", "TOKEN"]), from: z.string(), to: z.string(), amount: z.string().nullable(), note: z.string() })),
  computeBudget: z.object({ status: z.literal("NOT_MEASURED"), note: z.string() }),
  rent: z.object({ status: z.literal("REQUIRES_RPC"), note: z.string() }),
  signingBoundary: z.object({
    serverSigns: z.literal(false), serverHoldsKeys: z.literal(false), serverAcceptsKeyMaterial: z.literal(false), submission: z.literal("NOT_IMPLEMENTED"),
    mintKeypair: z.literal("GENERATED_IN_WALLET_CONTEXT_PRIVATE_KEY_NEVER_SENT"), futureFlow: z.array(z.string()),
  }),
  expectedState: ExpectedState,
  dataSource: z.enum(["demo", "database", "chain"]),
});
export type DeploymentPlan = z.infer<typeof DeploymentPlan>;
export type PlannedInstruction = z.infer<typeof PlannedInstruction>;

export interface PlanCharity { id: string; verificationState: string; walletAddress: string | null }
export interface PlanInput {
  launch: Launch;
  charity: PlanCharity | null;
  tokenProgram?: string;
  facts?: DeploymentFacts;
  /** the decisions in force; defaults to DEPLOYMENT_POLICY */
  policy?: DeploymentPolicy;
}
export type PlanResult = { ok: true; plan: DeploymentPlan } | { ok: false; errors: BuildError[] };

const err = (code: BuildErrorCode, field: string, message: string): BuildError => ({ stage: "BUILD_ERROR", code, field, message });
const SIGNING_FLOW = [
  "Server builds the unsigned transaction(s) from the reviewed launch.",
  "The browser shows the review. The wallet signs locally; the mint keypair is generated in the wallet context and its private key is never sent to the server.",
  "A signed transaction is submitted, its signature tracked and confirmed (not implemented).",
  "Observed on-chain state is compared with the expected state, and Token Proof decides whether it matches (not implemented).",
];

/** exact base-unit share of a supply, refusing any share that would need rounding */
function share(raw: bigint, bps: number): { ok: true; value: bigint } | { ok: false } {
  const n = raw * BigInt(bps);
  return n % BigInt(TOTAL_BPS) === 0n ? { ok: true, value: n / BigInt(TOTAL_BPS) } : { ok: false };
}

export function planStatus(blockers: readonly unknown[]): DeploymentPlan["status"] {
  return blockers.length === 0 ? "READY_FOR_REVIEW" : "BLOCKED";
}

/**
 * buildDeploymentPlan: validates the authoritative launch and returns the plan or build errors. Pure; no I/O; no clock; no randomness.
 * The plan hash covers every field above except the hash itself, so a changed configuration or decision changes it, and a timestamp
 * cannot (none is included).
 */
export function buildDeploymentPlan(input: PlanInput): PlanResult {
  const { launch, charity } = input;
  const facts = input.facts ?? CURRENT_DEPLOYMENT_FACTS;
  const policy = input.policy ?? DEPLOYMENT_POLICY;
  const policyId = policyHash(policy);
  const tokenDecision = decisionOf(policy, "TOKEN_PROGRAM");
  const c: LaunchConfig = launch.config;
  const errors: BuildError[] = [];

  if (launch.status !== "READY") return { ok: false, errors: [err("LAUNCH_NOT_READY", "status", `A deployment plan needs a READY launch (this one is ${launch.status}).`)] };
  const current = launchFingerprint(c);
  if (!launch.review || !launch.review.passed || launch.review.fingerprint !== launch.fingerprint || current !== launch.fingerprint || launch.review.fingerprint !== current) {
    return { ok: false, errors: [err("STALE_REVIEW", "fingerprint", "The configuration changed after it was reviewed, or was never reviewed. Review and mark it READY again.")] };
  }
  const programName = (input.tokenProgram ?? (tokenDecision.status === "DECIDED" ? (tokenDecision.value as { name: string }).name : "UNDECIDED")) as string;
  if (programName !== "SPL_TOKEN") errors.push(err("UNSUPPORTED_TOKEN_PROGRAM", "tokenProgram", "Only the SPL Token program is supported. Token-2022 and its extensions are not implemented."));
  const env = environmentFor(c.network);
  if (!(LAUNCH_NETWORKS as readonly string[]).includes(c.network) || !env || !env.launchAllowed) errors.push(err("INVALID_NETWORK", "network", "Unsupported network."));
  if (!Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > MAX_DECIMALS) errors.push(err("INVALID_DECIMALS", "decimals", `Decimals must be a whole number from 0 to ${MAX_DECIMALS}.`));
  let raw = 0n;
  if (!/^[1-9]\d{0,29}$/.test(c.totalSupply)) errors.push(err("INVALID_SUPPLY", "totalSupply", "Total supply must be a positive whole number written in plain digits."));
  else if (errors.every((e) => e.code !== "INVALID_DECIMALS")) {
    raw = BigInt(c.totalSupply) * 10n ** BigInt(c.decimals);
    if (raw > MAX_U64) errors.push(err("INVALID_SUPPLY", "totalSupply", "Total supply scaled by decimals does not fit an unsigned 64-bit integer."));
  }
  for (const [f, v] of [["mintAuthority", c.mintAuthority], ["freezeAuthority", c.freezeAuthority], ["updateAuthority", c.updateAuthority]] as const) {
    if (v !== "disabled" && v !== "creator") errors.push(err("INVALID_AUTHORITY_POLICY", f, "Authority policy must be 'disabled' or 'creator'."));
  }
  if (!isCanonicalFeeSplit(c.feeSplit)) errors.push(err("INVALID_FEE_SPLIT", "feeSplit", "The fee split must be exactly the canonical 60/15/15/10 split."));
  if (!isValidSolanaAddress(c.creatorWallet)) errors.push(err("INVALID_ADDRESS", "creatorWallet", "The creator wallet is not a valid Solana address."));
  if (!isValidSolanaAddress(c.taxReserveConfiguration.destinationAddress)) errors.push(err("INVALID_ADDRESS", "taxReserveConfiguration.destinationAddress", "The tax reserve destination is not a valid Solana address."));
  if (!charity) errors.push(err("CHARITY_NOT_FOUND", "charityConfiguration.charityId", "The selected charity is not in the registry."));
  else if (charity.verificationState !== "VERIFIED") errors.push(err("CHARITY_NOT_VERIFIED", "charityConfiguration.charityId", "The selected charity is not VERIFIED in the registry."));
  if (facts.protocolDestination !== null && !isValidSolanaAddress(facts.protocolDestination)) errors.push(err("INVALID_ADDRESS", "protocolDestination", "The protocol destination is not a valid Solana address."));

  const creatorBps = percentToBps(c.creatorAllocationPercent);
  const liqBps = percentToBps(c.liquidityConfiguration.supplyPercentage);
  let creatorRaw: bigint | null = null;
  let liqRaw: bigint | null = null;
  if (errors.length === 0) {
    if (creatorBps + liqBps > TOTAL_BPS) errors.push(err("ALLOCATION_OVERFLOW", "creatorAllocationPercent", "Creator and liquidity shares together exceed the total supply."));
    else {
      const a = share(raw, creatorBps), b = share(raw, liqBps);
      if (!a.ok) errors.push(err("PRECISION_LOSS", "creatorAllocationPercent", "The creator share is not a whole number of base units at this supply and decimals."));
      else creatorRaw = a.value;
      if (!b.ok) errors.push(err("PRECISION_LOSS", "liquidityConfiguration.supplyPercentage", "The liquidity share is not a whole number of base units at this supply and decimals."));
      else liqRaw = b.value;
    }
  }
  if (errors.length > 0 || creatorRaw === null || liqRaw === null) return { ok: false, errors };

  // ---- blockers: explicit, from facts ----
  const blockers: BlockerCode[] = [];
  if (!facts.allocationModelDecided) blockers.push("ALLOCATION_MODEL_UNDEFINED");
  if (facts.metadataUri === null) blockers.push("METADATA_URI_UNDEFINED");
  if (facts.protocolDestination === null) blockers.push("PROTOCOL_DESTINATION_NOT_CONFIGURED");
  if (!facts.liquidityBuilderImplemented) blockers.push("LIQUIDITY_BUILD_NOT_IMPLEMENTED");
  if (!facts.feeRoutingImplemented) blockers.push("FEE_ROUTING_NOT_IMPLEMENTED");
  const charityAddr = charity && charity.walletAddress && isValidSolanaAddress(charity.walletAddress) ? charity.walletAddress : null;
  if (charityAddr === null) blockers.push("CHARITY_DESTINATION_UNRESOLVED");

  const creator = c.creatorWallet;
  const mintAuthInitial = creator; // the creator must hold mint authority to mint the supply, whatever the final policy
  const mintAuthFinal = c.mintAuthority === "disabled" ? null : creator;
  const freezeFinal = c.freezeAuthority === "disabled" ? null : creator;
  const isMutable = c.updateAuthority === "creator";
  const uri = facts.metadataUri;
  const docHash = metadataDocumentSha256(c);
  const allocBlocked: BlockerCode[] = facts.allocationModelDecided ? [] : ["ALLOCATION_MODEL_UNDEFINED"];
  const metaBlocked: BlockerCode[] = uri === null ? ["METADATA_URI_UNDEFINED"] : [];
  const acct = (ref: string, role: string, signer: boolean, writable: boolean, address: string | null, addressNote: string | null = null) => ({ ref, role, signer, writable, address, addressNote });
  const MINT_NOTE = "Generated in the wallet context at signing time; unknown to the server";
  const PDA_NOTE = "Derived from the mint address, which is not known yet";

  const instr: PlannedInstruction[] = [
    {
      id: "create-mint-account", txIndex: 0, order: 0, program: "SYSTEM", programId: SYSTEM_PROGRAM, kind: "createAccount",
      description: `Create the token mint account (${SPL_MINT_ACCOUNT_SIZE} bytes) owned by the SPL Token program; the creator pays rent.`,
      accounts: [acct("feePayer", "payer", true, true, creator), acct("mint", "new mint account", true, true, null, MINT_NOTE)],
      data: { space: SPL_MINT_ACCOUNT_SIZE, lamports: null, owner: TOKEN_PROGRAM }, status: "PLANNED", blockedBy: [], dependsOn: [],
    },
    {
      id: "initialize-mint", txIndex: 0, order: 1, program: "SPL_TOKEN", programId: TOKEN_PROGRAM, kind: "initializeMint2",
      description: `Initialize the mint with ${c.decimals} decimals, mint authority = the creator${c.freezeAuthority === "disabled" ? " and NO freeze authority" : ", freeze authority = the creator"}.`,
      accounts: [acct("mint", "mint", false, true, null, MINT_NOTE)],
      data: { decimals: c.decimals, mintAuthority: mintAuthInitial, freezeAuthority: freezeFinal }, status: "PLANNED", blockedBy: [], dependsOn: ["create-mint-account"],
    },
    {
      id: "create-metadata", txIndex: 0, order: 2, program: "METAPLEX_TOKEN_METADATA", programId: METAPLEX_TOKEN_METADATA_PROGRAM, kind: "createMetadataAccountV3",
      description: `Write the token metadata (name, symbol${uri === null ? ", URI NOT YET DECIDED" : ", URI"}). ${isMutable ? "The creator keeps the update authority and can change it later." : "The metadata is created not mutable."}`,
      accounts: [acct("metadata", "metadata PDA", false, true, null, PDA_NOTE), acct("mint", "mint", false, false, null, MINT_NOTE), acct("mintAuthority", "mint authority", true, false, creator), acct("feePayer", "payer", true, true, creator), acct("updateAuthority", "update authority", false, false, creator)],
      data: { name: c.name, symbol: c.symbol, uri, sellerFeeBasisPoints: 0, isMutable, creators: null, collection: null }, status: metaBlocked.length ? "BLOCKED" : "PLANNED", blockedBy: metaBlocked, dependsOn: ["initialize-mint"],
    },
    {
      id: "create-creator-token-account", txIndex: 1, order: 0, program: "ASSOCIATED_TOKEN", programId: ASSOCIATED_TOKEN_PROGRAM, kind: "createIdempotent",
      description: "Create the creator's associated token account for this mint (needed to receive any minted supply).",
      accounts: [acct("feePayer", "payer", true, true, creator), acct("creatorTokenAccount", "associated token account", false, true, null, PDA_NOTE), acct("creator", "owner", false, false, creator), acct("mint", "mint", false, false, null, MINT_NOTE)],
      data: {}, status: allocBlocked.length ? "BLOCKED" : "PLANNED", blockedBy: allocBlocked, dependsOn: ["create-metadata"],
    },
    {
      id: "mint-supply", txIndex: 1, order: 1, program: "SPL_TOKEN", programId: TOKEN_PROGRAM, kind: "mintTo",
      description: "Mint the supply to its recipients. BLOCKED: who receives which share beyond the creator and liquidity shares is undecided, so no amount or recipient is written.",
      accounts: [acct("mint", "mint", false, true, null, MINT_NOTE), acct("creatorTokenAccount", "destination", false, true, null, PDA_NOTE), acct("mintAuthority", "mint authority", true, false, creator)],
      data: { amountRaw: null }, status: "BLOCKED", blockedBy: ["ALLOCATION_MODEL_UNDEFINED"], dependsOn: ["create-creator-token-account"],
    },
  ];
  if (c.mintAuthority === "disabled") {
    instr.push({
      id: "revoke-mint-authority", txIndex: 1, order: 2, program: "SPL_TOKEN", programId: TOKEN_PROGRAM, kind: "setAuthority",
      description: "Set the mint authority to NONE after the supply is minted. Until this instruction executes the creator still holds mint authority.",
      accounts: [acct("mint", "mint", false, true, null, MINT_NOTE), acct("mintAuthority", "current authority", true, false, creator)],
      data: { authorityType: "MintTokens", newAuthority: null }, status: "BLOCKED", blockedBy: ["ALLOCATION_MODEL_UNDEFINED"], dependsOn: ["mint-supply"],
    });
  }
  const txSpecs: Array<{ index: number; id: string; label: string; deps: number[] }> = [
    { index: 0, id: "tx-create-mint-and-metadata", label: "Create the mint and its metadata", deps: [] },
    { index: 1, id: "tx-mint-supply-and-finalize-authorities", label: "Mint the supply and finalize authorities", deps: [0] },
  ];
  const transactions = txSpecs.map((t) => {
    const ins = instr.filter((i) => i.txIndex === t.index);
    const accts = ins.flatMap((i) => i.accounts);
    const uniq = (xs: string[]) => [...new Set(xs)];
    const signers = uniq(accts.filter((a) => a.signer).map((a) => a.ref));
    const writable = uniq(accts.filter((a) => a.writable).map((a) => a.ref));
    return {
      index: t.index, id: t.id, label: t.label, instructionIds: ins.map((i) => i.id), dependsOnTransactions: t.deps, requiredSigners: signers, writableAccounts: writable,
      readonlyAccounts: uniq(accts.map((a) => a.ref)).filter((r) => !writable.includes(r)),
      status: ins.some((i) => i.status === "BLOCKED") ? ("BLOCKED" as const) : ("PLANNED" as const),
      unsignedBytes: null, unsignedBytesNote: "Not serialized: it needs the mint public key and a recent blockhash, which exist only at signing time.",
    };
  });

  const destinations: DeploymentPlan["destinations"] = [
    { role: "CREATOR", address: creator, provenance: "LAUNCH_CONFIGURATION", validation: "VALID_ADDRESS" },
    { role: "TAX_RESERVE", address: c.taxReserveConfiguration.destinationAddress, provenance: "LAUNCH_CONFIGURATION", validation: "VALID_ADDRESS" },
    { role: "CHARITY", address: charityAddr, provenance: charityAddr ? "CHARITY_REGISTRY" : "NOT_CONFIGURED", validation: charityAddr ? "VALID_ADDRESS" : "UNRESOLVED" },
    { role: "PROTOCOL", address: facts.protocolDestination, provenance: facts.protocolDestination ? "LAUNCH_CONFIGURATION" : "NOT_CONFIGURED", validation: facts.protocolDestination ? "VALID_ADDRESS" : "NOT_CONFIGURED" },
    { role: "LIQUIDITY", address: null, provenance: "RESERVED_FOR_FUTURE", validation: "RESERVED" },
  ];
  const unassigned = raw - creatorRaw - liqRaw;
  const supplyAllocations: DeploymentPlan["supplyAllocations"] = [
    { role: "CREATOR", bps: creatorBps, amountRaw: creatorRaw.toString(), status: "DEFINED", note: "Share of supply the creator configured for themself." },
    { role: "LIQUIDITY", bps: liqBps, amountRaw: liqRaw.toString(), status: "DEFINED", note: "Share of supply configured for liquidity. No venue exists, so none of it can be placed." },
    { role: "UNASSIGNED", bps: TOTAL_BPS - creatorBps - liqBps, amountRaw: unassigned.toString(), status: "UNDEFINED", note: "No allocation model says where this remainder goes. None is invented." },
  ];
  const feeRoleOf: Record<FeeBucket, string> = { creator: "CREATOR", taxReserve: "TAX_RESERVE", charity: "CHARITY", protocol: "PROTOCOL" };
  const feeBuckets = FEE_BUCKETS.map((b) => ({ bucket: b, bps: CANONICAL_FEE_SPLIT[b], destinationRole: feeRoleOf[b] }));
  const blockerList = blockers.map((code) => ({ code, ...BLOCKER_TEXT[code] }));

  const canonical = {
    planVersion: DEPLOYMENT_PLAN_VERSION, builderVersion: BUILDER_VERSION, launchId: launch.id, network: c.network, tokenProgram: { name: "SPL_TOKEN" as const, programId: TOKEN_PROGRAM },
    configFingerprint: launch.fingerprint, reviewedFingerprint: launch.review.fingerprint, creator,
    token: { name: c.name, symbol: c.symbol, decimals: c.decimals, supplyRaw: raw.toString() },
    authorities: { mint: { initial: mintAuthInitial, final: mintAuthFinal }, freeze: { initial: freezeFinal, final: freezeFinal }, updateIsMutable: isMutable },
    metadata: { uri, imageUri: c.imageUri, website: c.website, documentSha256: docHash },
    policyHash: policyId, cluster: c.network,
    supplyAllocations, feeBuckets, destinations, instructions: instr.map((i) => ({ id: i.id, tx: i.txIndex, kind: i.kind, data: i.data, status: i.status, blockedBy: i.blockedBy })),
    liquidity: { usdc: c.liquidityConfiguration.initialLiquidityUsdc, supplyBps: liqBps, lockDays: c.liquidityConfiguration.lockDays },
    blockers,
  };
  const planHash = sha256Hex(stableStringify(canonical));
  const configuredBps = { creator: c.feeSplit.creator, taxReserve: c.feeSplit.taxReserve, charity: c.feeSplit.charity, protocol: c.feeSplit.protocol };
  const metaProv = "USER_PROVIDED" as const;
  const auth = (policy: "disabled" | "creator", initial: string | null, final: string | null, instruction: string | null, note: string) => ({ policy, initial, final, instruction, note });

  const plan: DeploymentPlan = {
    identity: {
      launchId: launch.id, network: c.network, tokenProgram: { name: "SPL_TOKEN", programId: TOKEN_PROGRAM, token2022: "NOT_IMPLEMENTED" }, creatorWallet: creator,
      planVersion: DEPLOYMENT_PLAN_VERSION, builderVersion: BUILDER_VERSION, planId: `${launch.id}:v${DEPLOYMENT_PLAN_VERSION}:${planHash.slice(0, 16)}`, planHash,
      configFingerprint: launch.fingerprint, reviewedFingerprint: launch.review.fingerprint, policyVersion: policy.version, policyHash: policyId,
    },
    environment: { cluster: c.network, environmentId: env!.environmentId, rpcEnvironment: env!.rpcEnvironment, executionAllowed: false, programs: env!.programs },
    status: planStatus(blockers), blockers: blockerList, executionEnabled: false, labels: ["NOT DEPLOYED", "NOT SIGNED", "NO FUNDS MOVED"],
    token: { name: c.name, symbol: c.symbol, decimals: c.decimals, totalSupply: c.totalSupply, supplyRaw: raw.toString() },
    mint: { strategy: "CLIENT_GENERATED_KEYPAIR", address: null, note: "The mint keypair is generated in the wallet context at signing time. Its private key never reaches the server, and the server never generates or stores one. The mint address is therefore unknown now and is not invented." },
    authorities: {
      mint: auth(c.mintAuthority, mintAuthInitial, mintAuthFinal, c.mintAuthority === "disabled" ? "revoke-mint-authority" : null,
        c.mintAuthority === "disabled" ? "The creator holds mint authority during deployment. It is set to NONE only when 'revoke-mint-authority' executes after minting." : "The creator keeps mint authority."),
      freeze: auth(c.freezeAuthority, freezeFinal, freezeFinal, null, c.freezeAuthority === "disabled" ? "No freeze authority is set when the mint is initialized, so no revoke instruction is needed." : "The creator holds freeze authority."),
    },
    metadata: {
      program: "METAPLEX_TOKEN_METADATA", programId: METAPLEX_TOKEN_METADATA_PROGRAM, name: c.name, symbol: c.symbol, uri, sellerFeeBasisPoints: 0, updateAuthority: creator, isMutable,
      account: null, accountNote: PDA_NOTE, provenance: metaProv, verified: false, documentSha256: docHash, imageUri: c.imageUri, website: c.website, contentFetched: false,
    },
    supplyAllocations,
    feeAllocations: { label: "Configured fee split (not token supply)", enforcement: "not_enforced", buckets: feeBuckets },
    feeRouting: { status: "NOT_IMPLEMENTED", onChain: false, program: null, note: "The split is a database configuration. No on-chain mechanism enforces it and no program is assumed." },
    liquidity: {
      status: "LIQUIDITY_BUILD_NOT_IMPLEMENTED", venue: null, poolAddress: null, initialLiquidityUsdc: c.liquidityConfiguration.initialLiquidityUsdc, supplyBps: liqBps,
      lockDays: c.liquidityConfiguration.lockDays, tokensRaw: liqRaw.toString(), note: "Venue, pair, LP representation and lock mechanism are undecided. No pool, no liquidity transaction.",
    },
    destinations, transactions, instructions: instr,
    movements: [
      { kind: "LAMPORTS", from: "feePayer (creator)", to: "mint account (rent)", amount: null, note: "Rent exemption needs a live cluster read; not computed here." },
      { kind: "LAMPORTS", from: "feePayer (creator)", to: "metadata account (rent)", amount: null, note: "Rent exemption needs a live cluster read; not computed here." },
      { kind: "LAMPORTS", from: "feePayer (creator)", to: "creator token account (rent)", amount: null, note: "Rent exemption needs a live cluster read; not computed here." },
      { kind: "TOKEN", from: "mint", to: "recipients", amount: null, note: "Blocked: no allocation model. The full supply (in base units) is shown under token.supplyRaw." },
    ],
    computeBudget: { status: "NOT_MEASURED", note: `${COMPUTE_BUDGET_PROGRAM} instructions are not added: compute needs are measured by simulation, which needs RPC and a built transaction.` },
    rent: { status: "REQUIRES_RPC", note: "Rent-exempt minimums come from the cluster. Not estimated here." },
    signingBoundary: { serverSigns: false, serverHoldsKeys: false, serverAcceptsKeyMaterial: false, submission: "NOT_IMPLEMENTED", mintKeypair: "GENERATED_IN_WALLET_CONTEXT_PRIVATE_KEY_NEVER_SENT", futureFlow: SIGNING_FLOW },
    expectedState: {
      provenance: "EXPECTED_NOT_OBSERVED", network: c.network, cluster: c.network, tokenProgram: TOKEN_PROGRAM, tokenProgramName: "SPL_TOKEN", mintAddress: null, decimals: c.decimals, supplyRaw: raw.toString(),
      mintAuthority: mintAuthFinal, freezeAuthority: freezeFinal,
      metadata: { name: c.name, symbol: c.symbol, uri, documentSha256: docHash, updateAuthority: creator, isMutable, sellerFeeBasisPoints: 0, provenance: uri === null ? "USER_PROVIDED" : "TO_BE_WRITTEN" },
      allocations: supplyAllocations.map((a) => ({ role: a.role, recipient: a.role === "CREATOR" ? creator : null, amountRaw: a.amountRaw, status: a.status })),
      destinations: destinations.map((d) => ({ role: d.role, address: d.address })),
      feeRouting: { status: "NOT_IMPLEMENTED", configuredBps, onChainEnforced: false },
      liquidity: { kind: "LIQUIDITY_EXPECTED", status: "LIQUIDITY_BUILD_NOT_IMPLEMENTED", initialLiquidityUsdc: c.liquidityConfiguration.initialLiquidityUsdc, lockDays: c.liquidityConfiguration.lockDays, poolAddress: null },
      liquidityObserved: null,
      configFingerprint: launch.fingerprint, planHash,
    },
    dataSource: launch.dataSource,
  };
  return { ok: true, plan: DeploymentPlan.parse(plan) };
}

// ---------- review: generated from the SAME plan, never a second display model ----------
export interface DeploymentReview {
  planHash: string; status: DeploymentPlan["status"]; headline: string; labels: DeploymentPlan["labels"]; executionEnabled: false;
  whatWillHappen: string[]; whoReceivesWhat: Array<{ role: string; address: string | null; what: string; status: string }>; whatDoesNotHappen: string[];
  walletWillSign: Array<{ transaction: string; label: string; signers: string[]; status: string }>; blockers: DeploymentPlan["blockers"];
}
const fmt = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export function buildDeploymentReview(plan: DeploymentPlan): DeploymentReview {
  const t = plan.token;
  return {
    planHash: plan.identity.planHash, status: plan.status, labels: plan.labels, executionEnabled: false,
    headline: plan.status === "BLOCKED" ? "PLAN BLOCKED: DECISIONS REQUIRED. Nothing can be executed." : "READY FOR USER REVIEW. Execution is not enabled in this beta.",
    whatWillHappen: plan.instructions.map((i) => `${i.status === "BLOCKED" ? "[BLOCKED] " : ""}${i.description}`)
      .concat([`Token: ${t.name} (${t.symbol}), ${t.decimals} decimals, total supply ${fmt(t.totalSupply)} (${fmt(t.supplyRaw)} base units).`]),
    whoReceivesWhat: [
      ...plan.supplyAllocations.map((a) => ({ role: `${a.role} (token supply)`, address: a.role === "CREATOR" ? plan.identity.creatorWallet : null, what: a.amountRaw === null ? "undefined" : `${fmt(a.amountRaw)} base units${a.bps === null ? "" : ` (${a.bps / 100}%)`}`, status: a.status })),
      ...plan.feeAllocations.buckets.map((b) => {
        const d = plan.destinations.find((x) => x.role === b.destinationRole)!;
        return { role: `${b.destinationRole} (fee share)`, address: d.address, what: `${b.bps / 100}% of fees, configured only (not enforced on-chain)`, status: d.validation };
      }),
    ],
    whatDoesNotHappen: [
      "No server custody: the server holds no key and cannot sign.",
      "No private key, seed phrase or mnemonic is collected.",
      "No automatic signing and no hidden transfer.",
      "No destination is used that is not shown here.",
      "No authority is created or revoked except as listed above.",
      "No liquidity pool is created and no fee routing exists on-chain.",
      "Nothing has been deployed, signed or sent, and no funds have moved.",
    ],
    walletWillSign: plan.transactions.map((x) => ({ transaction: x.id, label: x.label, signers: x.requiredSigners, status: x.status })),
    blockers: plan.blockers,
  };
}

/**
 * What Slice 12 can compare against once an observer exists: the plan's expected state restated in the proof's own terms.
 * Pure projection; it adds no claim.
 */
export function expectedStateForProof(plan: DeploymentPlan) {
  const e = plan.expectedState;
  return { network: e.network, decimals: e.decimals, supplyRaw: e.supplyRaw, mintAuthority: e.mintAuthority, freezeAuthority: e.freezeAuthority, name: e.metadata.name, symbol: e.metadata.symbol, feeBps: e.feeRouting.configuredBps, cluster: e.cluster, tokenProgram: e.tokenProgramName, metadataDocumentSha256: e.metadata.documentSha256, configFingerprint: e.configFingerprint, planHash: e.planHash };
}

// ---------- API response schemas ----------
export const DeploymentReviewSchema = z.object({
  planHash: Hex64, status: z.enum(["BLOCKED", "READY_FOR_REVIEW"]), headline: z.string(), labels: z.tuple([z.literal("NOT DEPLOYED"), z.literal("NOT SIGNED"), z.literal("NO FUNDS MOVED")]),
  executionEnabled: z.literal(false), whatWillHappen: z.array(z.string()),
  whoReceivesWhat: z.array(z.object({ role: z.string(), address: z.string().nullable(), what: z.string(), status: z.string() })),
  whatDoesNotHappen: z.array(z.string()),
  walletWillSign: z.array(z.object({ transaction: z.string(), label: z.string(), signers: z.array(z.string()), status: z.string() })),
  blockers: z.array(DeploymentBlocker),
});
export const DeploymentPlanResponse = z.object({
  plan: DeploymentPlan,
  /** true once this exact plan hash has been recorded (append-only). A record is not an execution. */
  recorded: z.boolean(),
  /** recorded plans for this launch whose hash differs: earlier configurations, no longer current */
  supersededPlans: z.number().int().min(0),
  review: DeploymentReviewSchema,
});
export type DeploymentPlanResponse = z.infer<typeof DeploymentPlanResponse>;
export const DeploymentReviewResponse = z.object({ review: DeploymentReviewSchema, planId: z.string() });
export type DeploymentReviewResponse = z.infer<typeof DeploymentReviewResponse>;

/** Facts the builder takes from the policy in force. Only values a decision can supply are read; capabilities that need new code stay false. */
export function factsFromPolicy(policy: DeploymentPolicy): DeploymentFacts {
  const host = decisionOf(policy, "METADATA_HOSTING");
  const proto = decisionOf(policy, "PROTOCOL_DESTINATION");
  return {
    ...CURRENT_DEPLOYMENT_FACTS,
    metadataUri: host.status === "DECIDED" && host.value && typeof host.value.uri === "string" ? host.value.uri : null,
    protocolDestination: proto.status === "DECIDED" && proto.value && typeof proto.value.address === "string" ? proto.value.address : null,
  };
}
