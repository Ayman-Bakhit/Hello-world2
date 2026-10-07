import { describe, expect, it } from "vitest";
import {
  BANNED_PHRASES, CANONICAL_FEE_SPLIT, DEMO_IDS, DEMO_WALLETS, LAUNCH_COPY, LAUNCH_STATUSES, LAUNCH_TRANSITIONS, Launch, LaunchConfigSchema, LaunchReadyRequest, MAX_U64,
  PublicLaunch, REACHABLE_LAUNCH_STATUSES, buildDemoLaunch, buildDemoPublicLaunch, canonicalLaunchConfig, isCanonicalFeeSplit, launchAllocations, launchFingerprint,
  nextLaunchStatus, revisionRowHash, sha256Hex, supplyFitsU64, toPublicLaunch, validateFeeSplit, type LaunchConfig,
} from "./index";

const base = {
  name: "Example", symbol: "EXMPL", description: "d", totalSupply: "1000000000", decimals: 6, network: "devnet", creatorAllocationPercent: "8", creatorWallet: DEMO_WALLETS[1]!.address,
  liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 30 }, feeSplit: { ...CANONICAL_FEE_SPLIT },
  charityConfiguration: { charityId: DEMO_IDS.charities.c1 }, taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: DEMO_WALLETS[1]!.address },
};
const parse = (over: Record<string, unknown> = {}): LaunchConfig => LaunchConfigSchema.parse({ ...base, ...over });
const ok = (over: Record<string, unknown>) => LaunchConfigSchema.safeParse({ ...base, ...over }).success;

describe("sha256", () => {
  it("matches the standard test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(sha256Hex("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
    expect(sha256Hex("héllo ✓")).toMatch(/^[0-9a-f]{64}$/); // multibyte
  });
});

describe("fee split: canonical 60/15/15/10, validated by the shared invariant", () => {
  it("is exactly 6000/1500/1500/1000 and sums to 10000 through the existing validator", () => {
    expect(CANONICAL_FEE_SPLIT).toEqual({ creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 });
    expect(validateFeeSplit(CANONICAL_FEE_SPLIT)).toEqual([]);
    expect(Object.isFrozen(CANONICAL_FEE_SPLIT)).toBe(true);
    expect(isCanonicalFeeSplit({ ...CANONICAL_FEE_SPLIT })).toBe(true);
  });
  it("rejects every other split, including ones that total 10000, and non-integers", () => {
    for (const s of [
      { creator: 5000, taxReserve: 2500, charity: 1500, protocol: 1000 }, { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 999 }, { creator: 6000.5, taxReserve: 1499.5, charity: 1500, protocol: 1000 },
      { creator: 10000, taxReserve: 0, charity: 0, protocol: 0 }, { creator: -1, taxReserve: 6001, charity: 3000, protocol: 1000 },
    ]) {
      expect(isCanonicalFeeSplit(s), JSON.stringify(s)).toBe(false);
      expect(ok({ feeSplit: s }), JSON.stringify(s)).toBe(false);
    }
  });
  it("the schema message is explicit", () => {
    const r = LaunchConfigSchema.safeParse({ ...base, feeSplit: { creator: 5000, taxReserve: 2500, charity: 1500, protocol: 1000 } });
    expect(JSON.stringify(r.error?.issues)).toMatch(/exactly creator 6000/);
  });
});

