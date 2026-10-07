import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiErrorBody, DEMO_IDS, DEMO_WALLETS, DeploymentPlanResponse, DeploymentReviewResponse, Launch, fixtureAddress } from "@project-name/shared";
import { createSession } from "../src/auth/session";
import { bearer, makeCtx, makeOtherUser, type Ctx } from "./helpers";

let ctx: Ctx;
let other: Awaited<ReturnType<typeof makeOtherUser>>;
let live: { userId: string; token: string; address: string; reserve: string; charityId: string; charityWallet: string };
const extraCharities: string[] = [];
beforeAll(async () => { ctx = await makeCtx({ MAX_LAUNCHES_PER_USER: "5000" }); other = await makeOtherUser(ctx.pool); live = await makeLive("dp"); });
afterAll(async () => {
  await ctx.pool.query("ALTER TABLE charity_verification_evidence DISABLE TRIGGER charity_evidence_immutable");
  try {
    for (const id of [live.charityId, ...extraCharities]) {
      await ctx.pool.query("DELETE FROM charity_verification_evidence WHERE charity_id = $1", [id]);
      await ctx.pool.query("DELETE FROM charity_wallets WHERE charity_id = $1", [id]);
      await ctx.pool.query("DELETE FROM charities WHERE id = $1", [id]);
    }
  } finally { await ctx.pool.query("ALTER TABLE charity_verification_evidence ENABLE TRIGGER charity_evidence_immutable"); }
  await ctx.close();
});

async function makeCharity(seed: string, wallets: string[]) {
  const id = crypto.randomUUID();
  const db = await ctx.pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("INSERT INTO charities (id, slug, name, verification_state, verification_source, verification_checked_at, data_source) VALUES ($1,$2,'Plan Charity','VERIFIED','ADMIN_REVIEW', now(), 'database')", [id, `plan-charity-${seed}`]);
    await db.query("INSERT INTO charity_verification_evidence (charity_id, source_type, source_ref, status, checked_at, public_summary, data_source) VALUES ($1,'ADMIN_REVIEW','ref','SUPPORTS', now(), 'summary', 'database')", [id]);
    for (const w of wallets) await db.query("INSERT INTO charity_wallets (charity_id, chain, address, verification_status) VALUES ($1,'solana',$2,'verified')", [id, w]);
    await db.query("COMMIT");
  } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  return id;
}
async function makeLive(seed: string) {
  const address = fixtureAddress(`dp-wallet:${seed}`), reserve = fixtureAddress(`dp-reserve:${seed}`);
  const u = await ctx.pool.query("INSERT INTO users (display_name) VALUES ($1) RETURNING id", [`dp-${seed}`]);
  const w = await ctx.pool.query("INSERT INTO wallets (user_id, chain, address, label, data_source, ownership_verified_at) VALUES ($1,'solana',$2,'Live','database', now()) RETURNING id", [u.rows[0].id, address]);
  await ctx.pool.query("INSERT INTO wallets (user_id, chain, address, label, data_source, ownership_verified_at) VALUES ($1,'solana',$2,'Reserve','database', now())", [u.rows[0].id, reserve]);
  const { token } = await createSession(ctx.pool, { userId: u.rows[0].id as string, walletId: w.rows[0].id as string, authMethod: "wallet_signature", ttlHours: 1 });
  const charityWallet = fixtureAddress(`dp-charity:${seed}`);
  const charityId = await makeCharity(seed, [charityWallet]);
  return { userId: u.rows[0].id as string, token, address, reserve, charityId, charityWallet };
}
const call = (method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", url: string, token: string | null, payload?: unknown) =>
  ctx.app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }), headers: token ? bearer(token) : {} });
