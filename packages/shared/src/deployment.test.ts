import { describe, expect, it } from "vitest";
import { LaunchConfigSchema, type Launch } from "./api/schemas";
import { ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM } from "./chain/types";
import {
  BLOCKER_CODES, BUILD_ERROR_CODES, BUILDER_VERSION, CURRENT_DEPLOYMENT_FACTS, DEPLOYMENT_PLAN_VERSION, DeploymentPlan, FAILURE_STAGES, FUTURE_FAILURES, METAPLEX_TOKEN_METADATA_PROGRAM,
  base58Encode, buildDeploymentPlan, buildDeploymentReview, expectedStateForProof, findSecretFields, fixtureAddress, isValidSolanaAddress, planStatus, type DeploymentFacts, type PlanInput,
} from "./deployment";
import { DEPLOYMENT_POLICY, withDecisions } from "./deploymentPolicy";
import { CANONICAL_FEE_SPLIT } from "./feesplit";
import { BANNED_PHRASES } from "./language";
import { launchFingerprint } from "./launchModel";
import { evaluateProof } from "./proof";
import { DEPLOYMENT_FIXTURES, FIXTURE_CHARITY, buildDeploymentFixture, deploymentFixtureInput, fixtureReadyLaunch } from "./demo/deploymentFixtures";
import { FIXTURE_WALLETS, fixtureLaunchConfig, proofFixtureInputs } from "./demo/proofFixtures";

/** The policy as it stood in Slice 13: no supply allocation model. These tests exercise the builder's own rules, independent of the decided model. */
const PRE = withDecisions(DEPLOYMENT_POLICY, { SUPPLY_ALLOCATION_MODEL: { status: "PENDING", value: null, provenance: "NONE", missing: "pre-decision policy used by builder rule tests" } });
const ok = (i: PlanInput) => { const r = buildDeploymentPlan({ policy: PRE, ...i }); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.plan; };
const codes = (i: PlanInput) => { const r = buildDeploymentPlan({ policy: PRE, ...i }); return r.ok ? [] : r.errors.map((e) => e.code); };
const withCfg = (over: Record<string, unknown>, charity = FIXTURE_CHARITY): PlanInput => ({ launch: fixtureReadyLaunch({ ...fixtureLaunchConfig(), ...over } as never), charity });
const base = (): PlanInput => deploymentFixtureInput("A_VALID_READY");

describe("addresses", () => {
  it("accepts well-formed 32-byte keys and rejects everything else", () => {
    expect(isValidSolanaAddress(fixtureAddress("x"))).toBe(true);
    expect(isValidSolanaAddress(TOKEN_PROGRAM)).toBe(true); expect(isValidSolanaAddress(SYSTEM_PROGRAM)).toBe(true);
    for (const bad of ["", "DEMO3fB8cJ5yR1uH6dV2KEq47M", "0".repeat(40), "1".repeat(31), "a".repeat(50), 5, null, "So1111111111111111111111111111111111111112 "]) expect(isValidSolanaAddress(bad), String(bad)).toBe(false);
    expect(isValidSolanaAddress("1".repeat(33) + "2")).toBe(false); // decodes to the wrong length
  });
  it("base58 round trips shape", () => { expect(base58Encode(new Uint8Array(32).fill(7)).length).toBeGreaterThan(30); expect(isValidSolanaAddress(base58Encode(new Uint8Array(32).fill(255)))).toBe(true); });
});

describe("secret material guard", () => {
  it("finds key-material property names at any depth without echoing values", () => {
    expect(findSecretFields({ a: 1, privateKey: "x" })).toEqual(["privateKey"]);
    expect(findSecretFields({ nested: { deep: { Seed_Phrase: "x" } } })).toEqual(["nested.deep.Seed_Phrase"]);
    expect(findSecretFields({ mnemonic: 1, secretKey: 2, keypair: 3, secret: 4 }).sort()).toEqual(["keypair", "mnemonic", "secret", "secretKey"]);
    expect(findSecretFields({ name: "private key", note: "mnemonic" })).toEqual([]);
    expect(findSecretFields(null)).toEqual([]);
  });
});

