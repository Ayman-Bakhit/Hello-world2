import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApiErrorBody, DEMO_IDS, DEMO_WALLETS, Launch, LaunchProof, PROOF_COPY, fakeBase58, fakeMint, fakeSignature, launchFingerprint, matchingFixtureObservation, observationRowHash,
  type ChainObservation,
} from "@project-name/shared";
import { createSession } from "../src/auth/session";
import { appendObservation, getProofState, recordProofRecord } from "../src/db/proofRepos";
import { bearer, makeCtx, makeOtherUser, type Ctx } from "./helpers";

let ctx: Ctx;
let other: Awaited<ReturnType<typeof makeOtherUser>>;
beforeAll(async () => { ctx = await makeCtx({ MAX_LAUNCHES_PER_USER: "5000" }); other = await makeOtherUser(ctx.pool); });
afterAll(async () => {
  // the test charity is removed so later files see the seeded registry only (evidence is append-only, so the guard is lifted for cleanup)
  if (live) {
    await ctx.pool.query("ALTER TABLE charity_verification_evidence DISABLE TRIGGER charity_evidence_immutable");
    try {
      await ctx.pool.query("DELETE FROM charity_verification_evidence WHERE charity_id = $1", [live.charityId]);
      await ctx.pool.query("DELETE FROM charity_wallets WHERE charity_id = $1", [live.charityId]);
      await ctx.pool.query("DELETE FROM charities WHERE id = $1", [live.charityId]);
    } finally { await ctx.pool.query("ALTER TABLE charity_verification_evidence ENABLE TRIGGER charity_evidence_immutable"); }
  }
  await ctx.close();
});

const demoCreator = DEMO_WALLETS[1]!.address;
const body = (addr: string, charityId: string = DEMO_IDS.charities.c1) => ({
  name: "Proof Token", symbol: "PRF", description: "A test configuration", totalSupply: "1000000000", decimals: 6, creatorAllocationPercent: "8", creatorWallet: addr, network: "devnet",
  liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 30 },
  feeSplit: { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 }, charityConfiguration: { charityId },
  taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: addr },
});
const call = (method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", url: string, token: string | null, payload?: unknown) =>
  ctx.app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }), headers: token ? bearer(token) : {} });
async function ready(token: string, addr: string, publish: boolean, charityId?: string) {
  const c = await call("POST", "/api/launches", token, body(addr, charityId));
  expect(c.statusCode, c.body).toBe(201);
  const l = Launch.parse(c.json());
  expect((await call("POST", `/api/launches/${l.id}/configure`, token)).statusCode).toBe(200);
  expect((await call("POST", `/api/launches/${l.id}/review`, token)).statusCode).toBe(200);
  const r = await call("POST", `/api/launches/${l.id}/ready`, token, { fingerprint: l.fingerprint, confirmed: true, publish });
  expect(r.statusCode, r.body).toBe(200);
  return Launch.parse(r.json());
}
const ownerProof = async (id: string, token = ctx.demoToken) => LaunchProof.parse((await call("GET", `/api/launches/${id}/proof`, token)).json());
const publicProof = async (id: string) => LaunchProof.parse((await call("GET", `/api/public/launches/${id}/proof`, null)).json());

