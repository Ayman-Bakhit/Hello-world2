import { describe, expect, it } from "vitest";
import { LaunchConfigSchema } from "./api/schemas";
import { launchFingerprint } from "./launchModel";
import { DEPLOYMENT_POLICY, withDecisions, type DeploymentPolicy } from "./deploymentPolicy";
import {
  CHECK_IDS, ChainObservationSchema, LaunchProof, PROOF_COPY, PROOF_STATUS_LABEL, PROOF_STATUSES, REDACTED, buildLaunchProof, evaluateProof as evaluateProofRaw, expectedSupply,
  isBase58Address, isBase58Signature, observationRowHash, type ChainObservation, type CheckId,
} from "./proof";
import { FIXTURE_MINT, FIXTURE_SIGNATURE, FIXTURE_WALLETS, PROOF_SCENARIOS, buildProofFixture, fixtureLaunchConfig, matchingFixtureObservation, proofFixtureInputs } from "./demo/proofFixtures";

/** TEST-ONLY: a policy in which the tax reserve destination is decided and approved, so the machinery can be exercised. Production has it PENDING. */
const TAX_DECIDED: DeploymentPolicy = (() => { const p = withDecisions(DEPLOYMENT_POLICY, { TAX_RESERVE_FUNDING: { status: "DECIDED", value: { asset: "TEST_ONLY" }, missing: null, provenance: "ENGINEERING_DEFAULT" } }); return { ...p, decisions: p.decisions.map((d) => (d.id === "TAX_RESERVE_FUNDING" ? { ...d, approval: { status: "APPROVED" as const, approver: "TEST-ONLY", approvedAt: "2000-01-01", reference: "TEST-ONLY", approvedVersion: d.version } } : d)) }; })();
const evaluateProof = (i: Parameters<typeof evaluateProofRaw>[0]) => evaluateProofRaw({ policy: TAX_DECIDED, ...i });
const ev = (s: (typeof PROOF_SCENARIOS)[number]) => { const i = proofFixtureInputs(s); return evaluateProof({ ...i, historyIntact: true }); };
const state = (e: ReturnType<typeof ev>, id: CheckId) => e.checks.find((c) => c.id === id)!.state;
/** the same machinery fed by an RPC observation: only a pure unit test may do this; nothing persists it in demo/mock */
const rpc = (o: ChainObservation): ChainObservation => ({ ...o, source: "RPC" });
const real = (mut?: (o: ChainObservation) => ChainObservation, fp?: string | null) => {
  const i = proofFixtureInputs("FULL_MATCH");
  const o = rpc(matchingFixtureObservation(i.subject.config));
  return evaluateProof({ subject: i.subject, deployment: { ...i.deployment!, deployedFingerprint: fp === undefined ? i.subject.fingerprint : fp }, observation: mut ? mut(o) : o, historyIntact: true });
};

