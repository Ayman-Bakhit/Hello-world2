/**
 * Token Proof / transparency foundation (Slice 12). Pure and read-only. VERIFY, DON'T TRUST.
 *
 * Four different things, never conflated:
 *   CONFIGURED   what the creator intended (a launch configuration, committed to by its fingerprint)
 *   RECORDED     what a deployment record says (mint address, signature, the fingerprint it was deployed from)
 *   OBSERVED     what a chain observation reported (only from a privileged observer; nothing in this repo writes one in production)
 *   COMPARED     deterministic checks of configured/recorded vs observed, each PASS / FAIL / UNKNOWN / UNAVAILABLE / NOT_APPLICABLE
 *
 * `evaluateProof` is the ONE authoritative server-side rule. A proof is VERIFIED only when every required check passes AND the
 * observation is an on-chain (RPC) observation. A FIXTURE observation can never pass the OBSERVATION_FROM_CHAIN check, so a fixture
 * can never become VERIFIED however consistent it is. No client field influences any of this; no endpoint writes any of it.
 * A configuration fingerprint is a commitment to configuration, not a blockchain proof.
 */
import { z } from "zod";
import type { LaunchConfig } from "./api/schemas";
import { sha256Hex } from "./hash";
import { stableStringify } from "./taxdata/report";

export const PROOF_STATUSES = ["NOT_DEPLOYED", "AWAITING_OBSERVATION", "PARTIAL", "VERIFIED", "FAILED", "UNAVAILABLE"] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];
export const CHECK_STATES = ["PASS", "FAIL", "UNKNOWN", "UNAVAILABLE", "NOT_APPLICABLE"] as const;
export type CheckState = (typeof CHECK_STATES)[number];
export const OBSERVATION_SOURCES = ["FIXTURE", "RPC"] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];
export const PROOF_PROVENANCES = ["CONFIGURED", "USER_PROVIDED", "DEPLOYMENT_RECORD", "FIXTURE", "OBSERVED_ON_CHAIN", "VERIFIED_MATCH", "UNAVAILABLE"] as const;
export type ProofProvenance = (typeof PROOF_PROVENANCES)[number];
export const EVIDENCE_CLASSES = ["NONE", "FIXTURE", "OBSERVED_ON_CHAIN"] as const;

export const CHECK_IDS = [
  "DEPLOYMENT_SIGNATURE_PRESENT", "OBSERVATION_FROM_CHAIN", "NETWORK_MATCH", "MINT_ADDRESS_MATCH", "DECIMALS_MATCH", "SUPPLY_MATCH", "MINT_AUTHORITY_MATCH",
  "FREEZE_AUTHORITY_MATCH", "METADATA_MATCH", "CONFIGURATION_FINGERPRINT_MATCH", "FEE_SPLIT_MATCH", "CHARITY_MATCH", "TAX_RESERVE_DESTINATION_MATCH",
  "PROTOCOL_ALLOCATION_MATCH", "CREATOR_ALLOCATION_MATCH", "LIQUIDITY_CONFIGURATION_MATCH", "METADATA_CONTENT_NOT_FETCHED",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];
export const CHECK_LABELS: Record<CheckId, string> = {
  DEPLOYMENT_SIGNATURE_PRESENT: "Deployment signature recorded",
  OBSERVATION_FROM_CHAIN: "Observation comes from a blockchain",
  NETWORK_MATCH: "Network matches",
  MINT_ADDRESS_MATCH: "Mint address matches the deployment record",
  DECIMALS_MATCH: "Decimals match",
  SUPPLY_MATCH: "Total supply matches",
  MINT_AUTHORITY_MATCH: "Mint authority matches",
  FREEZE_AUTHORITY_MATCH: "Freeze authority matches",
  METADATA_MATCH: "On-chain name and symbol match",
  CONFIGURATION_FINGERPRINT_MATCH: "Deployed fingerprint equals the current configuration fingerprint",
  FEE_SPLIT_MATCH: "Fee split matches (60/15/15/10)",
  CHARITY_MATCH: "Charity recipient matches the registry",
  TAX_RESERVE_DESTINATION_MATCH: "Tax reserve allocation destination matches",
  PROTOCOL_ALLOCATION_MATCH: "Protocol allocation matches",
  CREATOR_ALLOCATION_MATCH: "Creator allocation recipient matches",
  LIQUIDITY_CONFIGURATION_MATCH: "Liquidity configuration matches",
  METADATA_CONTENT_NOT_FETCHED: "Description, image and links",
};