describe("READY gate and validation (BUILD_ERROR)", () => {
  it("A/H: a valid READY launch builds a plan", () => { const p = ok(base()); expect(p.identity.launchId).toBe(base().launch.id); });
  it("B: every non-READY status is refused", () => {
    for (const status of ["DRAFT", "CONFIGURED", "REVIEW", "CANCELLED"] as const) expect(codes({ ...base(), launch: fixtureReadyLaunch(undefined, { status }) }), status).toEqual(["LAUNCH_NOT_READY"]);
  });
  it("C: a stale reviewed fingerprint, a missing review and a failed review are refused", () => {
    expect(codes(deploymentFixtureInput("C_STALE_REVIEW"))).toEqual(["STALE_REVIEW"]);
    const l = base().launch;
    expect(codes({ ...base(), launch: { ...l, review: null } })).toEqual(["STALE_REVIEW"]);
    expect(codes({ ...base(), launch: { ...l, review: { ...l.review!, passed: false } } })).toEqual(["STALE_REVIEW"]);
  });
  it("a configuration modified after review (stored fingerprint no longer matches) is refused", () => {
    const l = base().launch;
    expect(codes({ ...base(), launch: { ...l, config: { ...l.config, name: "Edited After Review" } } })).toEqual(["STALE_REVIEW"]);
    expect(codes({ ...base(), launch: { ...l, fingerprint: "b".repeat(64) } })).toEqual(["STALE_REVIEW"]);
  });
  it("D/E: invalid supply and decimals", () => {
    expect(codes(deploymentFixtureInput("D_INVALID_SUPPLY"))).toContain("INVALID_SUPPLY");
    expect(codes(deploymentFixtureInput("E_INVALID_DECIMALS"))).toContain("INVALID_DECIMALS");
    for (const s of ["-1", "1.5", "1e9", "NaN", "Infinity", "0x10", " 5", "", "00", "5n"]) expect(codes(withCfg({ totalSupply: s })), s).toContain("INVALID_SUPPLY");
    for (const d of [-1, 1.5, 10, Number.NaN, Infinity]) expect(codes(withCfg({ decimals: d })), String(d)).toContain("INVALID_DECIMALS");
  });
  it("F: invalid creator and reserve destinations", () => {
    expect(codes(deploymentFixtureInput("F_INVALID_DESTINATION"))).toContain("INVALID_ADDRESS");
    expect(codes(withCfg({ creatorWallet: "DEMO3fB8cJ5yR1uH6dV2KEq47M" }))).toContain("INVALID_ADDRESS");
  });
  it("G: invalid authority policy", () => {
    expect(codes(deploymentFixtureInput("G_INVALID_AUTHORITY"))).toContain("INVALID_AUTHORITY_POLICY");
    expect(codes(withCfg({ freezeAuthority: "anyone" }))).toContain("INVALID_AUTHORITY_POLICY");
    expect(codes(withCfg({ updateAuthority: "" }))).toContain("INVALID_AUTHORITY_POLICY");
  });
  it("I: only SPL Token; Token-2022 and anything else are refused", () => {
    expect(codes(deploymentFixtureInput("I_UNSUPPORTED_TOKEN_PROGRAM"))).toEqual(["UNSUPPORTED_TOKEN_PROGRAM"]);
    for (const t of ["TOKEN_2022", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", ""]) expect(codes({ ...base(), tokenProgram: t }), t).toContain("UNSUPPORTED_TOKEN_PROGRAM");
    expect(codes({ ...base(), tokenProgram: "SPL_TOKEN" })).toEqual([]);
  });
  it("fee split other than canonical is refused", () => {
    expect(codes(withCfg({ feeSplit: { creator: 5000, taxReserve: 2500, charity: 1500, protocol: 1000 } }))).toContain("INVALID_FEE_SPLIT");
    expect(codes(withCfg({ feeSplit: { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 999 } }))).toContain("INVALID_FEE_SPLIT");
  });
  it("charity: missing and unverified are refused", () => {
    expect(codes({ ...base(), charity: null })).toEqual(["CHARITY_NOT_FOUND"]);
    for (const s of ["UNVERIFIED", "PENDING_REVIEW", "SUSPENDED"]) expect(codes({ ...base(), charity: { ...FIXTURE_CHARITY, verificationState: s } }), s).toEqual(["CHARITY_NOT_VERIFIED"]);
  });
  it("an invalid protocol destination (if one is ever supplied) is refused", () => {
    expect(codes({ ...base(), facts: { ...CURRENT_DEPLOYMENT_FACTS, protocolDestination: "nope" } })).toContain("INVALID_ADDRESS");
  });
  it("N: supply x 10^decimals above u64 is refused; the boundary below it builds", () => {
    expect(codes(deploymentFixtureInput("N_OVERFLOW_BOUNDARY"))).toContain("INVALID_SUPPLY");
    expect(codes(withCfg({ totalSupply: "18446744073", decimals: 9 }))).toEqual([]);
    expect(codes(withCfg({ totalSupply: "18446744074", decimals: 9 }))).toContain("INVALID_SUPPLY");
    expect(codes(withCfg({ totalSupply: "18446744073709551616", decimals: 0, creatorAllocationPercent: "0", liquidityConfiguration: { initialLiquidityUsdc: "1", supplyPercentage: "100", lockDays: 0 } }))).toContain("INVALID_SUPPLY");
  });
  it("M: the maximum u64 supply builds with exact arithmetic (no float rounding)", () => {
    const p = ok(deploymentFixtureInput("M_MAX_SAFE_VALUES"));
    expect(p.token.supplyRaw).toBe("18446744073709551615"); expect(p.expectedState.supplyRaw).toBe("18446744073709551615");
    expect(p.supplyAllocations.find((a) => a.role === "LIQUIDITY")!.amountRaw).toBe("18446744073709551615");
    expect(p.supplyAllocations.find((a) => a.role === "UNASSIGNED")!.amountRaw).toBe("0");
  });
  it("a share that would need rounding is refused (precision loss) and shares above 100% overflow", () => {
    expect(codes(withCfg({ totalSupply: "7", decimals: 0, creatorAllocationPercent: "8" }))).toContain("PRECISION_LOSS");
    // each share is checked on its own: only the creator share is fractional here, then only the liquidity share
    expect(codes(withCfg({ totalSupply: "100", decimals: 0, creatorAllocationPercent: "1.5", liquidityConfiguration: { initialLiquidityUsdc: "1", supplyPercentage: "50", lockDays: 0 } }))).toEqual(["PRECISION_LOSS"]);
    expect(codes(withCfg({ totalSupply: "100", decimals: 0, creatorAllocationPercent: "0", liquidityConfiguration: { initialLiquidityUsdc: "1", supplyPercentage: "1.5", lockDays: 0 } }))).toEqual(["PRECISION_LOSS"]);
    expect(codes(withCfg({ creatorAllocationPercent: "70", liquidityConfiguration: { initialLiquidityUsdc: "1", supplyPercentage: "40", lockDays: 0 } }))).toEqual(["ALLOCATION_OVERFLOW"]);
  });
  it("every build error is a BUILD_ERROR with a known code and a field", () => {
    for (const f of DEPLOYMENT_FIXTURES) { const r = buildDeploymentFixture(f); if (!r.ok) for (const e of r.errors) { expect(e.stage).toBe("BUILD_ERROR"); expect(BUILD_ERROR_CODES).toContain(e.code); expect(e.field.length).toBeGreaterThan(0); } }
  });
});

describe("the plan (BLOCKED today, executable never)", () => {
  const plan = ok(base());
  it("is BLOCKED with every open decision named, and never executable", () => {
    expect(plan.status).toBe("BLOCKED"); expect(plan.executionEnabled).toBe(false); expect(plan.labels).toEqual(["NOT DEPLOYED", "NOT SIGNED", "NO FUNDS MOVED"]);
    expect(plan.blockers.map((b) => b.code).sort()).toEqual(["ALLOCATION_MODEL_UNDEFINED", "FEE_ROUTING_NOT_IMPLEMENTED", "LIQUIDITY_BUILD_NOT_IMPLEMENTED", "METADATA_URI_UNDEFINED", "PROTOCOL_DESTINATION_NOT_CONFIGURED"]);
    for (const b of plan.blockers) { expect(BLOCKER_CODES).toContain(b.code); expect(b.decision.length).toBeGreaterThan(10); }
    expect(planStatus([])).toBe("READY_FOR_REVIEW"); expect(planStatus(["x"])).toBe("BLOCKED");
  });
  it("no combination of supplied decisions can make it executable or lift the economics blockers", () => {
    const facts: DeploymentFacts = { ...CURRENT_DEPLOYMENT_FACTS, metadataUri: "https://example.org/meta.json", protocolDestination: fixtureAddress("protocol") };
    const p = ok({ ...base(), facts });
    expect(p.executionEnabled).toBe(false); expect(p.status).toBe("BLOCKED");
    expect(p.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["ALLOCATION_MODEL_UNDEFINED", "LIQUIDITY_BUILD_NOT_IMPLEMENTED", "FEE_ROUTING_NOT_IMPLEMENTED"]));
    expect(p.blockers.map((b) => b.code)).not.toContain("METADATA_URI_UNDEFINED"); expect(p.blockers.map((b) => b.code)).not.toContain("PROTOCOL_DESTINATION_NOT_CONFIGURED");
    expect(p.instructions.find((i) => i.id === "create-metadata")!.status).toBe("PLANNED");
    expect(p.instructions.find((i) => i.id === "mint-supply")!.status).toBe("BLOCKED");
  });
  it("an unresolved charity wallet is a blocker, not a guess", () => {
    const p = ok({ ...base(), charity: { ...FIXTURE_CHARITY, walletAddress: null } });
    expect(p.blockers.map((b) => b.code)).toContain("CHARITY_DESTINATION_UNRESOLVED");
    expect(p.destinations.find((d) => d.role === "CHARITY")).toMatchObject({ address: null, validation: "UNRESOLVED" });
    const q = ok({ ...base(), charity: { ...FIXTURE_CHARITY, walletAddress: "DEMOcharityWater111111111111" } });
    expect(q.destinations.find((d) => d.role === "CHARITY")!.address).toBeNull();
  });
  it("identity names the token program, builder and plan version; Token-2022 is explicitly not implemented", () => {
    expect(plan.identity).toMatchObject({ planVersion: DEPLOYMENT_PLAN_VERSION, builderVersion: BUILDER_VERSION, tokenProgram: { name: "SPL_TOKEN", programId: TOKEN_PROGRAM, token2022: "NOT_IMPLEMENTED" }, network: "devnet" });
    expect(plan.identity.planId).toBe(`${plan.identity.launchId}:v1:${plan.identity.planHash.slice(0, 16)}`);
    expect(plan.identity.configFingerprint).toBe(base().launch.fingerprint);
  });
  it("uses the canonical fee split and states it is configuration, not on-chain routing", () => {
    expect(Object.fromEntries(plan.feeAllocations.buckets.map((b) => [b.bucket, b.bps]))).toEqual(CANONICAL_FEE_SPLIT);
    expect(plan.feeAllocations.enforcement).toBe("not_enforced"); expect(plan.feeAllocations.label).toMatch(/not token supply/);
    expect(plan.feeRouting).toMatchObject({ status: "NOT_IMPLEMENTED", onChain: false, program: null });
    expect(plan.expectedState.feeRouting).toMatchObject({ status: "NOT_IMPLEMENTED", onChainEnforced: false, configuredBps: CANONICAL_FEE_SPLIT });
  });
  it("keeps token supply allocation apart from the fee split and invents no remainder formula", () => {
    const [creator, liq, rest] = plan.supplyAllocations;
    expect(creator).toMatchObject({ role: "CREATOR", bps: 800, status: "DEFINED", amountRaw: "80000000000000" });
    expect(liq).toMatchObject({ role: "LIQUIDITY", bps: 4000, status: "DEFINED", amountRaw: "400000000000000" });
    expect(rest).toMatchObject({ role: "UNASSIGNED", bps: 5200, status: "UNDEFINED", amountRaw: "520000000000000" });
    expect(BigInt(creator!.amountRaw!) + BigInt(liq!.amountRaw!) + BigInt(rest!.amountRaw!)).toBe(BigInt(plan.token.supplyRaw));
    expect(plan.supplyAllocations.some((a) => /CHARITY|RESERVE|PROTOCOL/.test(a.role))).toBe(false);
  });
  it("liquidity is a future stage: no venue, no pool, no fake transaction", () => {
    expect(plan.liquidity).toMatchObject({ status: "LIQUIDITY_BUILD_NOT_IMPLEMENTED", venue: null, poolAddress: null });
    expect(plan.instructions.some((i) => /liquidity|swap|pool/i.test(i.kind))).toBe(false);
  });
  it("mint address, metadata account, and unsigned bytes are never fabricated", () => {
    expect(plan.mint).toMatchObject({ strategy: "CLIENT_GENERATED_KEYPAIR", address: null }); expect(plan.expectedState.mintAddress).toBeNull(); expect(plan.metadata.account).toBeNull();
    for (const t of plan.transactions) expect(t.unsignedBytes).toBeNull();
    for (const i of plan.instructions) for (const a of i.accounts) if (["mint", "metadata", "creatorTokenAccount"].includes(a.ref)) expect(a.address).toBeNull();
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/"signature"|"blockhash"|explorer|solscan/i);
    expect(text.match(/\b[1-9A-HJ-NP-Za-km-z]{64,90}\b/g)).toBeNull(); // nothing shaped like a signature
  });
  it("uses only well-known program ids and no invented program", () => {
    const allowed = new Set([SYSTEM_PROGRAM, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, METAPLEX_TOKEN_METADATA_PROGRAM]);
    for (const i of plan.instructions) expect(allowed.has(i.programId), i.id).toBe(true);
    expect(plan.feeRouting.program).toBeNull();
  });
  it("authorities: disabled mint authority is revoked by an explicit later instruction, never implied", () => {
    expect(plan.authorities.mint).toMatchObject({ policy: "disabled", initial: fixtureLaunchConfig().creatorWallet, final: null, instruction: "revoke-mint-authority" });
    const revoke = plan.instructions.find((i) => i.id === "revoke-mint-authority")!;
    expect(revoke).toMatchObject({ kind: "setAuthority", data: { authorityType: "MintTokens", newAuthority: null }, dependsOn: ["mint-supply"], status: "BLOCKED" });
    expect(plan.expectedState.mintAuthority).toBeNull();
    expect(plan.authorities.mint.note).toMatch(/only when/);
  });
  it("authorities: freeze disabled means none at initialization; creator policies keep the creator and add no revoke", () => {
    expect(plan.instructions.find((i) => i.id === "initialize-mint")!.data).toMatchObject({ freezeAuthority: null, mintAuthority: fixtureLaunchConfig().creatorWallet });
    const p = ok(withCfg({ mintAuthority: "creator", freezeAuthority: "creator" }));
    expect(p.instructions.some((i) => i.id === "revoke-mint-authority")).toBe(false);
    expect(p.expectedState).toMatchObject({ mintAuthority: fixtureLaunchConfig().creatorWallet, freezeAuthority: fixtureLaunchConfig().creatorWallet });
    expect(p.authorities.mint.instruction).toBeNull();
  });
  it("metadata: user-provided, URI undecided, nothing fetched or verified, update authority explicit", () => {
    expect(plan.metadata).toMatchObject({ program: "METAPLEX_TOKEN_METADATA", provenance: "USER_PROVIDED", verified: false, contentFetched: false, uri: null, updateAuthority: fixtureLaunchConfig().creatorWallet, isMutable: true, sellerFeeBasisPoints: 0 });
    expect(ok({ ...base(), facts: { ...CURRENT_DEPLOYMENT_FACTS, metadataUri: "https://example.org/m.json" } }).metadata.uri).toBe("https://example.org/m.json");
    expect(ok(withCfg({ updateAuthority: "disabled" })).metadata.isMutable).toBe(false);
  });
  it("instructions are ordered, acyclic, and transactions list signers, writable and read-only accounts", () => {
    const ids = new Set(plan.instructions.map((i) => i.id));
    const seen = new Set<string>();
    for (const i of [...plan.instructions].sort((a, b) => a.txIndex - b.txIndex || a.order - b.order)) { for (const d of i.dependsOn) { expect(ids.has(d)).toBe(true); expect(seen.has(d), `${i.id} after ${d}`).toBe(true); } seen.add(i.id); }
    const [t0, t1] = plan.transactions;
    expect(t0!.requiredSigners).toEqual(expect.arrayContaining(["feePayer", "mint", "mintAuthority"])); expect(t0!.writableAccounts).toContain("mint");
    expect(t1!.dependsOnTransactions).toEqual([0]); expect(t0!.status).toBe("BLOCKED");
    for (const t of plan.transactions) for (const w of t.writableAccounts) expect(t.readonlyAccounts).not.toContain(w);
  });
  it("lamport and token amounts that need a cluster read are null, not estimated", () => {
    for (const m of plan.movements) expect(m.amount).toBeNull();
    expect(plan.rent.status).toBe("REQUIRES_RPC"); expect(plan.computeBudget.status).toBe("NOT_MEASURED");
    expect(plan.instructions.find((i) => i.id === "create-mint-account")!.data).toMatchObject({ lamports: null, space: 82 });
  });
  it("destinations show role, address, provenance and validation", () => {
    expect(plan.destinations.map((d) => d.role)).toEqual(["CREATOR", "TAX_RESERVE", "CHARITY", "PROTOCOL", "LIQUIDITY"]);
    expect(plan.destinations.find((d) => d.role === "TAX_RESERVE")).toMatchObject({ address: FIXTURE_WALLETS.reserve, provenance: "LAUNCH_CONFIGURATION", validation: "VALID_ADDRESS" });
    expect(plan.destinations.find((d) => d.role === "CHARITY")).toMatchObject({ address: FIXTURE_WALLETS.charity, provenance: "CHARITY_REGISTRY" });
    expect(plan.destinations.find((d) => d.role === "PROTOCOL")).toMatchObject({ address: null, validation: "NOT_CONFIGURED" });
    expect(plan.destinations.find((d) => d.role === "LIQUIDITY")).toMatchObject({ address: null, validation: "RESERVED" });
  });
  it("the signing boundary: no server signing, keys, key material or submission", () => {
    expect(plan.signingBoundary).toMatchObject({ serverSigns: false, serverHoldsKeys: false, serverAcceptsKeyMaterial: false, submission: "NOT_IMPLEMENTED", mintKeypair: "GENERATED_IN_WALLET_CONTEXT_PRIVATE_KEY_NEVER_SENT" });
    expect(JSON.stringify(plan)).not.toMatch(/privateKey|secretKey|seedPhrase|mnemonic/i);
  });
  it("the response schema rejects a plan that claims execution or invents a mint", () => {
    expect(DeploymentPlan.safeParse({ ...plan, executionEnabled: true }).success).toBe(false);
    expect(DeploymentPlan.safeParse({ ...plan, mint: { ...plan.mint, address: fixtureAddress("m") } }).success).toBe(false);
    expect(DeploymentPlan.safeParse({ ...plan, metadata: { ...plan.metadata, verified: true } }).success).toBe(false);
    expect(DeploymentPlan.safeParse({ ...plan, feeRouting: { ...plan.feeRouting, onChain: true } }).success).toBe(false);
    expect(DeploymentPlan.safeParse({ ...plan, signingBoundary: { ...plan.signingBoundary, serverSigns: true } }).success).toBe(false);
  });
});