describe("proof status", () => {
  it("A: not deployed has no checks and is never verified", () => {
    const e = ev("NOT_DEPLOYED");
    expect(e.status).toBe("NOT_DEPLOYED"); expect(e.checks).toEqual([]); expect(e.verifiedOnChain).toBe(false); expect(e.verifiedTransparency).toBe(false);
  });
  it("a deployment record with no mint is still not deployed", () => {
    const i = proofFixtureInputs("FULL_MATCH");
    expect(evaluateProof({ ...i, deployment: { ...i.deployment!, mintAddress: null }, historyIntact: true }).status).toBe("NOT_DEPLOYED");
  });
  it("B: deployed but unobserved awaits observation, all comparisons UNKNOWN", () => {
    const e = ev("DEPLOYED_BUT_UNOBSERVED");
    expect(e.status).toBe("AWAITING_OBSERVATION"); expect(e.verifiedTransparency).toBe(false);
    for (const id of ["NETWORK_MATCH", "DECIMALS_MATCH", "SUPPLY_MATCH", "MINT_AUTHORITY_MATCH", "FEE_SPLIT_MATCH", "OBSERVATION_FROM_CHAIN"] as const) expect(state(e, id), id).toBe("UNKNOWN");
  });
  it("C: a fully matching FIXTURE is PARTIAL, never VERIFIED", () => {
    const e = ev("FULL_MATCH");
    expect(e.status).toBe("PARTIAL"); expect(e.evidenceClass).toBe("FIXTURE"); expect(e.verifiedOnChain).toBe(false); expect(e.verifiedTransparency).toBe(false);
    expect(state(e, "OBSERVATION_FROM_CHAIN")).toBe("UNAVAILABLE");
    expect(e.explanation).toMatch(/FIXTURE/); expect(e.explanation).toMatch(/not verification/);
    for (const id of ["NETWORK_MATCH", "DECIMALS_MATCH", "SUPPLY_MATCH", "MINT_AUTHORITY_MATCH", "FEE_SPLIT_MATCH", "CHARITY_MATCH", "TAX_RESERVE_DESTINATION_MATCH", "LIQUIDITY_CONFIGURATION_MATCH"] as const) expect(state(e, id), id).toBe("PASS");
  });
  it("D-G: mismatches FAIL and name the check", () => {
    const cases: Array<[(typeof PROOF_SCENARIOS)[number], CheckId]> = [["SUPPLY_MISMATCH", "SUPPLY_MATCH"], ["DECIMALS_MISMATCH", "DECIMALS_MATCH"], ["AUTHORITY_MISMATCH", "MINT_AUTHORITY_MATCH"], ["NETWORK_MISMATCH", "NETWORK_MATCH"]];
    for (const [s, id] of cases) {
      const e = ev(s);
      expect(e.status, s).toBe("FAILED"); expect(state(e, id), s).toBe("FAIL"); expect(e.mismatches.map((m) => m.checkId), s).toContain(id);
      const m = e.mismatches.find((x) => x.checkId === id)!; expect(m.configured).not.toBe(m.observed);
      expect(e.verifiedTransparency).toBe(false);
    }
  });
  it("H/I: partial and missing metadata stay PARTIAL with UNAVAILABLE checks", () => {
    const h = ev("PARTIAL_OBSERVATION"); expect(h.status).toBe("PARTIAL");
    expect(state(h, "LIQUIDITY_CONFIGURATION_MATCH")).toBe("UNAVAILABLE"); expect(state(h, "FEE_SPLIT_MATCH")).toBe("UNAVAILABLE"); expect(state(h, "SUPPLY_MATCH")).toBe("PASS");
    const m = ev("MISSING_METADATA"); expect(m.status).toBe("PARTIAL"); expect(state(m, "METADATA_MATCH")).toBe("UNAVAILABLE");
  });
  it("J: an observation that read nothing is UNAVAILABLE", () => {
    const e = ev("UNAVAILABLE_OBSERVATION");
    expect(e.status).toBe("UNAVAILABLE"); expect(e.mismatches).toEqual([]); expect(e.verifiedTransparency).toBe(false);
  });
  it("a broken observation history is UNAVAILABLE and discards the observation", () => {
    const i = proofFixtureInputs("FULL_MATCH");
    const e = evaluateProof({ ...i, historyIntact: false });
    expect(e.status).toBe("UNAVAILABLE"); expect(e.checks).toEqual([]);
    const p = buildLaunchProof({ ...i, observationCount: 1, historyIntact: false, audience: "owner" });
    expect(p.observed).toBeNull(); expect(p.verifiedTransparency).toBe(false);
  });
  it("labels exist for every status", () => { for (const s of PROOF_STATUSES) expect(PROOF_STATUS_LABEL[s]).toBeTruthy(); expect(PROOF_STATUS_LABEL.VERIFIED).toBe("VERIFIED TRANSPARENCY"); });
});