const body = (o: { creator: string; reserve?: string; charityId: string; name?: string }) => ({
  name: o.name ?? "Plan Token", symbol: "PLN", description: "A test configuration", totalSupply: "1000000000", decimals: 6, creatorAllocationPercent: "8", creatorWallet: o.creator, network: "devnet",
  liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 30 }, feeSplit: { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 },
  charityConfiguration: { charityId: o.charityId }, taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: o.reserve ?? o.creator },
});
async function draft(token = live.token, o: Partial<Parameters<typeof body>[0]> = {}) {
  const r = await call("POST", "/api/launches", token, body({ creator: live.address, reserve: live.reserve, charityId: live.charityId, ...o }));
  expect(r.statusCode, r.body).toBe(201);
  return Launch.parse(r.json());
}
async function ready(token = live.token, o: Partial<Parameters<typeof body>[0]> = {}) {
  const l = await draft(token, o);
  expect((await call("POST", `/api/launches/${l.id}/configure`, token)).statusCode).toBe(200);
  expect((await call("POST", `/api/launches/${l.id}/review`, token)).statusCode).toBe(200);
  const r = await call("POST", `/api/launches/${l.id}/ready`, token, { fingerprint: l.fingerprint, confirmed: true, publish: false });
  expect(r.statusCode, r.body).toBe(200);
  return Launch.parse(r.json());
}
const plan = async (id: string, token = live.token) => DeploymentPlanResponse.parse((await call("GET", `/api/launches/${id}/deployment-plan`, token)).json());
const planRows = async (id: string) => Number((await ctx.pool.query("SELECT count(*) FROM deployment_plans WHERE launch_id = $1", [id])).rows[0].count);

describe("read-only plan and review (owner)", () => {
  it("requires a session on every endpoint", async () => {
    const l = await ready();
    for (const [m, u] of [["GET", `/api/launches/${l.id}/deployment-plan`], ["GET", `/api/launches/${l.id}/deployment-review`], ["POST", `/api/launches/${l.id}/deployment-plan`]] as const) expect((await call(m, u, null)).statusCode, u).toBe(401);
  });
  it("a READY launch yields a deterministic BLOCKED plan: not executable, nothing invented, nothing written by a read", async () => {
    const l = await ready();
    const r = await call("GET", `/api/launches/${l.id}/deployment-plan`, live.token);
    expect(r.statusCode, r.body).toBe(200); expect(r.headers["cache-control"]).toBe("no-store");
    const d = DeploymentPlanResponse.parse(r.json());
    expect(d.plan).toMatchObject({ status: "BLOCKED", executionEnabled: false, labels: ["NOT DEPLOYED", "NOT SIGNED", "NO FUNDS MOVED"], mint: { address: null }, dataSource: "database" });
    expect(d.plan.identity).toMatchObject({ launchId: l.id, configFingerprint: l.fingerprint, reviewedFingerprint: l.fingerprint, network: "devnet" });
    expect(d.plan.destinations.find((x) => x.role === "CHARITY")).toMatchObject({ address: live.charityWallet, provenance: "CHARITY_REGISTRY" });
    expect(d.plan.destinations.find((x) => x.role === "TAX_RESERVE")!.address).toBe(live.reserve);
    expect(d.plan.blockers.map((b) => b.code)).toContain("ALLOCATION_MODEL_UNDEFINED");
    expect(d.recorded).toBe(false); expect(d.supersededPlans).toBe(0); expect(d.review.executionEnabled).toBe(false);
    expect(await planRows(l.id)).toBe(0);
    const again = await plan(l.id); expect(again.plan.identity.planHash).toBe(d.plan.identity.planHash);
    expect(r.body).not.toMatch(/"(privateKey|secretKey|seedPhrase|mnemonic)"\s*:|solscan|explorer/i); // prose may say "no private key is collected"; no such FIELD may exist
  });
  it("review comes from the same plan", async () => {
    const l = await ready();
    const rv = DeploymentReviewResponse.parse((await call("GET", `/api/launches/${l.id}/deployment-review`, live.token)).json());
    const d = await plan(l.id);
    expect(rv.review).toEqual(d.review); expect(rv.planId).toBe(d.plan.identity.planId); expect(rv.review.planHash).toBe(d.plan.identity.planHash);
  });
  it("a foreign launch equals an unknown launch (404) on every endpoint", async () => {
    const l = await ready();
    for (const [m, u] of [["GET", "deployment-plan"], ["GET", "deployment-review"], ["POST", "deployment-plan"]] as const) {
      const foreign = await call(m, `/api/launches/${l.id}/${u}`, other.token, m === "POST" ? {} : undefined);
      const unknown = await call(m, `/api/launches/${crypto.randomUUID()}/${u}`, other.token, m === "POST" ? {} : undefined);
      expect([foreign.statusCode, unknown.statusCode], u).toEqual([404, 404]);
      expect(ApiErrorBody.parse(foreign.json()).error.code).toBe("NOT_FOUND"); expect(foreign.body).not.toContain(l.id);
    }
    expect(await planRows(l.id)).toBe(0);
  });
  it("there is no public deployment plan", async () => {
    const l = await ready();
    expect((await call("GET", `/api/public/launches/${l.id}/deployment-plan`, null)).statusCode).toBe(404);
  });
});