export const PROOF_COPY = {
  configuredNotProof: "Configured values describe the intended launch configuration. They are not blockchain proof.",
  verifiedOnlyWhen: "Verified Transparency is shown only when every required objective check passes against an on-chain observation.",
  metadataNote: "Metadata may be user-provided and is not verified unless a check explicitly says it matches on-chain data.",
  fingerprintNote: "A configuration fingerprint is a commitment to the configured launch state. It is not a blockchain proof by itself.",
  fixtureNote: "FIXTURE data is deterministic test data. It is not read from a blockchain and can never be verification.",
  noDeployment: "No token has been deployed for this configuration, so there is nothing on-chain to verify.",
  noExplorer: "No explorer link is shown: none is generated or implied by this system.",
  historyNote: "Observations are append-only and hash-chained so a change made outside the application is detectable. That is auditability, not a blockchain proof.",
} as const;

export const PROOF_STATUS_LABEL: Record<ProofStatus, string> = {
  NOT_DEPLOYED: "NOT DEPLOYED",
  AWAITING_OBSERVATION: "AWAITING OBSERVATION",
  PARTIAL: "PARTIAL PROOF",
  VERIFIED: "VERIFIED TRANSPARENCY",
  FAILED: "VERIFICATION FAILED",
  UNAVAILABLE: "PROOF UNAVAILABLE",
};

// ---------- observation model ----------
export type Observed<T> = { status: "OBSERVED"; value: T } | { status: "UNAVAILABLE"; reason: string };
export interface ObservedMetadata { address: string | null; name: string; symbol: string; uri: string | null }
export interface ObservedLiquidity { initialLiquidityUsdc: string; lockDays: number | null }
export interface ObservedFeeRouting {
  creatorBps: number; taxReserveBps: number; charityBps: number; protocolBps: number;
  creatorRecipient: string; taxReserveRecipient: string; charityRecipient: string;
}
export interface ChainObservation {
  source: ObservationSource;
  /** when the observer read the chain (ISO). Never "now": it is whatever the observation says. */
  observedAt: string;
  network: Observed<string>;
  mintAddress: Observed<string>;
  decimals: Observed<number>;
  /** raw base units, a u64 as a decimal string (never a float) */
  supplyRaw: Observed<string>;
  /** null = the authority is disabled (none). An address = that account holds it. */
  mintAuthority: Observed<string | null>;
  freezeAuthority: Observed<string | null>;
  metadata: Observed<ObservedMetadata>;
  liquidity: Observed<ObservedLiquidity>;
  feeRouting: Observed<ObservedFeeRouting>;
}
export const OBSERVED_FIELDS = ["network", "mintAddress", "decimals", "supplyRaw", "mintAuthority", "freezeAuthority", "metadata", "liquidity", "feeRouting"] as const;

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
export const isBase58Address = (s: unknown): s is string => typeof s === "string" && B58.test(s);
export const isBase58Signature = (s: unknown): s is string => typeof s === "string" && SIG.test(s);