describe("verification rule (the ONE authoritative derivation)", () => {
  it("RPC observation that matches everything is VERIFIED, verifiedOnChain derived from it", () => {
    const e = real();
    expect(e.status).toBe("VERIFIED"); expect(e.verifiedOnChain).toBe(true); expect(e.verifiedTransparency).toBe(true);
    expect(e.checks.filter((c) => c.required).every((c) => c.state === "PASS")).toBe(true);
    expect(e.checks.find((c) => c.id === "METADATA_CONTENT_NOT_FETCHED")!.state).toBe("NOT_APPLICABLE");
  });
  it("the same observation as FIXTURE is not verified (source is the only difference)", () => {
    const i = proofFixtureInputs("FULL_MATCH");
    const e = evaluateProof({ ...i, observation: { ...i.observation!, source: "FIXTURE" }, historyIntact: true });
    expect(e.verifiedTransparency).toBe(false); expect(e.status).not.toBe("VERIFIED");
  });
  it("every required check is necessary: knocking out any one prevents VERIFIED", () => {
    const knock: Array<[string, (o: ChainObservation) => ChainObservation, string | null | undefined]> = [
      ["network", (o) => ({ ...o, network: { status: "UNAVAILABLE", reason: "x" } }), undefined],
      ["mint", (o) => ({ ...o, mintAddress: { status: "UNAVAILABLE", reason: "x" } }), undefined],
      ["decimals", (o) => ({ ...o, decimals: { status: "UNAVAILABLE", reason: "x" } }), undefined],
      ["supply", (o) => ({ ...o, supplyRaw: { status: "UNAVAILABLE", reason: "x" } }), undefined],
      ["mintAuth", (o) => ({ ...o, mintAuthority: { status: "UNAVAILABLE", reason: "x" } }), undefined],
      ["freezeAuth", (o) => ({ ...o, freezeAuthority: { status: "UNAVAILABLE", reason: "x" } }), undefined],
      ["metadata", (o) => ({ ...o, metadata: { status: "UNAVAILABLE", reason: "x" } }), undefined],
      ["liquidity", (o) => ({ ...o, liquidity: { status: "UNAVAILABLE", reason: "x" } }), undefined],
      ["feeRouting", (o) => ({ ...o, feeRouting: { status: "UNAVAILABLE", reason: "x" } }), undefined],
      ["fingerprint unknown", (o) => o, null],
    ];
    for (const [name, mut, fp] of knock) { const e = real(mut, fp); expect(e.verifiedTransparency, name).toBe(false); expect(e.status, name).not.toBe("VERIFIED"); }
  });
  it("a missing deployment signature prevents VERIFIED", () => {
    const i = proofFixtureInputs("FULL_MATCH");
    const e = evaluateProof({ subject: i.subject, deployment: { ...i.deployment!, deploymentSignature: null }, observation: rpc(i.observation!), historyIntact: true });
    expect(e.status).not.toBe("VERIFIED"); expect(state(e, "DEPLOYMENT_SIGNATURE_PRESENT")).toBe("UNKNOWN");
  });
  it("UNKNOWN and UNAVAILABLE are never treated as PASS", () => {
    const e = real((o) => ({ ...o, liquidity: { status: "UNAVAILABLE", reason: "x" } }));
    expect(e.status).toBe("PARTIAL"); expect(e.summary.pass).toBeLessThan(e.summary.required);
  });
  it("a value equal to itself is not a PASS: the deployment fingerprint check needs a recorded deployed fingerprint", () => {
    const e = real(undefined, null);
    expect(state(e, "CONFIGURATION_FINGERPRINT_MATCH")).toBe("UNKNOWN");
  });
  it("summary counts add up", () => {
    for (const s of PROOF_SCENARIOS) { const e = ev(s); const t = e.summary; expect(t.pass + t.fail + t.unknown + t.unavailable + t.notApplicable, s).toBe(e.checks.length); }
  });
});