describe("determinism, hashing and idempotency", () => {
  it("the same input produces the same plan, byte for byte", () => {
    expect(JSON.stringify(ok(base()))).toBe(JSON.stringify(ok(base())));
  });
  it("irrelevant timestamps and counters do not change the hash", () => {
    const l = base().launch;
    const t = ok({ ...base(), launch: { ...l, updatedAt: "2030-01-01T00:00:00.000Z", createdAt: "2029-01-01T00:00:00.000Z", readyAt: "2031-01-01T00:00:00.000Z", revision: 99, review: { ...l.review!, reviewedAt: "2032-01-01T00:00:00.000Z" } } });
    expect(t.identity.planHash).toBe(ok(base()).identity.planHash);
  });
  it("every meaningful change changes the hash (and differs from every other change)", () => {
    const h = new Set<string>([ok(base()).identity.planHash]);
    const variants: Array<Record<string, unknown>> = [
      { name: "Other Name" }, { symbol: "OTHR" }, { totalSupply: "2000000000" }, { decimals: 9 }, { network: "mainnet-beta" }, { mintAuthority: "creator" }, { freezeAuthority: "creator" }, { updateAuthority: "disabled" },
      { creatorWallet: FIXTURE_WALLETS.other }, { taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: FIXTURE_WALLETS.other } },
      { creatorAllocationPercent: "10" }, { liquidityConfiguration: { initialLiquidityUsdc: "50001", supplyPercentage: "40", lockDays: 30 } }, { liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 31 } },
      { imageUri: "https://example.org/a.png" }, { website: "https://example.org" }, { description: "different" },
    ];
    for (const v of variants) { const p = ok(withCfg(v)); expect(h.has(p.identity.planHash), JSON.stringify(v)).toBe(false); h.add(p.identity.planHash); }
    const c = ok({ ...base(), charity: { ...FIXTURE_CHARITY, walletAddress: FIXTURE_WALLETS.other } }); expect(h.has(c.identity.planHash)).toBe(false); h.add(c.identity.planHash);
    const m = ok({ ...base(), facts: { ...CURRENT_DEPLOYMENT_FACTS, metadataUri: "https://example.org/m.json" } }); expect(h.has(m.identity.planHash)).toBe(false);
  });
  it("O: a changed configuration yields a different plan, and the old plan no longer matches the new fingerprint", () => {
    const a = ok(deploymentFixtureInput("A_VALID_READY")), o = ok(deploymentFixtureInput("O_CHANGED_CONFIGURATION"));
    expect(o.identity.planHash).not.toBe(a.identity.planHash); expect(o.identity.configFingerprint).not.toBe(a.identity.configFingerprint); expect(o.identity.planId).not.toBe(a.identity.planId);
    expect(a.identity.configFingerprint).toBe(launchFingerprint(fixtureLaunchConfig()));
  });
  it("the plan hash binds the plan: it equals the expected-state hash and the identity hash", () => {
    const p = ok(base()); expect(p.expectedState.planHash).toBe(p.identity.planHash); expect(p.expectedState.configFingerprint).toBe(p.identity.configFingerprint);
  });
});