const observed = <T extends z.ZodType>(v: T) => z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("OBSERVED"), value: v }),
  z.strictObject({ status: z.literal("UNAVAILABLE"), reason: z.string().min(1).max(300) }),
]);
const Addr = z.string().regex(B58, "base58 address");
const U64 = z.string().regex(/^(0|[1-9]\d{0,19})$/).refine((s) => /^\d+$/.test(s) && BigInt(s) <= 18_446_744_073_709_551_615n, "fits a u64");
const Bps = z.number().int().min(0).max(10_000);
export const ChainObservationSchema = z.strictObject({
  source: z.enum(OBSERVATION_SOURCES),
  observedAt: z.string().datetime(),
  network: observed(z.enum(["devnet", "mainnet-beta"])),
  mintAddress: observed(Addr),
  decimals: observed(z.number().int().min(0).max(9)),
  supplyRaw: observed(U64),
  mintAuthority: observed(Addr.nullable()),
  freezeAuthority: observed(Addr.nullable()),
  metadata: observed(z.strictObject({ address: Addr.nullable(), name: z.string().max(64), symbol: z.string().max(32), uri: z.string().max(500).nullable() })),
  liquidity: observed(z.strictObject({ initialLiquidityUsdc: z.string().regex(/^\d{1,12}$/), lockDays: z.number().int().min(0).max(3650).nullable() })),
  feeRouting: observed(z.strictObject({ creatorBps: Bps, taxReserveBps: Bps, charityBps: Bps, protocolBps: Bps, creatorRecipient: Addr, taxReserveRecipient: Addr, charityRecipient: Addr })),
});

/** What a deployment record asserts. It is a RECORD, not proof: only an observation can corroborate it. */
export interface DeploymentRecord {
  network: string;
  mintAddress: string | null;
  deploymentSignature: string | null;
  /** the configuration fingerprint the deployment was built from */
  deployedFingerprint: string | null;
}
export interface ProofSubject {
  launchId: string;
  dataSource: "demo" | "database" | "chain";
  config: LaunchConfig;
  /** the launch's CURRENT configuration fingerprint, recomputed from its stored configuration */
  fingerprint: string;
  charity: { id: string; name: string; walletAddress: string | null } | null;
}

// ---------- evaluation ----------
export interface ProofCheck {
  id: CheckId;
  label: string;
  state: CheckState;
  /** false only for informational NOT_APPLICABLE checks */
  required: boolean;
  explanation: string;
  configured: string | null;
  observed: string | null;
  provenance: ProofProvenance;
}
export interface ProofMismatch { checkId: CheckId; label: string; configured: string | null; observed: string | null }
export interface ProofEvaluation {
  status: ProofStatus;
  explanation: string;
  checks: ProofCheck[];
  mismatches: ProofMismatch[];
  evidenceClass: (typeof EVIDENCE_CLASSES)[number];
  /** derived here and nowhere else */
  verifiedOnChain: boolean;
  verifiedTransparency: boolean;
  summary: { pass: number; fail: number; unknown: number; unavailable: number; notApplicable: number; required: number };
}

const rawSupply = (c: LaunchConfig): string => (BigInt(c.totalSupply) * 10n ** BigInt(c.decimals)).toString();
const expectedAuthority = (policy: "disabled" | "creator", c: LaunchConfig): string | null => (policy === "disabled" ? null : c.creatorWallet);
const show = (v: string | number | null): string => (v === null ? "none (disabled)" : String(v));