describe("fingerprint semantics", () => {
  it("changing the configuration after deployment fails the fingerprint check", () => {
    const i = proofFixtureInputs("FULL_MATCH");
    const changed = LaunchConfigSchema.parse({ ...i.subject.config, name: "Renamed" });
    const e = evaluateProof({ subject: { ...i.subject, config: changed, fingerprint: launchFingerprint(changed) }, deployment: i.deployment, observation: rpc(i.observation!), historyIntact: true });
    expect(state(e, "CONFIGURATION_FINGERPRINT_MATCH")).toBe("FAIL"); expect(e.status).toBe("FAILED");
  });
  it("changed supply / authorities / charity wallet / reserve destination change the comparison", () => {
    const i = proofFixtureInputs("FULL_MATCH");
    const obs = rpc(i.observation!);
    const withConfig = (patch: object) => { const c = LaunchConfigSchema.parse({ ...i.subject.config, ...patch }); return evaluateProof({ subject: { ...i.subject, config: c, fingerprint: launchFingerprint(c) }, deployment: { ...i.deployment!, deployedFingerprint: launchFingerprint(c) }, observation: obs, historyIntact: true }); };
    expect(state(withConfig({ totalSupply: "2000000000" }), "SUPPLY_MATCH")).toBe("FAIL");
    expect(state(withConfig({ decimals: 9 }), "DECIMALS_MATCH")).toBe("FAIL");
    expect(state(withConfig({ mintAuthority: "creator" }), "MINT_AUTHORITY_MATCH")).toBe("FAIL");
    expect(state(withConfig({ freezeAuthority: "creator" }), "FREEZE_AUTHORITY_MATCH")).toBe("FAIL");
    expect(state(withConfig({ taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: FIXTURE_WALLETS.other } }), "TAX_RESERVE_DESTINATION_MATCH")).toBe("FAIL");
    expect(state(withConfig({ creatorWallet: FIXTURE_WALLETS.other }), "CREATOR_ALLOCATION_MATCH")).toBe("FAIL");
    expect(state(withConfig({ network: "mainnet-beta" }), "NETWORK_MATCH")).toBe("FAIL");
    expect(state(withConfig({ liquidityConfiguration: { ...i.subject.config.liquidityConfiguration, lockDays: 31 } }), "LIQUIDITY_CONFIGURATION_MATCH")).toBe("FAIL");
  });
  it("a different charity wallet in the registry fails CHARITY_MATCH; no registry wallet makes it UNKNOWN, never PASS", () => {
    const i = proofFixtureInputs("FULL_MATCH"); const obs = rpc(i.observation!);
    const a = evaluateProof({ subject: { ...i.subject, charity: { ...i.subject.charity!, walletAddress: FIXTURE_WALLETS.other } }, deployment: i.deployment, observation: obs, historyIntact: true });
    expect(state(a, "CHARITY_MATCH")).toBe("FAIL");
    const b = evaluateProof({ subject: { ...i.subject, charity: { ...i.subject.charity!, walletAddress: null } }, deployment: i.deployment, observation: obs, historyIntact: true });
    expect(state(b, "CHARITY_MATCH")).toBe("UNKNOWN"); expect(b.status).not.toBe("VERIFIED");
    const c = evaluateProof({ subject: { ...i.subject, charity: null }, deployment: i.deployment, observation: obs, historyIntact: true });
    expect(state(c, "CHARITY_MATCH")).toBe("UNKNOWN"); expect(c.status).not.toBe("VERIFIED");
  });
  it("fee split mismatch in the observed routing fails", () => {
    const e = real((o) => ({ ...o, feeRouting: o.feeRouting.status === "OBSERVED" ? { status: "OBSERVED", value: { ...o.feeRouting.value, charityBps: 1400, protocolBps: 1100 } } : o.feeRouting }));
    expect(state(e, "FEE_SPLIT_MATCH")).toBe("FAIL"); expect(state(e, "PROTOCOL_ALLOCATION_MATCH")).toBe("FAIL"); expect(e.status).toBe("FAILED");
  });
  it("supply comparison is exact for u64 values above 2^53", () => {
    const c = LaunchConfigSchema.parse({ ...fixtureLaunchConfig(), totalSupply: "18446744073", decimals: 9 });
    const raw = expectedSupply(c).mintedRaw; expect(raw).toBe("8854437155040000000");
    const i = proofFixtureInputs("FULL_MATCH"); const fp = launchFingerprint(c);
    const base = { subject: { ...i.subject, config: c, fingerprint: fp }, deployment: { ...i.deployment!, deployedFingerprint: fp }, historyIntact: true };
    const good = evaluateProof({ ...base, observation: { ...rpc(i.observation!), decimals: { status: "OBSERVED", value: 9 }, supplyRaw: { status: "OBSERVED", value: raw } } });
    expect(state(good, "SUPPLY_MATCH")).toBe("PASS");
    const off = evaluateProof({ ...base, observation: { ...rpc(i.observation!), decimals: { status: "OBSERVED", value: 9 }, supplyRaw: { status: "OBSERVED", value: (BigInt(raw) + 1n).toString() } } });
    expect(state(off, "SUPPLY_MATCH")).toBe("FAIL");
  });
  it("the proof expects the MINTED supply (48%): a chain showing the full intended supply FAILS, so 52% is never treated as minted-and-burned", () => {
    const i = proofFixtureInputs("FULL_MATCH"); const e = expectedSupply(i.subject.config);
    expect(BigInt(e.mintedRaw) * 100n).toBe(BigInt(e.intendedRaw) * 48n); expect(BigInt(e.mintedRaw) + BigInt(e.unissuedRaw)).toBe(BigInt(e.intendedRaw));
    const full = evaluateProof({ ...i, observation: { ...rpc(i.observation!), supplyRaw: { status: "OBSERVED", value: e.intendedRaw } }, historyIntact: true });
    expect(state(full, "SUPPLY_MATCH")).toBe("FAIL");
    const minted = evaluateProof({ ...i, observation: { ...rpc(i.observation!), supplyRaw: { status: "OBSERVED", value: e.mintedRaw } }, historyIntact: true });
    expect(state(minted, "SUPPLY_MATCH")).toBe("PASS");
    const p = buildProofFixture("FULL_MATCH", "owner");
    expect(p.configured).toMatchObject({ intendedSupplyRaw: e.intendedRaw, expectedMintedSupplyRaw: e.mintedRaw, unissuedSupplyRaw: e.unissuedRaw });
  });
});

