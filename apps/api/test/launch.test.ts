import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApiErrorBody, BANNED_PHRASES, DEMO_IDS, DEMO_WALLETS, LAUNCH_COPY, Launch, LaunchHistory, LaunchList, PublicLaunch, PublicLaunchList, launchFingerprint, type LaunchConfig,
} from "@project-name/shared";
import { applyLaunchAction } from "../src/db/launchRepos";
import { makeCtx, makeOtherUser, bearer, type Ctx } from "./helpers";

let ctx: Ctx;
let other: Awaited<ReturnType<typeof makeOtherUser>>;
beforeAll(async () => { ctx = await makeCtx({ MAX_LAUNCHES_PER_USER: "5000" }); other = await makeOtherUser(ctx.pool); });
afterAll(async () => { await ctx.close(); });

const creator = DEMO_WALLETS[1]!.address;
const valid = (addr = creator): Record<string, unknown> => ({
  name: "Example Token", symbol: "EXMPL", description: "A test configuration", totalSupply: "1000000000", decimals: 6,
  creatorAllocationPercent: "8", creatorWallet: addr, network: "devnet",
  imageUri: "https://example.org/logo.png", website: "https://example.org", socials: { twitter: "https://example.org/x", telegram: null, discord: null, github: null },
  liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 30 },
  feeSplit: { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 },
  charityConfiguration: { charityId: DEMO_IDS.charities.c1 },
  taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: addr },
});
const send = (method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", url: string, payload?: unknown, token: string | null = ctx.demoToken) =>
  ctx.app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }), headers: token ? bearer(token) : {} });
const post = (url: string, payload?: unknown, token: string | null = ctx.demoToken) => send("POST", url, payload, token);
const get = (url: string, token: string | null = ctx.demoToken) => send("GET", url, undefined, token);
const put = (url: string, payload: unknown, token: string | null = ctx.demoToken) => send("PUT", url, payload, token);
const mk = async (over: Record<string, unknown> = {}, token = ctx.demoToken, addr = creator) => {
  const r = await post("/api/launches", { ...valid(addr), ...over }, token);
  expect(r.statusCode, r.body).toBe(201);
  return Launch.parse(r.json());
};
const act = async (id: string, action: string, payload?: unknown, token = ctx.demoToken) => post(`/api/launches/${id}/${action}`, payload, token);
/** DRAFT -> CONFIGURED -> REVIEW -> READY (optionally published) */
const toReady = async (l: Launch, publish = false, token = ctx.demoToken) => {
  expect((await act(l.id, "configure", undefined, token)).statusCode).toBe(200);
  expect((await act(l.id, "review", undefined, token)).statusCode).toBe(200);
  const cur = Launch.parse((await get(`/api/launches/${l.id}`, token)).json());
  const r = await act(l.id, "ready", { fingerprint: cur.fingerprint, confirmed: true, publish }, token);
  expect(r.statusCode, r.body).toBe(200);
  return Launch.parse(r.json());
};