/** a user with a base58 wallet and a charity with a base58 verified wallet, so a full on-chain match is expressible */
let live: { userId: string; token: string; address: string; charityId: string; charityWallet: string };
async function makeLive(seed: string) {
  const address = fakeBase58(`proof-wallet:${seed}`, 44);
  const u = await ctx.pool.query("INSERT INTO users (display_name) VALUES ($1) RETURNING id", [`proof-${seed}`]);
  const w = await ctx.pool.query("INSERT INTO wallets (user_id, chain, address, label, data_source, ownership_verified_at) VALUES ($1,'solana',$2,'Live','database', now()) RETURNING id", [u.rows[0].id, address]);
  const { token } = await createSession(ctx.pool, { userId: u.rows[0].id as string, walletId: w.rows[0].id as string, authMethod: "wallet_signature", ttlHours: 1 });
  const charityId = crypto.randomUUID();
  const charityWallet = fakeBase58(`proof-charity:${seed}`, 44);
  const db = await ctx.pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("INSERT INTO charities (id, slug, name, verification_state, verification_source, verification_checked_at, data_source) VALUES ($1,$2,'Proof Charity','VERIFIED','ADMIN_REVIEW', now(), 'database')", [charityId, `proof-charity-${seed}`]);
    await db.query("INSERT INTO charity_verification_evidence (charity_id, source_type, source_ref, status, checked_at, public_summary, data_source) VALUES ($1,'ADMIN_REVIEW','ref','SUPPORTS', now(), 'summary', 'database')", [charityId]);
    await db.query("INSERT INTO charity_wallets (charity_id, chain, address, verification_status) VALUES ($1,'solana',$2,'verified')", [charityId, charityWallet]);
    await db.query("COMMIT");
  } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  return { userId: u.rows[0].id as string, token, address, charityId, charityWallet };
}
beforeAll(async () => { live = await makeLive("a"); });

describe("owner proof endpoint", () => {
  it("requires authentication", async () => {
    const l = await ready(ctx.demoToken, demoCreator, false);
    expect((await call("GET", `/api/launches/${l.id}/proof`, null)).statusCode).toBe(401);
  });
  it("a READY launch that was never deployed is NOT DEPLOYED: no fabricated mint, signature, explorer link or timestamp", async () => {
    const l = await ready(ctx.demoToken, demoCreator, false);
    const r = await call("GET", `/api/launches/${l.id}/proof`, ctx.demoToken);
    expect(r.statusCode).toBe(200); expect(r.headers["cache-control"]).toBe("no-store");
    const p = LaunchProof.parse(r.json());
    expect(p).toMatchObject({ status: "NOT_DEPLOYED", statusLabel: "NOT DEPLOYED", verifiedOnChain: false, verifiedTransparency: false, audience: "owner", dataSource: "database", observed: null, checks: [], mismatches: [] });
    expect(p.identity).toMatchObject({ mintAddress: null, deploymentSignature: null, observedAt: null, explorerUrl: null });
    expect(p.configured.fingerprint).toBe(l.fingerprint); expect(p.configured.metadata.provenance).toBe("USER_PROVIDED");
    expect(p.evidence).toMatchObject({ class: "NONE", source: null, observationCount: 0 });
    expect(r.body).not.toMatch(/solscan|explorer\.solana/);
    expect(p.disclosures).toContain(PROOF_COPY.configuredNotProof);
  });
  it("shows the owner their own reserve destination and full creator address", async () => {
    const l = await ready(ctx.demoToken, demoCreator, false);
    const p = await ownerProof(l.id);
    expect(p.configured.taxReserve.destination).toBe(demoCreator); expect(p.configured.creator.address).toBe(demoCreator);
  });
  it("a foreign launch and an unknown launch are the same 404 and leak nothing", async () => {
    const l = await ready(ctx.demoToken, demoCreator, true);
    const foreign = await call("GET", `/api/launches/${l.id}/proof`, other.token);
    const unknown = await call("GET", `/api/launches/${crypto.randomUUID()}/proof`, other.token);
    expect(foreign.statusCode).toBe(404); expect(unknown.statusCode).toBe(404);
    expect(ApiErrorBody.parse(foreign.json()).error.code).toBe("NOT_FOUND");
    expect(foreign.body).toBe(unknown.body.replace(/[0-9a-f-]{36}/g, (m) => m));
    expect(foreign.body).not.toContain(l.id); expect(foreign.body).not.toContain(l.config.name);
    expect((await call("GET", `/api/launches/not-a-uuid/proof`, ctx.demoToken)).statusCode).toBe(400);
  });
  it("a DRAFT launch has a proof view too (always NOT DEPLOYED), but only for its owner", async () => {
    const c = Launch.parse((await call("POST", "/api/launches", ctx.demoToken, body(demoCreator))).json());
    expect((await ownerProof(c.id)).status).toBe("NOT_DEPLOYED");
    expect((await call("GET", `/api/launches/${c.id}/proof`, other.token)).statusCode).toBe(404);
  });
});