export function evaluateProof(i: { subject: ProofSubject; deployment: DeploymentRecord | null; observation: ChainObservation | null; historyIntact: boolean }): ProofEvaluation {
  const { subject: s, deployment: d, observation: o } = i;
  const c = s.config;
  const empty = (status: ProofStatus, explanation: string, evidenceClass: ProofEvaluation["evidenceClass"] = "NONE"): ProofEvaluation => ({
    status, explanation, checks: [], mismatches: [], evidenceClass, verifiedOnChain: false, verifiedTransparency: false,
    summary: { pass: 0, fail: 0, unknown: 0, unavailable: 0, notApplicable: 0, required: 0 },
  });

  if (!d || d.mintAddress === null) return empty("NOT_DEPLOYED", PROOF_COPY.noDeployment);
  if (!i.historyIntact) return empty("UNAVAILABLE", "The observation history failed its integrity check, so it is not used. Nothing can be verified from it.", o ? (o.source === "RPC" ? "OBSERVED_ON_CHAIN" : "FIXTURE") : "NONE");

  const fixture = o?.source === "FIXTURE";
  const real = o?.source === "RPC";
  const passProv: ProofProvenance = real ? "VERIFIED_MATCH" : "FIXTURE";
  const obsProv: ProofProvenance = real ? "OBSERVED_ON_CHAIN" : fixture ? "FIXTURE" : "UNAVAILABLE";

  const mk = (id: CheckId, state: CheckState, explanation: string, configured: string | null, observedV: string | null, provenance: ProofProvenance, required = true): ProofCheck =>
    ({ id, label: CHECK_LABELS[id], state, required, explanation, configured, observed: observedV, provenance });

  /** configured/recorded value vs an observed field. UNKNOWN before any observation, UNAVAILABLE when the observer could not read it. */
  const compare = <T>(id: CheckId, expected: string | null, field: Observed<T> | undefined, read: (v: T) => string | null, what: string): ProofCheck => {
    if (!o || !field) return mk(id, "UNKNOWN", `${what} has not been observed yet.`, expected, null, "UNAVAILABLE");
    if (field.status === "UNAVAILABLE") return mk(id, "UNAVAILABLE", `${what} could not be observed: ${field.reason}`, expected, null, "UNAVAILABLE");
    const got = read(field.value);
    return got === expected
      ? mk(id, "PASS", `${what} observed and equal to the configured value.`, expected, got, passProv)
      : mk(id, "FAIL", `${what} observed and DIFFERENT from the configured value.`, expected, got, obsProv);
  };

  const checks: ProofCheck[] = [];
  checks.push(d.deploymentSignature
    ? mk("DEPLOYMENT_SIGNATURE_PRESENT", "PASS", "The deployment record has a transaction signature. Its presence is a recorded fact; it is not verified here.", null, d.deploymentSignature, "DEPLOYMENT_RECORD")
    : mk("DEPLOYMENT_SIGNATURE_PRESENT", "UNKNOWN", "The deployment record has no transaction signature.", null, null, "UNAVAILABLE"));
  checks.push(!o
    ? mk("OBSERVATION_FROM_CHAIN", "UNKNOWN", "No observation has been recorded yet.", null, null, "UNAVAILABLE")
    : real
      ? mk("OBSERVATION_FROM_CHAIN", "PASS", "The observation was recorded from a blockchain read.", null, "RPC", "OBSERVED_ON_CHAIN")
      : mk("OBSERVATION_FROM_CHAIN", "UNAVAILABLE", "The observation is a FIXTURE: it was not read from a blockchain.", null, "FIXTURE", "FIXTURE"));
  checks.push(compare("NETWORK_MATCH", c.network, o?.network, (v) => v, "The network"));
  checks.push(compare("MINT_ADDRESS_MATCH", d.mintAddress, o?.mintAddress, (v) => v, "The mint address"));
  checks.push(compare("DECIMALS_MATCH", String(c.decimals), o?.decimals, (v) => String(v), "The decimals"));
  checks.push(compare("SUPPLY_MATCH", rawSupply(c), o?.supplyRaw, (v) => v, "The total supply (base units)"));
  checks.push(compare("MINT_AUTHORITY_MATCH", show(expectedAuthority(c.mintAuthority, c)), o?.mintAuthority, (v) => show(v), "The mint authority"));
  checks.push(compare("FREEZE_AUTHORITY_MATCH", show(expectedAuthority(c.freezeAuthority, c)), o?.freezeAuthority, (v) => show(v), "The freeze authority"));
  checks.push(compare("METADATA_MATCH", `${c.name} / ${c.symbol}`, o?.metadata, (v) => `${v.name} / ${v.symbol}`, "The on-chain name and symbol"));
  checks.push(d.deployedFingerprint === null
    ? mk("CONFIGURATION_FINGERPRINT_MATCH", "UNKNOWN", "The deployment record does not say which configuration it was deployed from.", s.fingerprint, null, "UNAVAILABLE")
    : d.deployedFingerprint === s.fingerprint
      ? mk("CONFIGURATION_FINGERPRINT_MATCH", "PASS", "The configuration the token was deployed from is the current configuration. A fingerprint comparison, not an on-chain fact.", s.fingerprint, d.deployedFingerprint, "DEPLOYMENT_RECORD")
      : mk("CONFIGURATION_FINGERPRINT_MATCH", "FAIL", "The configuration changed after deployment: the fingerprints differ.", s.fingerprint, d.deployedFingerprint, "DEPLOYMENT_RECORD"));
  const fr = o?.feeRouting;
  const split = c.feeSplit;
  checks.push(compare("FEE_SPLIT_MATCH", `${split.creator}/${split.taxReserve}/${split.charity}/${split.protocol}`, fr, (v) => `${v.creatorBps}/${v.taxReserveBps}/${v.charityBps}/${v.protocolBps}`, "The fee routing split (bps)"));
  checks.push(compare("CHARITY_MATCH", s.charity?.walletAddress ?? null, fr, (v) => v.charityRecipient, "The charity recipient"));
  checks.push(compare("TAX_RESERVE_DESTINATION_MATCH", c.taxReserveConfiguration.destinationAddress, fr, (v) => v.taxReserveRecipient, "The tax reserve allocation destination"));
  checks.push(compare("PROTOCOL_ALLOCATION_MATCH", String(split.protocol), fr, (v) => String(v.protocolBps), "The protocol allocation (bps; no protocol address is configured, so only the share is compared)"));
  checks.push(compare("CREATOR_ALLOCATION_MATCH", c.creatorWallet, fr, (v) => v.creatorRecipient, "The creator allocation recipient"));
  checks.push(compare("LIQUIDITY_CONFIGURATION_MATCH", `${c.liquidityConfiguration.initialLiquidityUsdc} USDC, lock ${c.liquidityConfiguration.lockDays} days`, o?.liquidity,
    (v) => `${v.initialLiquidityUsdc} USDC, lock ${v.lockDays === null ? "none" : v.lockDays} days`, "The liquidity configuration"));
  checks.push(mk("METADATA_CONTENT_NOT_FETCHED", "NOT_APPLICABLE", "Description, image and links live off-chain. They are never fetched or loaded here and stay USER-PROVIDED.", null, null, "USER_PROVIDED", false));

  // a CHARITY_MATCH against a registry charity with no verified wallet cannot pass: the expected value is unknown, not "none"
  const ci = checks.findIndex((x) => x.id === "CHARITY_MATCH");
  if (s.charity?.walletAddress === null || !s.charity) {
    checks[ci] = mk("CHARITY_MATCH", o && fr?.status === "OBSERVED" ? "UNKNOWN" : checks[ci]!.state, "The registry has no verified wallet for the selected charity, so the recipient cannot be compared.", null, fr?.status === "OBSERVED" ? fr.value.charityRecipient : null, "UNAVAILABLE");
  }

  const summary = {
    pass: checks.filter((x) => x.state === "PASS").length, fail: checks.filter((x) => x.state === "FAIL").length, unknown: checks.filter((x) => x.state === "UNKNOWN").length,
    unavailable: checks.filter((x) => x.state === "UNAVAILABLE").length, notApplicable: checks.filter((x) => x.state === "NOT_APPLICABLE").length, required: checks.filter((x) => x.required).length,
  };
  const required = checks.filter((x) => x.required);
  const mismatches = checks.filter((x) => x.state === "FAIL").map((x) => ({ checkId: x.id, label: x.label, configured: x.configured, observed: x.observed }));
  const evidenceClass: ProofEvaluation["evidenceClass"] = real ? "OBSERVED_ON_CHAIN" : fixture ? "FIXTURE" : "NONE";
  const done = (status: ProofStatus, explanation: string): ProofEvaluation => {
    const verified = status === "VERIFIED" && real;
    return { status, explanation, checks, mismatches, evidenceClass, verifiedOnChain: verified, verifiedTransparency: verified, summary };
  };

  if (!o) return done("AWAITING_OBSERVATION", "A deployment is recorded, but no blockchain observation exists yet. Nothing is verified.");
  const allUnavailable = OBSERVED_FIELDS.every((f) => o[f].status === "UNAVAILABLE");
  if (allUnavailable) return done("UNAVAILABLE", "The observation could not read anything from the chain. Verification cannot be evaluated right now.");
  if (required.some((x) => x.state === "FAIL")) return done("FAILED", `${mismatches.length} required check${mismatches.length === 1 ? "" : "s"} failed: what was observed differs from what was configured or recorded.`);
  if (required.every((x) => x.state === "PASS")) return done("VERIFIED", "Every required objective check passed against an on-chain observation.");
  const objectivePass = checks.some((x) => x.state === "PASS" && x.id !== "DEPLOYMENT_SIGNATURE_PRESENT" && x.id !== "CONFIGURATION_FINGERPRINT_MATCH" && x.id !== "OBSERVATION_FROM_CHAIN");
  if (!objectivePass) return done("UNAVAILABLE", "No configured value could be compared with an observed one, so verification cannot be evaluated.");
  return done("PARTIAL", fixture
    ? "Checks were evaluated against FIXTURE data, which is not an on-chain observation. This is not verification."
    : "Some objective checks pass, but required checks are unknown or unavailable. This is not verification.");
}