describe("review (generated from the same plan)", () => {
  const plan = ok(base()); const r = buildDeploymentReview(plan);
  it("states what happens, who receives what, what does not happen, and what the wallet signs", () => {
    expect(r.labels).toEqual(["NOT DEPLOYED", "NOT SIGNED", "NO FUNDS MOVED"]); expect(r.executionEnabled).toBe(false); expect(r.headline).toMatch(/BLOCKED/);
    expect(r.whatWillHappen.length).toBe(plan.instructions.length + 1);
    for (const i of plan.instructions) expect(r.whatWillHappen.some((l) => l.includes(i.description))).toBe(true);
    expect(r.whoReceivesWhat.map((x) => x.role)).toEqual(expect.arrayContaining(["CREATOR (token supply)", "UNASSIGNED (token supply)", "CHARITY (fee share)", "TAX_RESERVE (fee share)", "PROTOCOL (fee share)"]));
    expect(r.whatDoesNotHappen.join(" ")).toMatch(/no server custody/i); expect(r.whatDoesNotHappen.join(" ")).toMatch(/seed phrase/i);
    expect(r.walletWillSign.map((w) => w.transaction)).toEqual(plan.transactions.map((t) => t.id));
    expect(r.planHash).toBe(plan.identity.planHash); expect(r.blockers).toEqual(plan.blockers);
  });
  it("never claims deployment, safety or immutability", () => {
    const t = JSON.stringify(r) + JSON.stringify({ ...plan, signingBoundary: { ...plan.signingBoundary, futureFlow: [] } }).replace(/"verified":false/g, ""); // the future flow is prose about unimplemented steps; "verified": false is the field that denies verification
    expect(t).not.toMatch(/\b(deployed successfully|safe|guaranteed|trustless|immutable|audited|confirmed|verified)\b/i);
    for (const b of BANNED_PHRASES) expect(t.toLowerCase()).not.toContain(b.toLowerCase());
  });
});