describe("observation schema and hashing", () => {
  it("accepts a valid observation and rejects malformed ones", () => {
    const o = matchingFixtureObservation(fixtureLaunchConfig());
    expect(ChainObservationSchema.safeParse(o).success).toBe(true);
    expect(ChainObservationSchema.safeParse({ ...o, extra: 1 }).success).toBe(false);
    expect(ChainObservationSchema.safeParse({ ...o, supplyRaw: { status: "OBSERVED", value: "18446744073709551616" } }).success).toBe(false);
    expect(ChainObservationSchema.safeParse({ ...o, supplyRaw: { status: "OBSERVED", value: "1.5" } }).success).toBe(false);
    expect(ChainObservationSchema.safeParse({ ...o, mintAddress: { status: "OBSERVED", value: "not base58 !!" } }).success).toBe(false);
    expect(ChainObservationSchema.safeParse({ ...o, source: "CLIENT" }).success).toBe(false);
    expect(ChainObservationSchema.safeParse({ ...o, network: { status: "OBSERVED", value: "testnet" } }).success).toBe(false);
  });
  it("base58 helpers", () => {
    expect(isBase58Address(FIXTURE_MINT)).toBe(true); expect(isBase58Signature(FIXTURE_SIGNATURE)).toBe(true);
    expect(isBase58Address("DEMO3fB8cJ5yR1uH6dV2KEq47M")).toBe(false); expect(isBase58Address(1)).toBe(false);
  });
  it("row hash is deterministic and changes with any field", () => {
    const o = matchingFixtureObservation(fixtureLaunchConfig());
    const base = { proofId: "p", seq: 1, source: "FIXTURE" as const, observedAt: o.observedAt, observation: o, prevHash: null };
    const h = observationRowHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/); expect(observationRowHash(base)).toBe(h);
    expect(observationRowHash({ ...base, seq: 2 })).not.toBe(h);
    expect(observationRowHash({ ...base, prevHash: "a".repeat(64) })).not.toBe(h);
    expect(observationRowHash({ ...base, observation: { ...o, decimals: { status: "OBSERVED", value: 9 } } })).not.toBe(h);
  });
});