describe("lifecycle vocabulary and transitions", () => {
  it("DEPLOYING, LIVE and FAILED exist as words but are not reachable", () => {
    for (const s of ["DEPLOYING", "LIVE", "FAILED"]) {
      expect(LAUNCH_STATUSES).toContain(s);
      expect(REACHABLE_LAUNCH_STATUSES).not.toContain(s);
    }
    expect([...REACHABLE_LAUNCH_STATUSES]).toEqual(["DRAFT", "CONFIGURED", "REVIEW", "READY", "CANCELLED"]);
    for (const t of Object.values(LAUNCH_TRANSITIONS)) expect(REACHABLE_LAUNCH_STATUSES).toContain(t.to);
    for (const t of Object.values(LAUNCH_TRANSITIONS)) for (const f of t.from) expect(REACHABLE_LAUNCH_STATUSES).toContain(f);
  });
  it("the table is the only way forward, one step at a time", () => {
    expect(nextLaunchStatus("configure", "DRAFT")).toBe("CONFIGURED");
    expect(nextLaunchStatus("review", "CONFIGURED")).toBe("REVIEW");
    expect(nextLaunchStatus("ready", "REVIEW")).toBe("READY");
    expect(nextLaunchStatus("update", "READY")).toBe("DRAFT");
    expect(nextLaunchStatus("cancel", "REVIEW")).toBe("CANCELLED");
    for (const [a, from] of [["review", "DRAFT"], ["ready", "DRAFT"], ["ready", "CONFIGURED"], ["configure", "READY"], ["update", "CANCELLED"], ["cancel", "CANCELLED"], ["configure", "LIVE"], ["ready", "DEPLOYING"], ["review", "VERIFIED"]] as const) {
      expect(nextLaunchStatus(a, from), `${a} from ${from}`).toBeNull();
    }
  });
  it("READY means ready for a future flow, and says so", () => {
    expect(LAUNCH_COPY.readyTitle).toBe("READY FOR DEPLOYMENT");
    expect(LAUNCH_COPY.readyMeaning).toMatch(/future deployment flow/);
    expect(LAUNCH_COPY.readyMeaning).toMatch(/No on-chain transaction has been submitted/);
    expect(LAUNCH_COPY.deploymentDisabled).toBe("On-chain deployment is not enabled in this beta.");
  });
  it("the ready request needs a fingerprint and an explicit confirmation", () => {
    const fp = "a".repeat(64);
    expect(LaunchReadyRequest.safeParse({ fingerprint: fp, confirmed: true }).success).toBe(true);
    for (const bad of [{ fingerprint: fp }, { fingerprint: fp, confirmed: false }, { fingerprint: "zz", confirmed: true }, { fingerprint: fp, confirmed: true, status: "LIVE" }]) expect(LaunchReadyRequest.safeParse(bad).success).toBe(false);
  });
});

describe("token configuration validation", () => {
  it("accepts a normal configuration with safe defaults", () => {
    expect(parse()).toMatchObject({ network: "devnet", imageUri: null, website: null, mintAuthority: "disabled", freezeAuthority: "disabled", socials: { twitter: null, telegram: null, discord: null, github: null } });
  });
  it("name, symbol and description are plain text", () => {
    for (const name of ["", "x".repeat(33), "a\u0000b", "a\nb", "Evil‮Name", "<b>x</b>", "A  B", "A\tB", "x>"]) expect(ok({ name }), JSON.stringify(name)).toBe(false);
    for (const symbol of ["a", "ab", "A", "ABCDEFGHIJK", "AB CD", "AB-C", "ÀB"]) expect(ok({ symbol }), symbol).toBe(false);
    for (const description of ["x".repeat(281), "<script>", "a\u0007b", "a​b"]) expect(ok({ description }), JSON.stringify(description)).toBe(false);
    for (const name of ["Rock & Roll (v2) #1", "Ünïcode ✓", "A"]) expect(ok({ name }), name).toBe(true);
  });
  it("supply is an exact positive integer that fits a u64 once scaled by decimals", () => {
    expect(supplyFitsU64("18446744073709551615", 0)).toBe(true);
    expect(supplyFitsU64("18446744073709551616", 0)).toBe(false);
    expect(supplyFitsU64("18446744073", 9)).toBe(true);
    expect(supplyFitsU64("18446744074", 9)).toBe(false);
    expect(supplyFitsU64("0", 0)).toBe(false);
    expect(supplyFitsU64("1.5", 0)).toBe(false);
    expect(supplyFitsU64("1e9", 0)).toBe(false);
    expect(supplyFitsU64("1", 10)).toBe(false);
    expect(MAX_U64).toBe(2n ** 64n - 1n);
    expect(parse({ totalSupply: "18446744073709551615", decimals: 0 }).totalSupply).toBe("18446744073709551615");
    for (const [totalSupply, decimals] of [["18446744073709551616", 0], ["20000000000", 9], ["0", 6], ["1e9", 6], ["1.5", 6], ["-1", 6], ["01", 6]] as const) expect(ok({ totalSupply, decimals }), `${totalSupply}/${decimals}`).toBe(false);
  });
  it("decimals are an integer 0..9", () => {
    for (const decimals of [-1, 10, 1.5, "6", null, NaN, Infinity]) expect(ok({ decimals }), String(decimals)).toBe(false);
    for (const decimals of [0, 6, 9]) expect(ok({ decimals })).toBe(true);
  });
  it("URLs: only absolute http(s) (https for image and socials), no credentials, nothing dangerous", () => {
    for (const imageUri of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:image/png;base64,AAAA", "http://example.org/a.png", "ftp://example.org/a.png", "//example.org/a.png", "https://u:p@example.org/a.png", "https://example.org/a b", "ipfs://Qm1", "file:///etc/passwd", "https://" + "a".repeat(500)]) {
      expect(ok({ imageUri }), imageUri.slice(0, 40)).toBe(false);
    }
    for (const website of ["javascript:alert(1)", "vbscript:x", "file:///x", "data:text/html,x", "https://", "example.org"]) expect(ok({ website }), website).toBe(false);
    expect(ok({ website: "http://example.org" })).toBe(true);
    expect(ok({ website: "https://example.org/a?b=1" })).toBe(true);
    expect(ok({ imageUri: "https://example.org/logo.png" })).toBe(true);
    expect(ok({ socials: { twitter: "javascript:x", telegram: null, discord: null, github: null } })).toBe(false);
    expect(ok({ socials: { twitter: "http://example.org", telegram: null, discord: null, github: null } })).toBe(false);
    expect(ok({ socials: { twitter: null, telegram: null, discord: null, github: null, evil: "https://x.test" } })).toBe(false);
  });
  it("network is an explicit enum; unknown fields (status, mint, signature) are rejected", () => {
    expect(ok({ network: "mainnet-beta" })).toBe(true);
    for (const network of ["mainnet", "localnet", "devnet; x", "", 1]) expect(ok({ network }), String(network)).toBe(false);
    for (const extra of [{ status: "LIVE" }, { mintAddress: "x" }, { transactionSignature: "x" }, { fingerprint: "x" }, { deployed: true }]) expect(ok(extra), JSON.stringify(extra)).toBe(false);
  });
});