describe("READY gate and validation, enforced by the server", () => {
  it("DRAFT, CONFIGURED, REVIEW and CANCELLED launches get 409 LAUNCH_NOT_READY and no plan", async () => {
    const d = await draft();
    const check = async (id: string) => { const r = await call("GET", `/api/launches/${id}/deployment-plan`, live.token); expect(r.statusCode).toBe(409); expect(ApiErrorBody.parse(r.json()).error.code).toBe("LAUNCH_NOT_READY"); expect((await call("POST", `/api/launches/${id}/deployment-plan`, live.token, {})).statusCode).toBe(409); };
    await check(d.id);
    await call("POST", `/api/launches/${d.id}/configure`, live.token); await check(d.id);
    await call("POST", `/api/launches/${d.id}/review`, live.token); await check(d.id);
    await call("POST", `/api/launches/${d.id}/cancel`, live.token, {}); await check(d.id);
    expect(await planRows(d.id)).toBe(0);
  });
  it("a READY launch whose wallets are not valid Solana addresses is refused (422 INVALID_ADDRESS)", async () => {
    const l = await ready(ctx.demoToken, { creator: DEMO_WALLETS[1]!.address, reserve: DEMO_WALLETS[1]!.address, charityId: DEMO_IDS.charities.c1 });
    const r = await call("GET", `/api/launches/${l.id}/deployment-plan`, ctx.demoToken);
    expect(r.statusCode).toBe(422); expect(ApiErrorBody.parse(r.json()).error.code).toBe("INVALID_ADDRESS");
  });
  it("editing returns the launch to DRAFT, so its plan is refused until it is reviewed again; the new plan has a new hash", async () => {
    const l = await ready();
    const first = await plan(l.id);
    expect((await call("POST", `/api/launches/${l.id}/deployment-plan`, live.token, {})).statusCode).toBe(201);
    const put = await call("PUT", `/api/launches/${l.id}`, live.token, body({ creator: live.address, reserve: live.reserve, charityId: live.charityId, name: "Renamed Token" }));
    expect(put.statusCode, put.body).toBe(200);
    expect((await call("GET", `/api/launches/${l.id}/deployment-plan`, live.token)).statusCode).toBe(409);
    await call("POST", `/api/launches/${l.id}/configure`, live.token); await call("POST", `/api/launches/${l.id}/review`, live.token);
    const cur = Launch.parse((await call("GET", `/api/launches/${l.id}`, live.token)).json());
    expect((await call("POST", `/api/launches/${l.id}/ready`, live.token, { fingerprint: cur.fingerprint, confirmed: true, publish: false })).statusCode).toBe(200);
    const second = await plan(l.id);
    expect(second.plan.identity.planHash).not.toBe(first.plan.identity.planHash); expect(second.plan.identity.configFingerprint).not.toBe(first.plan.identity.configFingerprint);
    expect(second).toMatchObject({ recorded: false, supersededPlans: 1 });
  });
  it("a charity with two verified wallets leaves the destination unresolved (blocker), never a guess", async () => {
    const id = await makeCharity("two", [fixtureAddress("two-a"), fixtureAddress("two-b")]); extraCharities.push(id);
    const l = await ready(live.token, { charityId: id });
    const d = await plan(l.id);
    expect(d.plan.blockers.map((b) => b.code)).toContain("CHARITY_DESTINATION_UNRESOLVED");
    expect(d.plan.destinations.find((x) => x.role === "CHARITY")).toMatchObject({ address: null, validation: "UNRESOLVED" });
  });
});