// ---------- append-only observation chain (tamper-evident, not a blockchain proof) ----------
export function observationRowHash(i: { proofId: string; seq: number; source: ObservationSource; observedAt: string; observation: ChainObservation; prevHash: string | null }): string {
  return sha256Hex(stableStringify({ v: 1, ...i }));
}

// ---------- API response schemas ----------
const Uuid = z.string().uuid();
const Iso = z.string().datetime();
const Provenance = z.enum(PROOF_PROVENANCES);
export const ProofCheckSchema = z.object({
  id: z.enum(CHECK_IDS), label: z.string(), state: z.enum(CHECK_STATES), required: z.boolean(), explanation: z.string(),
  configured: z.string().nullable(), observed: z.string().nullable(), provenance: Provenance,
});
const ObservedView = <T extends z.ZodType>(v: T) => z.discriminatedUnion("status", [z.object({ status: z.literal("OBSERVED"), value: v }), z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() })]);
export const LaunchProof = z.object({
  launchId: Uuid,
  audience: z.enum(["owner", "public"]),
  status: z.enum(PROOF_STATUSES),
  statusLabel: z.string(),
  explanation: z.string(),
  /** derived on the server from the checks. There is no input that can set these. */
  verifiedOnChain: z.boolean(),
  verifiedTransparency: z.boolean(),
  evidence: z.object({ class: z.enum(EVIDENCE_CLASSES), source: z.enum(OBSERVATION_SOURCES).nullable(), observedAt: Iso.nullable(), observationCount: z.number().int().min(0), historyIntact: z.boolean() }),
  identity: z.object({
    network: z.enum(["devnet", "mainnet-beta"]),
    mintAddress: z.string().nullable(), mintProvenance: Provenance,
    deploymentSignature: z.string().nullable(), signatureProvenance: Provenance,
    observedAt: Iso.nullable(),
    /** always null: no explorer URL is generated or implied */
    explorerUrl: z.null(),
  }),
  configured: z.object({
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    deployedFingerprint: z.string().nullable(),
    name: z.string(), symbol: z.string(), decimals: z.number().int(), totalSupply: z.string(), expectedSupplyRaw: z.string(),
    mintAuthority: z.object({ policy: z.enum(["disabled", "creator"]), expected: z.string().nullable() }),
    freezeAuthority: z.object({ policy: z.enum(["disabled", "creator"]), expected: z.string().nullable() }),
    feeSplit: z.object({ creator: z.number().int(), taxReserve: z.number().int(), charity: z.number().int(), protocol: z.number().int() }),
    charity: z.object({ id: Uuid, name: z.string() }).nullable(),
    taxReserve: z.object({ bps: z.number().int(), destination: z.string().nullable() }),
    protocol: z.object({ bps: z.number().int(), recipient: z.null() }),
    creator: z.object({ bps: z.number().int(), address: z.string() }),
    liquidity: z.object({ initialLiquidityUsdc: z.string(), lockDays: z.number().int() }),
    metadata: z.object({ description: z.string(), imageUri: z.string().nullable(), website: z.string().nullable(), provenance: z.literal("USER_PROVIDED") }),
    provenance: z.literal("CONFIGURED"),
  }),
  observed: z.object({
    provenance: Provenance,
    source: z.enum(OBSERVATION_SOURCES),
    observedAt: Iso,
    network: ObservedView(z.string()),
    mintAddress: ObservedView(z.string()),
    decimals: ObservedView(z.number().int()),
    supplyRaw: ObservedView(z.string()),
    mintAuthority: ObservedView(z.string().nullable()),
    freezeAuthority: ObservedView(z.string().nullable()),
    metadata: ObservedView(z.object({ address: z.string().nullable(), name: z.string(), symbol: z.string(), uri: z.string().nullable() })),
    liquidity: ObservedView(z.object({ initialLiquidityUsdc: z.string(), lockDays: z.number().int().nullable() })),
    feeRouting: ObservedView(z.object({
      creatorBps: z.number().int(), taxReserveBps: z.number().int(), charityBps: z.number().int(), protocolBps: z.number().int(),
      creatorRecipient: z.string(), taxReserveRecipient: z.string().nullable(), charityRecipient: z.string(),
    })),
  }).nullable(),
  checks: z.array(ProofCheckSchema),
  mismatches: z.array(z.object({ checkId: z.enum(CHECK_IDS), label: z.string(), configured: z.string().nullable(), observed: z.string().nullable() })),
  summary: z.object({ pass: z.number().int(), fail: z.number().int(), unknown: z.number().int(), unavailable: z.number().int(), notApplicable: z.number().int(), required: z.number().int() }),
  disclosures: z.array(z.string()),
  dataSource: z.enum(["demo", "database", "chain"]),
});
export type LaunchProof = z.infer<typeof LaunchProof>;