describe("public proof endpoint", () => {
  it("serves only READY, published launches; drafts, unpublished READY and unknown ids are indistinguishable 404s", async () => {
    const draft = Launch.parse((await call("POST", "/api/launches", ctx.demoToken, body(demoCreator))).json());
    const unpublished = await ready(ctx.demoToken, demoCreator, false);
    const unknown = await call("GET", `/api/public/launches/${crypto.randomUUID()}/proof`, null);
    for (const id of [draft.id, unpublished.id]) {
      const r = await call("GET", `/api/public/launches/${id}/proof`, null);
      expect(r.statusCode).toBe(404); expect(JSON.parse(r.body).error.code).toBe(JSON.parse(unknown.body).error.code);
    }
    const published = await ready(ctx.demoToken, demoCreator, true);
    expect((await call("GET", `/api/public/launches/${published.id}/proof`, null)).statusCode).toBe(200);
    await call("POST", `/api/launches/${published.id}/cancel`, ctx.demoToken, {});
    expect((await call("GET", `/api/public/launches/${published.id}/proof`, null)).statusCode).toBe(404);
  });
  it("is abbreviated and private: no reserve destination, no full creator address, no user id, session or secrets", async () => {
    const l = await ready(ctx.demoToken, demoCreator, true);
    const r = await call("GET", `/api/public/launches/${l.id}/proof`, null);
    const p = LaunchProof.parse(r.json());
    expect(p.audience).toBe("public"); expect(p.status).toBe("NOT_DEPLOYED");
    expect(p.configured.taxReserve.destination).toBeNull();
    expect(r.body).not.toContain(demoCreator);
    for (const s of ["userId", "creatorUserId", "session", "cookie", "internal", "password", "secret", "destinationAddress", "taxReserveConfiguration"]) expect(r.body.toLowerCase(), s).not.toContain(s.toLowerCase());
    expect(r.body).not.toContain(DEMO_IDS.admin); expect(r.body).not.toContain(other.userId);
  });
  it("changing a published launch (back to DRAFT) removes its public proof", async () => {
    const l = await ready(ctx.demoToken, demoCreator, true);
    const put = await call("PUT", `/api/launches/${l.id}`, ctx.demoToken, { ...body(demoCreator), name: "Changed" });
    expect(put.statusCode, put.body).toBe(200);
    expect((await call("GET", `/api/public/launches/${l.id}/proof`, null)).statusCode).toBe(404);
  });
});

describe("no way to declare or write verification over HTTP", () => {
  it("has no write routes under any proof path, and no client field can influence the proof", async () => {
    const l = await ready(ctx.demoToken, demoCreator, true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) for (const url of [`/api/launches/${l.id}/proof`, `/api/public/launches/${l.id}/proof`, `/api/launches/${l.id}/verify`, `/api/launches/${l.id}/observation`, `/api/launches/${l.id}/observations`, `/api/proof`, `/api/proofs`]) {
      const r = await call(method, url, ctx.demoToken, { status: "VERIFIED", verifiedOnChain: true, verifiedTransparency: true });
      expect([404, 405], `${method} ${url}`).toContain(r.statusCode);
    }
    const q = await call("GET", `/api/launches/${l.id}/proof?status=VERIFIED&verifiedOnChain=true&verifiedTransparency=true&observation={}`, ctx.demoToken);
    const p = LaunchProof.parse(q.json());
    expect(p.status).toBe("NOT_DEPLOYED"); expect(p.verifiedTransparency).toBe(false);
    const row = await ctx.pool.query("SELECT count(*)::int AS n FROM token_proofs WHERE launch_id = $1", [l.id]);
    expect(row.rows[0].n).toBe(0);
  });
  it("no route module imports the privileged proof writers", () => {
    const dir = join(__dirname, "../src/routes");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/recordProofRecord|appendObservation/);
    }
  });
});