describe("bridge to Slice 12 (expected vs proof)", () => {
  it("the plan's expected state agrees with what the proof evaluator expects for the same configuration", () => {
    const e = expectedStateForProof(ok(base()));
    const p = proofFixtureInputs("FULL_MATCH");
    const ev = evaluateProof({ ...p, historyIntact: true });
    const cfg = (id: string) => ev.checks.find((c) => c.id === id)!.configured;
    expect(cfg("NETWORK_MATCH")).toBe(e.network); expect(cfg("DECIMALS_MATCH")).toBe(String(e.decimals)); expect(cfg("SUPPLY_MATCH")).toBe(e.supplyRaw);
    expect(cfg("MINT_AUTHORITY_MATCH")).toBe(e.mintAuthority === null ? "none (disabled)" : e.mintAuthority);
    expect(cfg("FREEZE_AUTHORITY_MATCH")).toBe(e.freezeAuthority === null ? "none (disabled)" : e.freezeAuthority);
    expect(cfg("METADATA_MATCH")).toBe(`${e.name} / ${e.symbol}`);
    expect(cfg("FEE_SPLIT_MATCH")).toBe(`${e.feeBps.creator}/${e.feeBps.taxReserve}/${e.feeBps.charity}/${e.feeBps.protocol}`);
    expect(e.configFingerprint).toBe(p.subject.fingerprint);
  });
  it("expected state is labeled EXPECTED_NOT_OBSERVED and is not a proof input that can verify anything", () => {
    expect(ok(base()).expectedState.provenance).toBe("EXPECTED_NOT_OBSERVED");
  });
});