describe("configuration fingerprint", () => {
  it("is deterministic and a sha256 hex", () => {
    const a = launchFingerprint(parse());
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(launchFingerprint(parse())).toBe(a);
    expect(JSON.stringify(canonicalLaunchConfig(parse()))).toBe(JSON.stringify(canonicalLaunchConfig(parse())));
  });
  it("does not depend on spelling, key order or optional-field absence", () => {
    const a = launchFingerprint(parse());
    expect(launchFingerprint(parse({ creatorAllocationPercent: "8.00" }))).toBe(a);
    expect(launchFingerprint(parse({ imageUri: null, website: undefined }))).toBe(a);
    const reordered = LaunchConfigSchema.parse(Object.fromEntries(Object.entries({ ...base }).reverse()));
    expect(launchFingerprint(reordered)).toBe(a);
  });
  it("changes when ANY field of the configuration changes", () => {
    const a = launchFingerprint(parse());
    const patches: Array<Record<string, unknown>> = [
      { name: "Examplf" }, { symbol: "EXMPM" }, { description: "e" }, { totalSupply: "1000000001" }, { decimals: 7 }, { network: "mainnet-beta" }, { imageUri: "https://example.org/i.png" }, { website: "https://example.org" },
      { socials: { twitter: "https://example.org/t", telegram: null, discord: null, github: null } }, { socials: { twitter: null, telegram: null, discord: null, github: "https://example.org/g" } },
      { creatorAllocationPercent: "9" }, { creatorWallet: DEMO_WALLETS[0]!.address }, { mintAuthority: "creator" }, { freezeAuthority: "creator" }, { updateAuthority: "disabled" },
      { liquidityConfiguration: { initialLiquidityUsdc: "50001", supplyPercentage: "40", lockDays: 30 } }, { liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "41", lockDays: 30 } },
      { liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 31 } },
      { charityConfiguration: { charityId: DEMO_IDS.charities.c2 } }, { taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: DEMO_WALLETS[0]!.address } },
    ];
    const seen = new Set([a]);
    for (const p of patches) { const f = launchFingerprint(parse(p)); expect(seen.has(f), JSON.stringify(p)).toBe(false); seen.add(f); }
  });
  it("covers the fee split: any allocation change would change the fingerprint (even though the schema forbids it today)", () => {
    const c = parse();
    const a = launchFingerprint(c);
    for (const b of ["creator", "taxReserve", "charity", "protocol"] as const) {
      const tampered = { ...c, feeSplit: { ...c.feeSplit, [b]: c.feeSplit[b] + 1 } } as LaunchConfig;
      expect(launchFingerprint(tampered), b).not.toBe(a);
    }
  });
  it("contains no secret-like or time-like data", () => {
    const text = JSON.stringify(canonicalLaunchConfig(parse()));
    expect(text).not.toMatch(/createdAt|updatedAt|session|secret|bearer|authorization|rpc|password/i);
    expect(text).toContain("USER_PROVIDED");
    expect(text).toContain('"destination":"NOT_CONFIGURED"'); // no protocol address exists
  });
});