describe("database rules (privileged writers, tests only)", () => {
  it("a proof needs a READY launch on the same network, with base58 identifiers", async () => {
    const draft = Launch.parse((await call("POST", "/api/launches", ctx.demoToken, body(demoCreator))).json());
    const mint = fakeMint("db1");
    await expect(recordProofRecord(ctx.pool, { launchId: draft.id, network: "devnet", mintAddress: mint, deploymentSignature: null, deployedFingerprint: draft.fingerprint, dataSource: "chain" })).rejects.toThrow(/READY/);
    const l = await ready(ctx.demoToken, demoCreator, false);
    await expect(recordProofRecord(ctx.pool, { launchId: l.id, network: "mainnet-beta", mintAddress: mint, deploymentSignature: null, deployedFingerprint: l.fingerprint, dataSource: "chain" })).rejects.toThrow(/network/);
    await expect(recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: "DEMO-not-base58", deploymentSignature: null, deployedFingerprint: l.fingerprint, dataSource: "chain" })).rejects.toThrow();
    await expect(recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: mint, deploymentSignature: "short", deployedFingerprint: l.fingerprint, dataSource: "chain" })).rejects.toThrow();
    await expect(recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: mint, deploymentSignature: null, deployedFingerprint: "xyz", dataSource: "chain" })).rejects.toThrow();
  });
  it("proof records and observations are append-only", async () => {
    const l = await ready(live.token, live.address, false, live.charityId);
    const id = await recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: fakeMint("db2"), deploymentSignature: fakeSignature("db2"), deployedFingerprint: l.fingerprint, dataSource: "demo" });
    await expect(ctx.pool.query("UPDATE token_proofs SET mint_address = $1 WHERE id = $2", [fakeMint("x"), id])).rejects.toThrow();
    await expect(ctx.pool.query("DELETE FROM token_proofs WHERE id = $1", [id])).rejects.toThrow();
    await expect(recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: fakeMint("db3"), deploymentSignature: null, deployedFingerprint: null, dataSource: "demo" })).rejects.toThrow(); // one record per launch
    await appendObservation(ctx.pool, id, matchingFixtureObservation(l.config));
    await expect(ctx.pool.query("UPDATE token_proof_observations SET source = 'RPC' WHERE proof_id = $1", [id])).rejects.toThrow();
    await expect(ctx.pool.query("DELETE FROM token_proof_observations WHERE proof_id = $1", [id])).rejects.toThrow();
  });
  it("fixture observations only belong to demo proofs, and demo proofs only take fixture observations", async () => {
    const a = await ready(live.token, live.address, false, live.charityId);
    const real = await recordProofRecord(ctx.pool, { launchId: a.id, network: "devnet", mintAddress: fakeMint("db4"), deploymentSignature: null, deployedFingerprint: a.fingerprint, dataSource: "chain" });
    await expect(appendObservation(ctx.pool, real, matchingFixtureObservation(a.config))).rejects.toThrow(/FIXTURE/);
    const b = await ready(live.token, live.address, false, live.charityId);
    const demo = await recordProofRecord(ctx.pool, { launchId: b.id, network: "devnet", mintAddress: fakeMint("db5"), deploymentSignature: null, deployedFingerprint: b.fingerprint, dataSource: "demo" });
    await expect(appendObservation(ctx.pool, demo, { ...matchingFixtureObservation(b.config), source: "RPC" })).rejects.toThrow(/FIXTURE/);
  });
  it("a malformed observation is refused before it reaches the database", async () => {
    const l = await ready(live.token, live.address, false, live.charityId);
    const id = await recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: fakeMint("db6"), deploymentSignature: null, deployedFingerprint: l.fingerprint, dataSource: "demo" });
    const good = matchingFixtureObservation(l.config);
    await expect(appendObservation(ctx.pool, id, { ...good, supplyRaw: { status: "OBSERVED", value: "-1" } })).rejects.toThrow();
    await expect(appendObservation(ctx.pool, id, { ...good, junk: true })).rejects.toThrow();
    await expect(appendObservation(ctx.pool, id, "nope")).rejects.toThrow();
    expect((await getProofState(ctx.pool, l.id)).observationCount).toBe(0);
  });
  it("an observation timestamp in the future is rejected", async () => {
    const l = await ready(live.token, live.address, false, live.charityId);
    const id = await recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: fakeMint("db7"), deploymentSignature: null, deployedFingerprint: l.fingerprint, dataSource: "demo" });
    await expect(appendObservation(ctx.pool, id, { ...matchingFixtureObservation(l.config), observedAt: new Date(Date.now() + 3_600_000).toISOString() })).rejects.toThrow();
  });
});