describe("failure model", () => {
  it("separates the five stages; only BUILD_ERROR is implemented", () => {
    expect(FAILURE_STAGES).toEqual(["BUILD_ERROR", "SIGNING_ERROR", "SUBMISSION_ERROR", "CONFIRMATION_ERROR", "RECONCILIATION_ERROR"]);
    for (const f of FUTURE_FAILURES) { expect(f.stage).not.toBe("BUILD_ERROR"); expect((BUILD_ERROR_CODES as readonly string[]).includes(f.code)).toBe(false); }
    expect(new Set(FUTURE_FAILURES.map((f) => f.stage)).size).toBe(4);
  });
  it("the launch config schema itself still rejects a non-canonical split (defense in depth)", () => {
    expect(LaunchConfigSchema.safeParse({ ...fixtureLaunchConfig(), feeSplit: { creator: 5000, taxReserve: 2500, charity: 1500, protocol: 1000 } }).success).toBe(false);
  });
});

describe("a Launch value is not trusted beyond what the builder re-checks", () => {
  it("rejects a forged READY with a mismatched review even when the config itself is valid", () => {
    const l: Launch = fixtureReadyLaunch();
    expect(codes({ ...base(), launch: { ...l, review: { ...l.review!, fingerprint: "c".repeat(64) } } })).toEqual(["STALE_REVIEW"]);
  });
});