describe("allocations are configuration, not payments", () => {
  it("60/15/15/10 with explicit labels and separation notes", () => {
    const a = launchAllocations(CANONICAL_FEE_SPLIT);
    expect(a.map((x) => `${x.label} ${x.percent}`)).toEqual(["CREATOR 60%", "TAX RESERVE 15%", "CHARITY 15%", "PROTOCOL 10%"]);
    expect(a.find((x) => x.bucket === "taxReserve")!.note).toMatch(/not your personal Tax Reserve/);
    expect(a.find((x) => x.bucket === "charity")!.note).toMatch(/does not execute a donation/);
    expect(a.find((x) => x.bucket === "protocol")!.note).toMatch(/no protocol address is configured/);
    expect(a.find((x) => x.bucket === "creator")!.note).toMatch(/No payout/);
    expect(JSON.stringify(a).toLowerCase()).not.toMatch(/\b(earned|received|paid|reserved already|funded)\b/);
  });
});

describe("revision hash", () => {
  const i = { launchId: "l", seq: 2, action: "update" as const, statusAfter: "DRAFT", fingerprint: "f".repeat(64), createdBy: "u", reason: null, prevHash: "p", createdAt: "2026-01-01T00:00:00.000Z" };
  it("is deterministic and covers every field", () => {
    const h = revisionRowHash(i);
    expect(revisionRowHash({ ...i })).toBe(h);
    for (const k of Object.keys(i) as Array<keyof typeof i>) {
      const alt = { ...i, [k]: k === "seq" ? 3 : k === "reason" ? "x" : k === "action" ? "cancel" : `${String(i[k])}x` } as typeof i;
      expect(revisionRowHash(alt), k).not.toBe(h);
    }
  });
});

describe("public projection and demo data", () => {
  it("never carries a user, session, full wallet, reserve destination or review internals", () => {
    const p = PublicLaunch.parse(buildDemoPublicLaunch());
    const text = JSON.stringify(p);
    for (const s of [DEMO_WALLETS[1]!.address, "creatorWallet", "destinationAddress", "taxReserveConfiguration", "userId", "session", "reviewedAt", "errors"]) expect(text, s).not.toContain(s);
    expect(p.creator).toMatch(/…/);
  });
  it("the demo launch is labeled DEMO DATA, NOT DEPLOYED and NOT VERIFIED ON-CHAIN, with no mint or signature", () => {
    const l = Launch.parse(buildDemoLaunch());
    expect(l).toMatchObject({ dataSource: "demo", status: "READY", deployment: { status: "not_deployed", mintAddress: null, transactionSignature: null, contractAddress: null }, metadata: { source: "USER_PROVIDED", verifiedOnChain: false } });
    const p = buildDemoPublicLaunch();
    expect(p.labels).toEqual(expect.arrayContaining(["CONFIGURED", "NOT DEPLOYED", "NOT VERIFIED ON-CHAIN", "DEMO DATA"]));
    expect(p.charity).toMatchObject({ verificationState: "VERIFIED", verificationSource: "FIXTURE" });
    expect(toPublicLaunch(l, null).charity).toBeNull();
  });
  it("copy never uses banned phrases or claims immutability, deployment or verification", () => {
    const text = (Object.values(LAUNCH_COPY).join(" ") + JSON.stringify(buildDemoPublicLaunch())).toLowerCase();
    for (const p of BANNED_PHRASES) expect(text, p).not.toContain(p);
    expect(text).not.toMatch(/immutable|guaranteed|has been deployed|is live|verified token metadata/);
    expect(LAUNCH_COPY.feeSplitNote).toBe("60/15/15/10 is a validated launch configuration. It is not enforced on-chain.");
    expect(LAUNCH_COPY.fingerprintNote).toMatch(/not a blockchain proof/);
    expect(LAUNCH_COPY.metadataNote).toMatch(/not verified on-chain/);
  });
});