describe("response building", () => {
  it("every scenario parses against the response schema for both audiences", () => {
    for (const s of PROOF_SCENARIOS) for (const a of ["owner", "public"] as const) expect(LaunchProof.safeParse(buildProofFixture(s, a)).success, `${s}/${a}`).toBe(true);
  });
  it("never fabricates an explorer URL, and all check ids are covered when deployed", () => {
    const p = buildProofFixture("FULL_MATCH", "owner");
    expect(p.identity.explorerUrl).toBeNull();
    expect(p.checks.map((c) => c.id).sort()).toEqual([...CHECK_IDS].sort());
    expect(JSON.stringify(p)).not.toMatch(/explorer\.solana|solscan|https?:\/\/[^"]*(tx|address)\//i);
  });
  it("not deployed: no mint, signature or observed timestamp is invented", () => {
    const p = buildProofFixture("NOT_DEPLOYED", "owner");
    expect(p.identity.mintAddress).toBeNull(); expect(p.identity.deploymentSignature).toBeNull(); expect(p.identity.observedAt).toBeNull(); expect(p.observed).toBeNull();
    expect(p.identity.mintProvenance).toBe("UNAVAILABLE"); expect(p.statusLabel).toBe("NOT DEPLOYED");
  });
  it("public form hides the reserve destination and abbreviates the creator; owner form shows them", () => {
    const pub = JSON.stringify(buildProofFixture("FULL_MATCH", "public", TAX_DECIDED)); const own = JSON.stringify(buildProofFixture("FULL_MATCH", "owner", TAX_DECIDED));
    expect(pub).not.toContain(FIXTURE_WALLETS.reserve); expect(pub).not.toContain(FIXTURE_WALLETS.creator);
    expect(own).toContain(FIXTURE_WALLETS.reserve); expect(own).toContain(FIXTURE_WALLETS.creator);
    expect(pub).toContain(REDACTED);
    const p = buildProofFixture("FULL_MATCH", "public", TAX_DECIDED); expect(p.configured.taxReserve.destination).toBeNull();
  });
  it("while the tax reserve destination is PENDING (production) it is not shown as a destination even to the owner, and it is not compared", () => {
    const o = buildProofFixture("FULL_MATCH", "owner");
    expect(o.configured.taxReserve.destination).toBeNull();
    const chk = o.checks.find((x) => x.id === "TAX_RESERVE_DESTINATION_MATCH")!;
    expect(chk).toMatchObject({ state: "UNKNOWN", required: true, configured: null }); expect(chk.explanation).toMatch(/undecided/);
    expect(JSON.stringify(o.configured)).not.toContain(FIXTURE_WALLETS.reserve);
    expect(o.status).not.toBe("VERIFIED");
  });
  it("public form of a mismatch still hides private addresses inside mismatches", () => {
    const p = JSON.stringify(buildProofFixture("AUTHORITY_MISMATCH", "public"));
    expect(p).not.toContain(FIXTURE_WALLETS.creator);
  });
  it("labels metadata USER_PROVIDED and carries the required disclosures", () => {
    const p = buildProofFixture("FULL_MATCH", "public");
    expect(p.configured.metadata.provenance).toBe("USER_PROVIDED");
    expect(p.disclosures).toContain(PROOF_COPY.configuredNotProof); expect(p.disclosures).toContain(PROOF_COPY.metadataNote); expect(p.disclosures).toContain(PROOF_COPY.fixtureNote);
    expect(PROOF_COPY.configuredNotProof).toBe("Configured values describe the intended launch configuration. They are not blockchain proof.");
    expect(p.checks.find((c) => c.id === "METADATA_CONTENT_NOT_FETCHED")!.provenance).toBe("USER_PROVIDED");
    expect(p.evidence.class).toBe("FIXTURE"); expect(p.dataSource).toBe("demo");
  });
  it("unavailable values are null, never zero or false placeholders", () => {
    const p = buildProofFixture("PARTIAL_OBSERVATION", "owner");
    expect(p.observed!.liquidity.status).toBe("UNAVAILABLE"); expect(JSON.stringify(p.observed!.liquidity)).not.toMatch(/"0"|false/);
  });
  it("no fixture scenario is verified or says safe/guaranteed/trustless", () => {
    for (const s of PROOF_SCENARIOS) {
      const p = buildProofFixture(s, "public");
      expect(p.verifiedTransparency, s).toBe(false); expect(p.verifiedOnChain, s).toBe(false);
      const text = JSON.stringify([p.statusLabel, p.explanation, p.checks.map((c) => c.explanation), p.disclosures]);
      expect(text, s).not.toMatch(/\b(safe|guaranteed|trustless|audited|immutable|rug)\b/i);
    }
  });
  it("hostile text stays plain data (escaping is the renderer's job; it is carried verbatim, never interpreted)", () => {
    const i = proofFixtureInputs("FULL_MATCH");
    const o = { ...i.observation!, metadata: { status: "OBSERVED" as const, value: { address: null, name: "<img src=x onerror=alert(1)>", symbol: "<b>", uri: "javascript:alert(1)" } } };
    const p = buildLaunchProof({ ...i, observation: o, observationCount: 1, historyIntact: true, audience: "public" });
    expect(p.checks.find((c) => c.id === "METADATA_MATCH")!.state).toBe("FAIL");
    expect(p.verifiedTransparency).toBe(false);
  });
});