describe("recording a plan (append-only, idempotent)", () => {
  it("POST records once (201), repeats are 200 and do not duplicate; GET then says recorded", async () => {
    const l = await ready();
    const a = await call("POST", `/api/launches/${l.id}/deployment-plan`, live.token, {});
    expect(a.statusCode, a.body).toBe(201);
    const b = await call("POST", `/api/launches/${l.id}/deployment-plan`, live.token);
    expect(b.statusCode).toBe(200);
    expect(DeploymentPlanResponse.parse(a.json()).plan.identity.planHash).toBe(DeploymentPlanResponse.parse(b.json()).plan.identity.planHash);
    expect(await planRows(l.id)).toBe(1);
    expect(await plan(l.id)).toMatchObject({ recorded: true, supersededPlans: 0 });
    const row = (await ctx.pool.query("SELECT plan, status FROM deployment_plans WHERE launch_id = $1", [l.id])).rows[0];
    expect(row.status).toBe("BLOCKED"); expect(JSON.stringify(row.plan)).not.toMatch(/privateKey|secretKey|seedPhrase|mnemonic/i);
    expect(row.plan.mint.address).toBeNull();
  });
  it("the request carries no parameters: any body field is refused", async () => {
    const l = await ready();
    for (const extra of [{ status: "READY" }, { mintAddress: fixtureAddress("m") }, { network: "mainnet-beta" }, { decimals: 9 }, { destination: fixtureAddress("d") }, { execute: true }, { planHash: "a".repeat(64) }]) {
      expect((await call("POST", `/api/launches/${l.id}/deployment-plan`, live.token, extra)).statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect(await planRows(l.id)).toBe(0);
  });
  it("the database refuses to edit or delete a plan record, or to store an executable, minted, or foreign one", async () => {
    const l = await ready();
    await call("POST", `/api/launches/${l.id}/deployment-plan`, live.token, {});
    await expect(ctx.pool.query("UPDATE deployment_plans SET status = 'READY_FOR_REVIEW' WHERE launch_id = $1", [l.id])).rejects.toThrow();
    await expect(ctx.pool.query("DELETE FROM deployment_plans WHERE launch_id = $1", [l.id])).rejects.toThrow();
    const d = (await plan(l.id)).plan;
    const ins = (p: object, fp = d.identity.configFingerprint, user = live.userId, hash = d.identity.planHash.replace(/^./, "0")) =>
      ctx.pool.query("INSERT INTO deployment_plans (launch_id, plan_version, builder_version, config_fingerprint, plan_hash, status, plan, created_by) VALUES ($1,1,'x',$2,$3,'BLOCKED',$4,$5)", [l.id, fp, hash, JSON.stringify(p), user]);
    const h = d.identity.planHash.replace(/^./, "0");
    const withHash = { ...d, identity: { ...d.identity, planHash: h } };
    await expect(ins({ ...withHash, executionEnabled: true })).rejects.toThrow();
    await expect(ins({ ...withHash, mint: { ...d.mint, address: fixtureAddress("m") } })).rejects.toThrow();
    await expect(ins({ ...withHash, signingBoundary: { ...d.signingBoundary, serverSigns: true } })).rejects.toThrow();
    await expect(ins(withHash, "f".repeat(64))).rejects.toThrow(/current configuration fingerprint|check/);
    await expect(ins(withHash, d.identity.configFingerprint, other.userId)).rejects.toThrow(/owner/);
    await ins(withHash); // a well-formed one for the same launch is accepted by the database (it would be a different hash)
    const draftL = await draft();
    await expect(ctx.pool.query("INSERT INTO deployment_plans (launch_id, plan_version, builder_version, config_fingerprint, plan_hash, status, plan, created_by) VALUES ($1,1,'x',$2,$3,'BLOCKED',$4,$5)", [draftL.id, draftL.fingerprint, "e".repeat(64), JSON.stringify({ ...d, identity: { ...d.identity, planHash: "e".repeat(64), configFingerprint: draftL.fingerprint } }), live.userId])).rejects.toThrow(/READY/);
  });
});

describe("the signing boundary: no keys in, no signing, sending or deploying out", () => {
  it("refuses key material in any body or query, on any route, without echoing it", async () => {
    const l = await ready();
    const secret = "5Kb8kLf9zgWQnogidDA76MzPL6TsZZY36hWXMssSzNydYXYB9KF";
    for (const [m, u, p] of [
      ["POST", `/api/launches/${l.id}/deployment-plan`, { privateKey: secret }], ["POST", "/api/launches", { ...body({ creator: live.address, charityId: live.charityId }), mnemonic: secret }],
      ["POST", `/api/launches/${l.id}/cancel`, { seedPhrase: secret }], ["PUT", `/api/launches/${l.id}`, { nested: { secretKey: secret } }], ["POST", `/api/launches/${l.id}/ready`, { Private_Key: secret }],
    ] as const) {
      const r = await call(m, u, live.token, p);
      expect(r.statusCode, `${m} ${u}`).toBe(400); expect(ApiErrorBody.parse(r.json()).error.code).toBe("SECRET_MATERIAL_REJECTED"); expect(r.body).not.toContain(secret);
    }
    const q = await call("GET", `/api/launches/${l.id}/deployment-plan?seedPhrase=${secret}`, live.token);
    expect(q.statusCode).toBe(400); expect(q.body).not.toContain(secret);
    expect((await call("GET", `/api/launches/${l.id}/deployment-plan`, live.token)).statusCode).toBe(200);
  });
  it("has no sign, send, submit, deploy, execute, broadcast or confirm endpoint, and no other write method", async () => {
    const l = await ready();
    for (const seg of ["sign", "send", "submit", "deploy", "execute", "broadcast", "confirm", "transaction", "transactions", "mint", "liquidity", "payout"]) {
      for (const method of ["GET", "POST", "PUT"] as const) {
        const r = await call(method, `/api/launches/${l.id}/${seg}`, live.token, method === "GET" ? undefined : {});
        expect(r.statusCode, `${method} ${seg}`).toBe(404);
        const r2 = await call(method, `/api/launches/${l.id}/deployment-plan/${seg}`, live.token, method === "GET" ? undefined : {});
        expect(r2.statusCode, `${method} deployment-plan/${seg}`).toBe(404);
      }
    }
    for (const method of ["PUT", "PATCH", "DELETE"] as const) expect([404, 405]).toContain((await call(method, `/api/launches/${l.id}/deployment-plan`, live.token, {})).statusCode);
    expect((await call("GET", `/api/launches/${l.id}`, live.token)).json().deployment).toEqual({ status: "not_deployed", mintAddress: null, transactionSignature: null, contractAddress: null });
  });
  it("no route or repository source can sign, serialize or submit a transaction or touch a keypair", () => {
    const files = [...readdirSync(join(__dirname, "../src/routes")).map((f) => join(__dirname, "../src/routes", f)), join(__dirname, "../src/db/deploymentRepos.ts")];
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/sendTransaction|sendRawTransaction|simulateTransaction|signTransaction|signMessage\(|Keypair|secretKey|requestAirdrop|serialize\(/);
  });
  it("reading and recording a plan moves nothing: balances, transactions and donations are untouched", async () => {
    const count = async () => JSON.stringify((await Promise.all(["raw_transactions", "donations", "reserve_ledger_entries"].map((t) => ctx.pool.query(`SELECT count(*)::int AS n FROM ${t}`).then((r) => r.rows[0].n, () => -1)))));
    const before = await count();
    const l = await ready();
    await call("GET", `/api/launches/${l.id}/deployment-plan`, live.token); await call("POST", `/api/launches/${l.id}/deployment-plan`, live.token, {});
    expect(await count()).toBe(before);
  });
});