describe("create: a DRAFT configuration, nothing deployed", () => {
  it("is a DRAFT with a fingerprint, revision 1, user-provided metadata and no on-chain fields", async () => {
    const r = await post("/api/launches", valid());
    expect(r.statusCode).toBe(201);
    const l = Launch.parse(r.json());
    expect(l).toMatchObject({
      status: "DRAFT", review: null, dataSource: "database", revision: 1, publicVisible: false, readyAt: null,
      deployment: { status: "not_deployed", mintAddress: null, transactionSignature: null, contractAddress: null },
      metadata: { source: "USER_PROVIDED", verifiedOnChain: false },
    });
    expect(l.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(l.config).toMatchObject({ network: "devnet", mintAuthority: "disabled", freezeAuthority: "disabled", imageUri: "https://example.org/logo.png", feeSplit: valid().feeSplit });
    expect(r.headers["cache-control"]).toBe("no-store");
  });
  it("defaults optional metadata to null and network to devnet", async () => {
    const { imageUri: _i, website: _w, socials: _s, network: _n, ...rest } = valid() as Record<string, unknown>;
    void _i; void _w; void _s; void _n;
    const r = await post("/api/launches", rest);
    expect(r.statusCode, r.body).toBe(201);
    expect(Launch.parse(r.json()).config).toMatchObject({ network: "devnet", imageUri: null, website: null, socials: { twitter: null, telegram: null, discord: null, github: null } });
  });
  it("a client cannot supply a status, ownership, deployment, mint, signature or fingerprint", async () => {
    for (const extra of [
      { status: "LIVE" }, { status: "READY" }, { status: "DEPLOYING" }, { status: "VERIFIED" }, { status: "ON_CHAIN" }, { creatorUserId: DEMO_IDS.admin }, { userId: other.userId },
      { deployment: { status: "deployed" } }, { mintAddress: "So11111111111111111111111111111111111111112" }, { transactionSignature: "x".repeat(88) }, { fingerprint: "a".repeat(64) },
      { revision: 9 }, { publicVisible: true }, { dataSource: "chain" }, { verifiedOnChain: true },
    ]) {
      const r = await post("/api/launches", { ...valid(), ...extra });
      expect(r.statusCode, JSON.stringify(extra)).toBe(400);
    }
  });
  it("the fee split must be exactly 60/15/15/10: other splits (even totaling 10000) and bad totals are rejected server-side", async () => {
    const before = Number((await ctx.pool.query("SELECT count(*) FROM launch_configurations")).rows[0].count);
    for (const feeSplit of [
      { creator: 5000, taxReserve: 2500, charity: 1500, protocol: 1000 }, { creator: 6000, taxReserve: 1000, charity: 2000, protocol: 1000 }, { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1001 },
      { creator: 6001, taxReserve: 1500, charity: 1500, protocol: 1000 }, { creator: 0, taxReserve: 0, charity: 0, protocol: 10000 }, { creator: 10000, taxReserve: 0, charity: 0, protocol: 0 },
      { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 999 },
    ]) {
      const r = await post("/api/launches", { ...valid(), feeSplit });
      expect(r.statusCode, JSON.stringify(feeSplit)).toBe(400);
      const e = ApiErrorBody.parse(r.json()).error;
      expect(e.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(e.fields)).toMatch(/exactly/);
    }
    expect(Number((await ctx.pool.query("SELECT count(*) FROM launch_configurations")).rows[0].count)).toBe(before);
  });
  it("rejects floats, negatives, strings, missing and extra fee fields", async () => {
    for (const feeSplit of [
      { creator: 6000.5, taxReserve: 1499.5, charity: 1500, protocol: 1000 }, { creator: -1, taxReserve: 6001, charity: 3000, protocol: 1000 },
      { creator: "6000", taxReserve: 1500, charity: 1500, protocol: 1000 }, { creator: 6000, taxReserve: 1500, charity: 1500 },
      { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000, extra: 0 }, { creator: 60, taxReserve: 15, charity: 15, protocol: 10 },
      { creator: null, taxReserve: 1500, charity: 1500, protocol: 1000 }, { creator: 6000, taxReserve: 1500, charity: 1500, protocol: Infinity },
    ]) expect((await post("/api/launches", { ...valid(), feeSplit })).statusCode, JSON.stringify(feeSplit)).toBe(400);
  });
  it("the database independently refuses a non-canonical split and a bad sum", async () => {
    const ins = (cfg: unknown) => ctx.pool.query("INSERT INTO launch_configurations (creator_user_id, creator_wallet_id, name, symbol, config) VALUES ($1,$2,'x','XX',$3)", [DEMO_IDS.user, DEMO_IDS.wallets.creator, JSON.stringify(cfg)]);
    await expect(ins({ ...valid(), feeSplit: { creator: 6001, taxReserve: 1500, charity: 1500, protocol: 1000 } })).rejects.toThrow(/launch_fee_split/);
    await expect(ins({ ...valid(), feeSplit: { creator: 5000, taxReserve: 2500, charity: 1500, protocol: 1000 } })).rejects.toThrow(/launch_fee_split_canonical/);
    await expect(ins({ ...valid(), network: "mainnet" })).rejects.toThrow(/launch_network_supported/);
  });
});

describe("token configuration validation (untrusted input)", () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ["empty name", { name: "" }], ["33-char name", { name: "x".repeat(33) }], ["control char in name", { name: "Bad\u0000Name" }], ["newline in name", { name: "Bad\nName" }],
    ["bidi override in name", { name: "Evil‮Name" }], ["angle brackets in name", { name: "<img src=x onerror=alert(1)>" }], ["double spaces", { name: "A  B" }], ["tab", { name: "A\tB" }],
    ["lowercase symbol", { symbol: "ab" }], ["symbol with space", { symbol: "AB C" }], ["1-char symbol", { symbol: "A" }], ["11-char symbol", { symbol: "ABCDEFGHIJK" }], ["symbol with punctuation", { symbol: "AB-C" }],
    ["description 281", { description: "x".repeat(281) }], ["script in description", { description: "<script>alert(1)</script>" }], ["control char in description", { description: "a\u0007b" }],
    ["supply 0", { totalSupply: "0" }], ["supply exponent", { totalSupply: "1e9" }], ["supply decimal", { totalSupply: "1.5" }], ["supply leading zero", { totalSupply: "01" }], ["supply negative", { totalSupply: "-5" }],
    ["supply 31 digits", { totalSupply: "1" + "0".repeat(30) }], ["supply number type", { totalSupply: 1000 }], ["supply above u64", { totalSupply: "18446744073709551616", decimals: 0 }],
    ["supply scaled above u64", { totalSupply: "20000000000", decimals: 9 }],
    ["decimals 10", { decimals: 10 }], ["decimals -1", { decimals: -1 }], ["decimals 1.5", { decimals: 1.5 }], ["decimals string", { decimals: "6" }], ["decimals NaN", { decimals: null }],
    ["unknown network", { network: "mainnet" }], ["network injection", { network: "devnet; DROP TABLE" }],
    ["image javascript:", { imageUri: "javascript:alert(1)" }], ["image data:", { imageUri: "data:image/png;base64,AAAA" }], ["image http (https only)", { imageUri: "http://example.org/a.png" }],
    ["image ftp", { imageUri: "ftp://example.org/a.png" }], ["image credentials", { imageUri: "https://user:pw@example.org/a.png" }], ["image whitespace", { imageUri: "https://example.org/a b.png" }],
    ["image 501 chars", { imageUri: "https://example.org/" + "a".repeat(490) }], ["image protocol-relative", { imageUri: "//example.org/a.png" }], ["image ipfs", { imageUri: "ipfs://Qm123" }],
    ["website javascript:", { website: "javascript:alert(1)" }], ["website vbscript", { website: "vbscript:x" }], ["website file", { website: "file:///etc/passwd" }], ["website malformed", { website: "https://" }],
    ["social javascript", { socials: { twitter: "javascript:alert(1)", telegram: null, discord: null, github: null } }], ["social http", { socials: { twitter: "http://example.org", telegram: null, discord: null, github: null } }],
    ["unknown social", { socials: { twitter: null, telegram: null, discord: null, github: null, evil: "https://x.test" } }],
    ["unknown field", { rogue: true }], ["allocation 101", { creatorAllocationPercent: "101" }], ["allocation 3 decimals", { creatorAllocationPercent: "8.123" }],
    ["liquidity 0", { liquidityConfiguration: { initialLiquidityUsdc: "0", supplyPercentage: "40", lockDays: 30 } }], ["lock negative", { liquidityConfiguration: { initialLiquidityUsdc: "5", supplyPercentage: "40", lockDays: -1 } }],
    ["mint authority junk", { mintAuthority: "everyone" }], ["charity name instead of id", { charityConfiguration: { charityId: "Open Water Initiative (demo)" } }],
    ["charity id junk", { charityConfiguration: { charityId: "nope" } }], ["charity extra field", { charityConfiguration: { charityId: DEMO_IDS.charities.c1, name: "Fake Charity" } }],
    ["reserve destination type", { taxReserveConfiguration: { destinationType: "platform", destinationAddress: creator } }],
  ];
  it.each(bad)("rejects: %s", async (_n, patch) => {
    const r = await post("/api/launches", { ...valid(), ...patch });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("VALIDATION_ERROR");
    expect(r.body).not.toMatch(/stack|node_modules|at \w+ \(/);
  });
  it("supply keeps exact precision up to the largest u64 and returns it unchanged", async () => {
    const l = await mk({ totalSupply: "18446744073709551615", decimals: 0 });
    expect(l.config.totalSupply).toBe("18446744073709551615");
    const l2 = await mk({ totalSupply: "18446744073", decimals: 9 });
    expect(l2.config.totalSupply).toBe("18446744073");
  });
  it("accepts ordinary punctuation as text and returns it as inert JSON", async () => {
    const l = await mk({ name: "Rock & Roll (v2) #1", description: "Uses \"quotes\" and 'apostrophes' & ampersands." });
    expect(l.config.name).toBe("Rock & Roll (v2) #1");
    const r = await get(`/api/launches/${l.id}`);
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
  it("references: creator and reserve wallets must be the actor's, the charity must exist in the registry", async () => {
    const a = await post("/api/launches", { ...valid(), creatorWallet: other.address });
    expect([a.statusCode, a.json().error.code]).toEqual([422, "WALLET_NOT_OWNED"]);
    const b = await post("/api/launches", { ...valid(), taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: other.address } });
    expect([b.statusCode, b.json().error.code]).toEqual([422, "WALLET_NOT_OWNED"]);
    const c = await post("/api/launches", { ...valid(), charityConfiguration: { charityId: "00000000-0000-4000-8000-0000000fffff" } });
    expect([c.statusCode, c.json().error.code]).toEqual([422, "CHARITY_NOT_FOUND"]);
  });
});

describe("lifecycle: server-controlled, ends at READY", () => {
  it("DRAFT -> CONFIGURED -> REVIEW -> READY; READY means ready for a future flow, never deployed", async () => {
    const l = await mk();
    const c = Launch.parse((await act(l.id, "configure")).json());
    expect(c.status).toBe("CONFIGURED");
    expect(c.review).toMatchObject({ passed: true, errors: [], deployable: false, feeSplitLabel: "Configured fee split", feeSplitEnforcement: "not_enforced", fingerprint: l.fingerprint });
    const rv = Launch.parse((await act(l.id, "review")).json());
    expect(rv.status).toBe("REVIEW");
    const ready = Launch.parse((await act(l.id, "ready", { fingerprint: rv.fingerprint, confirmed: true })).json());
    expect(ready).toMatchObject({ status: "READY", publicVisible: false, deployment: { status: "not_deployed", mintAddress: null, transactionSignature: null, contractAddress: null } });
    expect(ready.readyAt).not.toBeNull();
    expect(ready.statusMeaning).toBe(LAUNCH_COPY.readyMeaning);
    expect(ready.statusMeaning).toMatch(/No on-chain transaction has been submitted/);
    const text = JSON.stringify(ready).toLowerCase();
    expect(text).not.toMatch(/"status":"(live|deploying|failed)"|immutable|"deployed"|verified on-chain":true|"verifiedonchain":true/);
  });
  it("the review records the charity's registry state, the allocations as configuration, and the fixture warning", async () => {
    const l = await mk();
    const c = Launch.parse((await act(l.id, "configure")).json());
    expect(c.review!.charity).toMatchObject({ id: DEMO_IDS.charities.c1, verificationState: "VERIFIED", verificationSource: "FIXTURE", dataSource: "demo" });
    expect(c.review!.charity!.lastReviewedAt).not.toBeNull();
    expect(c.review!.warnings.join(" ")).toMatch(/rests on a labeled fixture/);
    expect(c.review!.warnings.join(" ")).toMatch(/not enforced on-chain/);
    const names = c.review!.allocations.map((a) => `${a.label} ${a.percent}`);
    expect(names).toEqual(["CREATOR 60%", "TAX RESERVE 15%", "CHARITY 15%", "PROTOCOL 10%"]);
    const notes = c.review!.allocations.map((a) => a.note).join(" ");
    expect(notes).toMatch(/No payout is created/);
    expect(notes).toMatch(/not your personal Tax Reserve/);
    expect(notes).toMatch(/does not execute a donation/);
    expect(notes).toMatch(/No funds move and no protocol address is configured/);
    expect(JSON.stringify(c.review).toLowerCase()).not.toMatch(/\b(received|paid out|earned)\b/);
  });
  it("an unverified charity blocks configuration, with its registry status, and the launch stays DRAFT", async () => {
    const l = await mk({ charityConfiguration: { charityId: DEMO_IDS.charities.c4 } });
    const r = Launch.parse((await act(l.id, "configure")).json());
    expect(r.status).toBe("DRAFT");
    expect(r.review).toMatchObject({ passed: false });
    expect(r.review!.errors.find((e) => e.field === "charityConfiguration.charityId")!.message).toMatch(/PENDING REVIEW/);
    expect(r.review!.charity).toMatchObject({ verificationState: "PENDING_REVIEW", verificationSource: null });
    expect((await act(l.id, "review")).statusCode).toBe(409); // cannot skip ahead
  });
  it("fails when supply is oversubscribed, and the failure is recorded, not hidden", async () => {
    const l = await mk({ creatorAllocationPercent: "70" });
    const r = Launch.parse((await act(l.id, "configure")).json());
    expect(r.status).toBe("DRAFT");
    expect(r.review!.errors.map((e) => e.field)).toContain("supply");
  });
  it("transitions out of order are refused with 409 and change nothing", async () => {
    const l = await mk();
    for (const a of ["review", "ready"]) expect((await act(l.id, a, a === "ready" ? { fingerprint: l.fingerprint, confirmed: true } : undefined)).statusCode, a).toBe(409);
    await act(l.id, "configure");
    expect((await act(l.id, "configure")).statusCode).toBe(409);
    expect((await act(l.id, "ready", { fingerprint: l.fingerprint, confirmed: true })).statusCode).toBe(409);
    expect(Launch.parse((await get(`/api/launches/${l.id}`)).json()).status).toBe("CONFIGURED");
    const r = await act(l.id, "review");
    expect(r.statusCode).toBe(200);
    expect((await act(l.id, "review")).statusCode).toBe(409);
  });
  it("READY needs the exact current fingerprint and explicit confirmation", async () => {
    const l = await mk();
    await act(l.id, "configure"); await act(l.id, "review");
    expect((await act(l.id, "ready", { fingerprint: "0".repeat(64), confirmed: true })).json().error.code).toBe("FINGERPRINT_MISMATCH");
    for (const body of [{ fingerprint: l.fingerprint }, { fingerprint: l.fingerprint, confirmed: false }, { fingerprint: l.fingerprint, confirmed: "yes" }, { confirmed: true }, { fingerprint: "xyz", confirmed: true },
      { fingerprint: l.fingerprint, confirmed: true, status: "LIVE" }]) {
      expect((await act(l.id, "ready", body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(Launch.parse((await get(`/api/launches/${l.id}`)).json()).status).toBe("REVIEW");
  });
  it("a status can never be sent: not on create, update or any action", async () => {
    const l = await mk();
    for (const status of ["LIVE", "DEPLOYING", "READY", "VERIFIED", "ON_CHAIN", "FAILED"]) {
      expect((await put(`/api/launches/${l.id}`, { ...valid(), status })).statusCode, status).toBe(400);
      expect((await act(l.id, "configure", { status })).statusCode, status).toBe(400);
      expect((await act(l.id, "cancel", { status })).statusCode, status).toBe(400);
      expect((await send("PATCH", `/api/launches/${l.id}`, { status })).statusCode, status).toBe(404);
    }
    expect(Launch.parse((await get(`/api/launches/${l.id}`)).json()).status).toBe("DRAFT");
  });
  it("update returns the launch to DRAFT, clears the review and publication, changes the fingerprint and bumps the revision", async () => {
    const l = await toReady(await mk(), true);
    expect(l.publicVisible).toBe(true);
    const r = Launch.parse((await put(`/api/launches/${l.id}`, { ...valid(), name: "Renamed Token" })).json());
    expect(r).toMatchObject({ status: "DRAFT", review: null, publicVisible: false, readyAt: null });
    expect(r.config.name).toBe("Renamed Token");
    expect(r.fingerprint).not.toBe(l.fingerprint);
    expect(r.revision).toBe(l.revision + 1);
    expect((await get(`/api/public/launches/${l.id}`, null)).statusCode).toBe(404);
  });
  it("cancel is terminal", async () => {
    const l = await mk();
    const c = Launch.parse((await act(l.id, "cancel", { reason: "changed my mind" })).json());
    expect(c.status).toBe("CANCELLED");
    for (const a of ["configure", "review", "cancel"]) expect((await act(l.id, a)).statusCode, a).toBe(409);
    expect((await put(`/api/launches/${l.id}`, valid())).statusCode).toBe(409);
  });
  it("the database cannot represent DEPLOYING, LIVE or FAILED, or a READY that was not reviewed", async () => {
    const l = await mk();
    for (const s of ["LIVE", "DEPLOYING", "FAILED", "live", "VERIFIED"]) {
      await expect(ctx.pool.query("UPDATE launch_configurations SET status = $2 WHERE id = $1", [l.id, s]), s).rejects.toThrow(/launch_status_reachable/);
    }
    await expect(ctx.pool.query("UPDATE launch_configurations SET status = 'READY', ready_at = now() WHERE id = $1", [l.id])).rejects.toThrow(/launch_ready_matches_review/);
    await expect(ctx.pool.query("UPDATE launch_configurations SET status = 'READY', ready_at = now(), reviewed_fingerprint = $2 WHERE id = $1", [l.id, "a".repeat(64)])).rejects.toThrow(/launch_ready_matches_review/);
    await expect(ctx.pool.query("UPDATE launch_configurations SET public_visible = true WHERE id = $1", [l.id])).rejects.toThrow(/launch_public_only_when_ready/);
  });
  it("a stale action (the configuration changed after it was validated) is refused", async () => {
    const l = await mk();
    const r = await applyLaunchAction(ctx.pool, { userId: DEMO_IDS.user, id: l.id, action: "configure", authMethod: "wallet_signature", expectedFingerprint: "f".repeat(64) });
    expect(r).toMatchObject({ ok: false, code: "STALE" });
    expect(Launch.parse((await get(`/api/launches/${l.id}`)).json()).status).toBe("DRAFT");
  });
});

describe("no deployment, mint, liquidity, distribution, payout, donation or transfer endpoint exists", () => {
  it("route listing and probes", async () => {
    const routes = ctx.app.printRoutes({ commonPrefix: false });
    expect(routes).toMatch(/launches/);
    expect(routes).not.toMatch(/deploy|\/mint|liquidity|distribut|payout|\/donate|\/transfer|\/sign|\/send|\/swap|\/claim|\/fund/i);
    const l = await mk();
    for (const p of ["deploy", "mint", "liquidity", "distribute", "payout", "donate", "transfer", "publish", "launch", "sign", "verify", "claim"]) {
      for (const m of ["POST", "PUT"] as const) expect((await send(m, `/api/launches/${l.id}/${p}`, {})).statusCode, `${m} ${p}`).toBe(404);
    }
    expect((await send("DELETE", `/api/launches/${l.id}`)).statusCode).toBe(404);
  });
  it("no fake mint address, signature, explorer link or deployment appears anywhere in launch responses", async () => {
    const l = await toReady(await mk(), true);
    const bodies = [JSON.stringify(l), (await get(`/api/launches/${l.id}`)).body, (await get(`/api/launches/${l.id}/history`)).body, (await get(`/api/public/launches/${l.id}`, null)).body].join(" ");
    expect(bodies).not.toMatch(/explorer|solscan|solana\.fm|"mintAddress":"|"transactionSignature":"|"contractAddress":"|signature":"[1-9A-HJ-NP-Za-km-z]{60,}/i);
    expect(bodies).toContain('"mintAddress":null');
  });
});

describe("configuration fingerprint", () => {
  const cfgOf = (l: Launch): LaunchConfig => l.config;
  it("is deterministic and equal for equivalent spellings", async () => {
    const a = await mk();
    const b = await mk();
    expect(b.fingerprint).toBe(a.fingerprint);
    expect((await mk({ creatorAllocationPercent: "8.00" })).fingerprint).toBe(a.fingerprint);
    expect((await mk({ creatorAllocationPercent: "8.0" })).fingerprint).toBe(a.fingerprint);
    expect(launchFingerprint(cfgOf(a))).toBe(a.fingerprint);
  });
  it("changes when any economically or publicly relevant configuration changes", async () => {
    const base = await mk();
    const variants: Array<[string, Record<string, unknown>]> = [
      ["charity", { charityConfiguration: { charityId: DEMO_IDS.charities.c2 } }], ["supply", { totalSupply: "1000000001" }], ["decimals", { decimals: 9 }], ["network", { network: "mainnet-beta" }],
      ["name", { name: "Example Tokenx" }], ["symbol", { symbol: "EXMPX" }], ["description", { description: "changed" }], ["image", { imageUri: "https://example.org/other.png" }], ["website", { website: "https://example.org/b" }],
      ["social", { socials: { twitter: "https://example.org/x", telegram: "https://example.org/t", discord: null, github: null } }], ["mint authority", { mintAuthority: "creator" }], ["freeze authority", { freezeAuthority: "creator" }],
      ["update authority", { updateAuthority: "disabled" }], ["creator allocation", { creatorAllocationPercent: "9" }], ["liquidity usdc", { liquidityConfiguration: { initialLiquidityUsdc: "50001", supplyPercentage: "40", lockDays: 30 } }],
      ["liquidity supply", { liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "41", lockDays: 30 } }], ["lock", { liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 31 } }],
    ];
    const seen = new Set([base.fingerprint]);
    for (const [name, patch] of variants) {
      const v = await mk(patch);
      expect(v.fingerprint, name).not.toBe(base.fingerprint);
      expect(seen.has(v.fingerprint), `duplicate fingerprint for ${name}`).toBe(false);
      seen.add(v.fingerprint);
    }
  });
  it("covers the creator wallet and the tax reserve allocation destination (same user, second wallet)", async () => {
    const base = await mk();
    const second = DEMO_WALLETS[0]!.address;
    expect((await mk({ creatorWallet: second, taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: creator } })).fingerprint).not.toBe(base.fingerprint);
    expect((await mk({ taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: second } })).fingerprint).not.toBe(base.fingerprint);
  });
  it("contains no secret, session, user id or timestamp", async () => {
    const { canonicalLaunchConfig } = await import("@project-name/shared");
    const l = await mk();
    const text = JSON.stringify(canonicalLaunchConfig(l.config));
    expect(text).not.toContain(ctx.demoToken);
    expect(text).not.toContain(DEMO_IDS.user);
    expect(text).not.toMatch(/createdAt|updatedAt|session|secret|rpc|bearer|authorization/i);
  });
  it("the fingerprint is derived from the stored configuration, not trusted from a column", async () => {
    const l = await mk();
    await ctx.pool.query("UPDATE launch_configurations SET config_fingerprint = $2 WHERE id = $1", [l.id, "b".repeat(64)]);
    expect(Launch.parse((await get(`/api/launches/${l.id}`)).json()).fingerprint).toBe(l.fingerprint);
  });
});

describe("configuration history (auditable, tamper-evident, not a blockchain proof)", () => {
  it("records every action with a fingerprint and an intact hash chain, newest last", async () => {
    const l = await mk();
    await put(`/api/launches/${l.id}`, { ...valid(), description: "edited" });
    const ready = await toReady(Launch.parse((await get(`/api/launches/${l.id}`)).json()));
    const h = LaunchHistory.parse((await get(`/api/launches/${l.id}/history`)).json());
    expect(h.revisions.map((r) => r.action)).toEqual(["create", "update", "configure", "review", "ready"]);
    expect(h.revisions.map((r) => r.statusAfter)).toEqual(["DRAFT", "DRAFT", "CONFIGURED", "REVIEW", "READY"]);
    expect(h.revisions.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(h.revisions[0]!.prevHash).toBeNull();
    for (let i = 1; i < h.revisions.length; i++) expect(h.revisions[i]!.prevHash).toBe(h.revisions[i - 1]!.rowHash);
    expect(h.revisions[0]!.fingerprint).not.toBe(h.revisions[1]!.fingerprint); // the edit changed it
    expect(h.revisions.at(-1)!.fingerprint).toBe(ready.fingerprint);
    expect(h.historyIntact).toBe(true);
    expect(h.note).toMatch(/not a blockchain proof/);
    expect(JSON.stringify(h).toLowerCase()).not.toMatch(/immutable|cryptographically/);
  });
  it("records the reason when one is given", async () => {
    const l = await mk();
    await act(l.id, "cancel", { reason: "duplicate configuration" });
    const h = LaunchHistory.parse((await get(`/api/launches/${l.id}/history`)).json());
    expect(h.revisions.at(-1)).toMatchObject({ action: "cancel", reason: "duplicate configuration", statusAfter: "CANCELLED" });
  });
  it("rows cannot be updated or deleted, and tampering outside the API is detected", async () => {
    const l = await mk();
    await expect(ctx.pool.query("UPDATE launch_configuration_revisions SET reason = 'x' WHERE launch_id = $1", [l.id])).rejects.toThrow();
    await expect(ctx.pool.query("DELETE FROM launch_configuration_revisions WHERE launch_id = $1", [l.id])).rejects.toThrow();
    expect(LaunchHistory.parse((await get(`/api/launches/${l.id}/history`)).json()).historyIntact).toBe(true);
    await ctx.pool.query("UPDATE launch_configurations SET config = jsonb_set(config, '{name}', '\"Tampered\"') WHERE id = $1", [l.id]); // an out-of-band edit
    expect(LaunchHistory.parse((await get(`/api/launches/${l.id}/history`)).json()).historyIntact).toBe(false);
  });
  it("is owner-only", async () => {
    const l = await mk();
    expect((await get(`/api/launches/${l.id}/history`, other.token)).statusCode).toBe(404);
    expect((await get(`/api/launches/${l.id}/history`, null)).statusCode).toBe(401);
    expect((await get("/api/launches/not-a-uuid/history")).statusCode).toBe(400);
  });
  it("a failed review is also a recorded event", async () => {
    const l = await mk({ charityConfiguration: { charityId: DEMO_IDS.charities.c4 } });
    await act(l.id, "configure");
    const h = LaunchHistory.parse((await get(`/api/launches/${l.id}/history`)).json());
    expect(h.revisions.map((r) => [r.action, r.statusAfter])).toEqual([["create", "DRAFT"], ["configure", "DRAFT"]]);
  });
});

describe("ownership and authentication", () => {
  it("every launch route requires a session", async () => {
    const l = await mk();
    for (const [m, url, body] of [
      ["POST", "/api/launches", valid()], ["GET", "/api/launches", undefined], ["GET", `/api/launches/${l.id}`, undefined], ["PUT", `/api/launches/${l.id}`, valid()],
      ["POST", `/api/launches/${l.id}/configure`, undefined], ["POST", `/api/launches/${l.id}/review`, undefined], ["POST", `/api/launches/${l.id}/ready`, { fingerprint: l.fingerprint, confirmed: true }],
      ["POST", `/api/launches/${l.id}/cancel`, undefined], ["GET", `/api/launches/${l.id}/history`, undefined],
    ] as const) expect((await send(m, url, body, null)).statusCode, `${m} ${url}`).toBe(401);
  });
  it("another user can neither read nor change a launch, and the answer is the same as for an unknown id", async () => {
    const l = await mk();
    const unknown = "00000000-0000-4000-8000-0000000fffff";
    const otherCfg = valid(other.address);
    for (const [m, suffix, body] of [
      ["GET", "", undefined], ["PUT", "", otherCfg], ["POST", "/configure", undefined], ["POST", "/review", undefined],
      ["POST", "/ready", { fingerprint: l.fingerprint, confirmed: true }], ["POST", "/cancel", undefined], ["GET", "/history", undefined],
    ] as const) {
      const foreign = await send(m, `/api/launches/${l.id}${suffix}`, body, other.token);
      const missing = await send(m, `/api/launches/${unknown}${suffix}`, body, other.token);
      expect([foreign.statusCode, missing.statusCode], `${m} ${suffix}`).toEqual([404, 404]);
      expect(foreign.json().error.code).toBe(missing.json().error.code);
      expect(foreign.body).not.toContain(l.config.name);
    }
    const unchanged = Launch.parse((await get(`/api/launches/${l.id}`)).json());
    expect(unchanged).toMatchObject({ status: "DRAFT", revision: 1, fingerprint: l.fingerprint });
  });
  it("lists only the actor's launches; a real user never receives fabricated launches", async () => {
    const mine = await mk({}, other.token, other.address);
    const list = LaunchList.parse((await get("/api/launches?limit=100", other.token)).json());
    expect(list.launches.map((x) => x.id)).toEqual([mine.id]);
    expect(list.launches.every((x) => x.dataSource === "database")).toBe(true);
    const fresh = await makeOtherUser(ctx.pool);
    expect(LaunchList.parse((await get("/api/launches", fresh.token)).json())).toMatchObject({ launches: [], pagination: { total: 0 } });
    expect((await get("/api/launches/not-a-uuid")).statusCode).toBe(400);
  });
  it("ownership comes from the session: a creator wallet that is someone else's is refused even with their address", async () => {
    expect((await post("/api/launches", valid(other.address))).statusCode).toBe(422);
    const l = await mk({}, other.token, other.address);
    expect((await put(`/api/launches/${l.id}`, valid(other.address), ctx.demoToken)).statusCode).toBe(404);
    expect((await put(`/api/launches/${l.id}`, valid(), other.token)).statusCode).toBe(422);
  });
  it("paginates", async () => {
    const r = LaunchList.parse((await get("/api/launches?limit=1&offset=0")).json());
    expect(r.launches).toHaveLength(1);
    expect(r.pagination.total).toBeGreaterThan(1);
    expect((await get("/api/launches?limit=0")).statusCode).toBe(400);
  });
  it("enforces the per-account limit", async () => {
    const small = await makeCtx({ MAX_LAUNCHES_PER_USER: "3" });
    try {
      const u = await makeOtherUser(small.pool);
      const cfg = valid(u.address);
      const p = (t: string) => small.app.inject({ method: "POST", url: "/api/launches", payload: cfg, headers: bearer(t) });
      for (let i = 0; i < 3; i++) expect((await p(u.token)).statusCode).toBe(201);
      const r = await p(u.token);
      expect([r.statusCode, r.json().error.code]).toEqual([409, "LIMIT_REACHED"]);
    } finally { await small.close(); }
  });
});

describe("public launch view", () => {
  it("is private by default: drafts, configured, review and unpublished READY launches do not exist publicly", async () => {
    const l = await mk();
    expect((await get(`/api/public/launches/${l.id}`, null)).statusCode).toBe(404);
    await act(l.id, "configure");
    expect((await get(`/api/public/launches/${l.id}`, null)).statusCode).toBe(404);
    await act(l.id, "review");
    expect((await get(`/api/public/launches/${l.id}`, null)).statusCode).toBe(404);
    const ready = await toReady(await mk(), false);
    expect(ready.publicVisible).toBe(false);
    expect((await get(`/api/public/launches/${ready.id}`, null)).statusCode).toBe(404);
    expect(PublicLaunchList.parse((await get("/api/public/launches", null)).json()).launches.some((x) => x.id === ready.id)).toBe(false);
  });
  it("a published READY configuration is public, unauthenticated, and labeled CONFIGURED / NOT DEPLOYED / NOT VERIFIED ON-CHAIN", async () => {
    const l = await toReady(await mk({ name: "Public Example" }), true);
    const r = await get(`/api/public/launches/${l.id}`, null);
    expect(r.statusCode).toBe(200);
    const p = PublicLaunch.parse(r.json());
    expect(p).toMatchObject({
      id: l.id, status: "READY", name: "Public Example", symbol: "EXMPL", network: "devnet", fingerprint: l.fingerprint, feeSplitLabel: "Configured fee split", feeSplitEnforcement: "not_enforced",
      feeSplit: { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 }, metadata: { source: "USER_PROVIDED", verifiedOnChain: false }, deployment: { status: "not_deployed", mintAddress: null },
    });
    expect(p.labels).toEqual(expect.arrayContaining(["CONFIGURED", "NOT DEPLOYED", "NOT VERIFIED ON-CHAIN"]));
    expect(p.charity).toMatchObject({ name: "Open Water Initiative (demo)", verificationState: "VERIFIED", verificationSource: "FIXTURE" });
    expect(p.creator).toBe(`${creator.slice(0, 4)}…${creator.slice(-4)}`);
    expect(p.allocations.map((a) => a.percent)).toEqual(["60%", "15%", "15%", "10%"]);
  });
  it("shows the charity's CURRENT registry state, not a stale one", async () => {
    const l = await toReady(await mk(), true);
    await ctx.pool.query("UPDATE charities SET verification_state = 'SUSPENDED', verification_source = NULL, verification_checked_at = NULL WHERE id = $1", [DEMO_IDS.charities.c1]);
    try {
      expect(PublicLaunch.parse((await get(`/api/public/launches/${l.id}`, null)).json()).charity).toMatchObject({ verificationState: "SUSPENDED", verificationSource: null });
    } finally {
      await ctx.pool.query("UPDATE charities SET verification_state = 'VERIFIED', verification_source = 'FIXTURE', verification_checked_at = now() WHERE id = $1", [DEMO_IDS.charities.c1]);
    }
  });
  it("exposes no user id, session, full wallet address, reserve destination, review internals or history", async () => {
    const l = await toReady(await mk(), true);
    const body = (await get(`/api/public/launches/${l.id}`, null)).body + (await get("/api/public/launches", null)).body;
    for (const secret of [DEMO_IDS.user, ctx.demoToken, creator, "creatorWallet", "taxReserveConfiguration", "destinationAddress", "creatorUserId", "reviewedAt", "rowHash", "prevHash", "errors", "reviewedFingerprint"]) {
      expect(body, secret).not.toContain(secret);
    }
    expect(body).not.toMatch(/session|token_hash|authorization|rpc/i);
  });
  it("hides again after an edit or a cancel, and an unknown id is a 404", async () => {
    const a = await toReady(await mk(), true);
    await put(`/api/launches/${a.id}`, { ...valid(), name: "Edited" });
    expect((await get(`/api/public/launches/${a.id}`, null)).statusCode).toBe(404);
    const b = await toReady(await mk(), true);
    await act(b.id, "cancel");
    expect((await get(`/api/public/launches/${b.id}`, null)).statusCode).toBe(404);
    expect((await get("/api/public/launches/00000000-0000-4000-8000-0000000fffff", null)).statusCode).toBe(404);
    expect((await get("/api/public/launches/zzz", null)).statusCode).toBe(400);
  });
  it("lists published launches only, paginated", async () => {
    const l = await toReady(await mk({ name: "Listed One" }), true);
    const r = PublicLaunchList.parse((await get("/api/public/launches?limit=100", null)).json());
    expect(r.launches.some((x) => x.id === l.id)).toBe(true);
    expect(r.launches.every((x) => x.status === "READY")).toBe(true);
    expect(r.pagination.total).toBe(r.launches.length);
    expect((await get("/api/public/launches?limit=0", null)).statusCode).toBe(400);
  });
});

describe("language", () => {
  it("responses never use banned phrases, never say immutable, and never claim deployment", async () => {
    const l = await toReady(await mk(), true);
    const bodies = [JSON.stringify(l), (await get(`/api/public/launches/${l.id}`, null)).body, (await get(`/api/launches/${l.id}/history`)).body].join(" ").toLowerCase();
    for (const p of BANNED_PHRASES) expect(bodies, p).not.toContain(p);
    expect(bodies).not.toMatch(/immutable|guaranteed|"status":"(live|deploying)"|has been deployed|is live/);
    expect(bodies).toContain("not_deployed");
  });
});