describe("the decided supply allocation model (creator 8%, liquidity 40%, burn 52%)", () => {
  const direct = (i: PlanInput) => buildDeploymentPlan(i);
  it("the plan carries exactly creator, liquidity and an explicit burn, every unit assigned, charity, reserve and protocol receiving none", () => {
    const r = direct(base()); if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const a = r.plan.supplyAllocations;
    expect(a.map((x) => [x.role, x.bps, x.amountRaw, x.status])).toEqual([["CREATOR", 800, "80000000000000", "DEFINED"], ["LIQUIDITY", 4000, "400000000000000", "DEFINED"], ["BURN", 5200, "520000000000000", "DEFINED"]]);
    expect(a.reduce((s2, x) => s2 + x.bps!, 0)).toBe(10000); expect(a.reduce((s2, x) => s2 + BigInt(x.amountRaw!), 0n)).toBe(BigInt(r.plan.token.supplyRaw));
    expect(a.some((x) => ["UNASSIGNED", "CHARITY", "TAX_RESERVE", "PROTOCOL"].includes(x.role))).toBe(false);
    expect(r.plan.expectedState.allocations.map((x) => x.role)).toEqual(["CREATOR", "LIQUIDITY", "BURN"]);
  });
  it("the allocation blocker is gone, but the burn mechanism and liquidity venue still block minting", () => {
    const r = direct(base()); if (!r.ok) throw new Error("builds");
    const codes2 = r.plan.blockers.map((b) => b.code);
    expect(codes2).not.toContain("ALLOCATION_MODEL_UNDEFINED"); expect(codes2).toContain("SUPPLY_BURN_MECHANISM_UNDEFINED"); expect(codes2).toContain("LIQUIDITY_BUILD_NOT_IMPLEMENTED");
    expect(r.plan.status).toBe("BLOCKED");
    for (const id of ["mint-supply", "revoke-mint-authority"]) { const i = r.plan.instructions.find((x) => x.id === id)!; expect(i.status).toBe("BLOCKED"); expect(i.blockedBy).toEqual(expect.arrayContaining(["SUPPLY_BURN_MECHANISM_UNDEFINED", "LIQUIDITY_BUILD_NOT_IMPLEMENTED"])); }
    expect(r.plan.instructions.find((x) => x.id === "create-creator-token-account")!.status).toBe("PLANNED");
  });
  it("a launch whose creator and liquidity shares do not total 48% does not match the model and cannot be planned", () => {
    for (const over of [{ creatorAllocationPercent: "10" }, { creatorAllocationPercent: "0", liquidityConfiguration: { initialLiquidityUsdc: "1", supplyPercentage: "100", lockDays: 0 } }, { liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "41", lockDays: 30 } }]) {
      const r = direct(withCfg(over)); expect(r.ok, JSON.stringify(over)).toBe(false);
      if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(["ALLOCATION_MODEL_MISMATCH"]);
    }
  });
  it("precision is still exact for every share, including the burn", () => {
    const r = direct(withCfg({ totalSupply: "7", decimals: 0 })); expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("PRECISION_LOSS");
  });
  it("the decided model changes the plan hash against the pre-decision plan, and an undecided model falls back to the explicit UNASSIGNED remainder", () => {
    const a = direct(base()), b = buildDeploymentPlan({ ...base(), policy: PRE });
    if (!a.ok || !b.ok) throw new Error("builds");
    expect(a.plan.identity.planHash).not.toBe(b.plan.identity.planHash);
    expect(b.plan.supplyAllocations.find((x) => x.role === "UNASSIGNED")).toMatchObject({ status: "UNDEFINED" }); expect(b.plan.blockers.map((x) => x.code)).toContain("ALLOCATION_MODEL_UNDEFINED");
  });
});