const abbr = (a: string) => (a.length <= 10 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`);
export const REDACTED = "not shown publicly";

/**
 * Builds the response. The public form removes private wallet information (the tax reserve destination and recipient, full creator
 * address) and nothing else: mint address, signature and observed facts are public chain facts. Never adds a field.
 */
export function buildLaunchProof(i: {
  subject: ProofSubject; deployment: DeploymentRecord | null; observation: ChainObservation | null; observationCount: number; historyIntact: boolean; audience: "owner" | "public";
}): LaunchProof {
  const ev = evaluateProof({ subject: i.subject, deployment: i.deployment, observation: i.observation, historyIntact: i.historyIntact });
  const c = i.subject.config;
  const pub = i.audience === "public";
  const o = i.observation;
  const real = o?.source === "RPC";
  const obsProv: ProofProvenance = real ? "OBSERVED_ON_CHAIN" : o ? "FIXTURE" : "UNAVAILABLE";
  const hide = (v: string | null) => (v === null || !pub ? v : abbr(v));
  const redactCheck = (x: ProofCheck): ProofCheck => {
    if (!pub) return x;
    if (x.id === "TAX_RESERVE_DESTINATION_MATCH") return { ...x, configured: x.configured === null ? null : REDACTED, observed: x.observed === null ? null : REDACTED };
    if (x.id === "CREATOR_ALLOCATION_MATCH" || x.id === "MINT_AUTHORITY_MATCH" || x.id === "FREEZE_AUTHORITY_MATCH") return { ...x, configured: x.configured === null ? null : x.configured.split(" ").map((p) => (isBase58Address(p) ? abbr(p) : p)).join(" "), observed: x.observed === null ? null : x.observed.split(" ").map((p) => (isBase58Address(p) ? abbr(p) : p)).join(" ") };
    return x;
  };
  const checks = ev.checks.map(redactCheck);
  const view = <T,>(f: Observed<T>) => f;
  return LaunchProof.parse({
    launchId: i.subject.launchId, audience: i.audience, status: ev.status, statusLabel: PROOF_STATUS_LABEL[ev.status], explanation: ev.explanation,
    verifiedOnChain: ev.verifiedOnChain, verifiedTransparency: ev.verifiedTransparency,
    evidence: { class: ev.evidenceClass, source: o ? o.source : null, observedAt: o ? o.observedAt : null, observationCount: i.observationCount, historyIntact: i.historyIntact },
    identity: {
      network: c.network, mintAddress: i.deployment?.mintAddress ?? null, mintProvenance: i.deployment?.mintAddress ? "DEPLOYMENT_RECORD" : "UNAVAILABLE",
      deploymentSignature: i.deployment?.deploymentSignature ?? null, signatureProvenance: i.deployment?.deploymentSignature ? "DEPLOYMENT_RECORD" : "UNAVAILABLE",
      observedAt: o ? o.observedAt : null, explorerUrl: null,
    },
    configured: {
      fingerprint: i.subject.fingerprint, deployedFingerprint: i.deployment?.deployedFingerprint ?? null,
      name: c.name, symbol: c.symbol, decimals: c.decimals, totalSupply: c.totalSupply, expectedSupplyRaw: rawSupply(c),
      mintAuthority: { policy: c.mintAuthority, expected: hide(expectedAuthority(c.mintAuthority, c)) },
      freezeAuthority: { policy: c.freezeAuthority, expected: hide(expectedAuthority(c.freezeAuthority, c)) },
      feeSplit: { creator: c.feeSplit.creator, taxReserve: c.feeSplit.taxReserve, charity: c.feeSplit.charity, protocol: c.feeSplit.protocol },
      charity: i.subject.charity ? { id: i.subject.charity.id, name: i.subject.charity.name } : null,
      taxReserve: { bps: c.feeSplit.taxReserve, destination: pub ? null : c.taxReserveConfiguration.destinationAddress },
      protocol: { bps: c.feeSplit.protocol, recipient: null },
      creator: { bps: c.feeSplit.creator, address: pub ? abbr(c.creatorWallet) : c.creatorWallet },
      liquidity: { initialLiquidityUsdc: c.liquidityConfiguration.initialLiquidityUsdc, lockDays: c.liquidityConfiguration.lockDays },
      metadata: { description: c.description, imageUri: c.imageUri, website: c.website, provenance: "USER_PROVIDED" },
      provenance: "CONFIGURED",
    },
    observed: o && i.historyIntact
      ? {
          provenance: obsProv, source: o.source, observedAt: o.observedAt, network: view(o.network), mintAddress: view(o.mintAddress), decimals: view(o.decimals), supplyRaw: view(o.supplyRaw),
          mintAuthority: o.mintAuthority.status === "OBSERVED" ? { status: "OBSERVED", value: hide(o.mintAuthority.value) } : o.mintAuthority,
          freezeAuthority: o.freezeAuthority.status === "OBSERVED" ? { status: "OBSERVED", value: hide(o.freezeAuthority.value) } : o.freezeAuthority,
          metadata: view(o.metadata), liquidity: view(o.liquidity),
          feeRouting: o.feeRouting.status === "OBSERVED"
            ? { status: "OBSERVED", value: { ...o.feeRouting.value, creatorRecipient: hide(o.feeRouting.value.creatorRecipient) as string, taxReserveRecipient: pub ? null : o.feeRouting.value.taxReserveRecipient } }
            : o.feeRouting,
        }
      : null,
    checks, mismatches: ev.mismatches.map((m) => { const x = checks.find((k) => k.id === m.checkId)!; return { ...m, configured: x.configured, observed: x.observed }; }),
    summary: ev.summary,
    disclosures: [PROOF_COPY.configuredNotProof, PROOF_COPY.verifiedOnlyWhen, PROOF_COPY.metadataNote, PROOF_COPY.fingerprintNote, PROOF_COPY.noExplorer, ...(o?.source === "FIXTURE" ? [PROOF_COPY.fixtureNote] : []), PROOF_COPY.historyNote],
    dataSource: i.subject.dataSource,
  });
}