describe("derived verification from stored rows", () => {
  const rpcMatch = (cfg: Launch["config"], charityWallet: string, mint: string): ChainObservation => {
    const o = matchingFixtureObservation(cfg);
    return {
      ...o, source: "RPC", observedAt: new Date().toISOString(), mintAddress: { status: "OBSERVED", value: mint },
      feeRouting: { status: "OBSERVED", value: { creatorBps: 6000, taxReserveBps: 1500, charityBps: 1500, protocolBps: 1000, creatorRecipient: cfg.creatorWallet, taxReserveRecipient: cfg.taxReserveConfiguration.destinationAddress, charityRecipient: charityWallet } },
    };
  };
  it("a matching RPC observation is VERIFIED; the same observation recorded as a FIXTURE on a demo proof is not", async () => {
    const l = await ready(live.token, live.address, true, live.charityId);
    const mint = fakeMint("v1");
    const pid = await recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: mint, deploymentSignature: fakeSignature("v1"), deployedFingerprint: l.fingerprint, dataSource: "chain" });
    expect((await ownerProof(l.id, live.token)).status).toBe("AWAITING_OBSERVATION");
    await appendObservation(ctx.pool, pid, rpcMatch(l.config, live.charityWallet, mint));
    const own = await ownerProof(l.id, live.token);
    expect(own).toMatchObject({ status: "VERIFIED", statusLabel: "VERIFIED TRANSPARENCY", verifiedOnChain: true, verifiedTransparency: true, evidence: { class: "OBSERVED_ON_CHAIN", source: "RPC", observationCount: 1, historyIntact: true } });
    expect(own.checks.filter((c) => c.required).every((c) => c.state === "PASS")).toBe(true);
    expect(own.identity.explorerUrl).toBeNull();
    const pub = await publicProof(l.id);
    expect(pub.status).toBe("VERIFIED"); expect(pub.configured.taxReserve.destination).toBeNull();
    expect(JSON.stringify(pub)).not.toContain(live.address);

    const l2 = await ready(live.token, live.address, true, live.charityId);
    const demoPid = await recordProofRecord(ctx.pool, { launchId: l2.id, network: "devnet", mintAddress: mint, deploymentSignature: fakeSignature("v2"), deployedFingerprint: l2.fingerprint, dataSource: "demo" });
    await appendObservation(ctx.pool, demoPid, { ...rpcMatch(l2.config, live.charityWallet, mint), source: "FIXTURE" });
    const d = await ownerProof(l2.id, live.token);
    expect(d.status).toBe("PARTIAL"); expect(d.verifiedTransparency).toBe(false); expect(d.dataSource).toBe("database");
    expect(d.evidence.class).toBe("FIXTURE");
  });
  it("a later observation that differs turns the proof FAILED with the mismatch named", async () => {
    const l = await ready(live.token, live.address, true, live.charityId);
    const mint = fakeMint("v3");
    const pid = await recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: mint, deploymentSignature: fakeSignature("v3"), deployedFingerprint: l.fingerprint, dataSource: "chain" });
    const ok = rpcMatch(l.config, live.charityWallet, mint);
    await appendObservation(ctx.pool, pid, ok);
    expect((await ownerProof(l.id, live.token)).status).toBe("VERIFIED");
    await appendObservation(ctx.pool, pid, { ...ok, observedAt: new Date().toISOString(), supplyRaw: { status: "OBSERVED", value: "1" } });
    const p = await ownerProof(l.id, live.token);
    expect(p.status).toBe("FAILED"); expect(p.verifiedTransparency).toBe(false); expect(p.mismatches.map((m) => m.checkId)).toContain("SUPPLY_MATCH");
    expect(p.evidence.observationCount).toBe(2);
  });
  it("a configuration edited after deployment fails the fingerprint check (never silently VERIFIED)", async () => {
    const l = await ready(live.token, live.address, false, live.charityId);
    const mint = fakeMint("v4");
    await recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: mint, deploymentSignature: fakeSignature("v4"), deployedFingerprint: launchFingerprint({ ...l.config, name: "Different" }), dataSource: "chain" });
    const p = await ownerProof(l.id, live.token);
    expect(p.checks.find((c) => c.id === "CONFIGURATION_FINGERPRINT_MATCH")!.state).toBe("FAIL");
  });
  it("tampering with a stored observation makes the history UNAVAILABLE and is never trusted", async () => {
    const l = await ready(live.token, live.address, true, live.charityId);
    const mint = fakeMint("v5");
    const pid = await recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: mint, deploymentSignature: fakeSignature("v5"), deployedFingerprint: l.fingerprint, dataSource: "chain" });
    await appendObservation(ctx.pool, pid, rpcMatch(l.config, live.charityWallet, mint));
    expect((await ownerProof(l.id, live.token)).status).toBe("VERIFIED");
    // a database operator bypasses the immutability trigger and edits the observation: the hash chain exposes it
    await ctx.pool.query("ALTER TABLE token_proof_observations DISABLE TRIGGER token_proof_observations_immutable");
    try {
      await ctx.pool.query("UPDATE token_proof_observations SET observation = jsonb_set(observation, '{decimals,value}', '9') WHERE proof_id = $1", [pid]);
    } finally { await ctx.pool.query("ALTER TABLE token_proof_observations ENABLE TRIGGER token_proof_observations_immutable"); }
    const p = await ownerProof(l.id, live.token);
    expect(p).toMatchObject({ status: "UNAVAILABLE", verifiedOnChain: false, verifiedTransparency: false, observed: null, evidence: { historyIntact: false } });
    expect((await publicProof(l.id)).status).toBe("UNAVAILABLE");
  });
  it("a charity with no unambiguous verified wallet keeps CHARITY_MATCH unknown, so no VERIFIED", async () => {
    const l = await ready(ctx.demoToken, demoCreator, false); // c1 registry wallet is a placeholder, not a base58 address
    const mint = fakeMint("v6");
    const pid = await recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: mint, deploymentSignature: fakeSignature("v6"), deployedFingerprint: l.fingerprint, dataSource: "chain" });
    await ctx.pool.query("SELECT 1");
    await appendObservation(ctx.pool, pid, rpcMatch({ ...l.config, creatorWallet: fakeBase58("c", 44), taxReserveConfiguration: { ...l.config.taxReserveConfiguration, destinationAddress: fakeBase58("r", 44) } }, fakeBase58("ch", 44), mint));
    const p = await ownerProof(l.id);
    expect(p.verifiedTransparency).toBe(false); expect(p.status).not.toBe("VERIFIED");
    expect(p.checks.find((c) => c.id === "CHARITY_MATCH")!.state).toBe("UNKNOWN");
  });
  it("observation hashing is chained: each row hash commits to the previous one", async () => {
    const l = await ready(live.token, live.address, true, live.charityId);
    const mint = fakeMint("v7");
    const pid = await recordProofRecord(ctx.pool, { launchId: l.id, network: "devnet", mintAddress: mint, deploymentSignature: null, deployedFingerprint: l.fingerprint, dataSource: "chain" });
    const o = rpcMatch(l.config, live.charityWallet, mint);
    await appendObservation(ctx.pool, pid, o); await appendObservation(ctx.pool, pid, { ...o, observedAt: new Date().toISOString() });
    const rows = (await ctx.pool.query("SELECT seq, prev_hash, row_hash, observation FROM token_proof_observations WHERE proof_id = $1 ORDER BY seq", [pid])).rows;
    expect(rows[0].prev_hash).toBeNull(); expect(rows[1].prev_hash).toBe(rows[0].row_hash);
    expect(rows[0].row_hash).toBe(observationRowHash({ proofId: pid, seq: 1, source: "RPC", observedAt: o.observedAt, observation: o, prevHash: null }));
  });
});
