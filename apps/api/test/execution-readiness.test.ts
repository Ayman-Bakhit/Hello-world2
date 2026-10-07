import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApiErrorBody, DEPLOYMENT_POLICY, DeploymentAttemptList, DeploymentDecisionSummary, DeploymentPlanResponse, ExecutionDisabledError, ExecutionReadinessResponse, Launch, PublicLaunch, buildDeploymentPlan, fakeMint,
  base58Encode, fixtureAddress, type GateId,
} from "@project-name/shared";
import { createSession } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { appendAttemptEvent, createAttempt, listAttempts } from "../src/db/attemptRepos";
import { charityForPlan } from "../src/routes/deploymentPlan";
import { getLaunch } from "../src/db/launchRepos";
import { bearer, makeCtx, makeOtherUser, testConfig, type Ctx } from "./helpers";

let ctx: Ctx;
let other: Awaited<ReturnType<typeof makeOtherUser>>;
let live: { userId: string; token: string; address: string; reserve: string; charityId: string; charityWallet: string };
beforeAll(async () => { ctx = await makeCtx({ MAX_LAUNCHES_PER_USER: "5000" }); other = await makeOtherUser(ctx.pool); live = await makeLive("er"); });
afterAll(async () => {
  await ctx.pool.query("ALTER TABLE charity_verification_evidence DISABLE TRIGGER charity_evidence_immutable");
  try {
    await ctx.pool.query("DELETE FROM charity_verification_evidence WHERE charity_id = $1", [live.charityId]);
    await ctx.pool.query("DELETE FROM charity_wallets WHERE charity_id = $1", [live.charityId]);
    await ctx.pool.query("DELETE FROM charities WHERE id = $1", [live.charityId]);
  } finally { await ctx.pool.query("ALTER TABLE charity_verification_evidence ENABLE TRIGGER charity_evidence_immutable"); }
  await ctx.close();
});

async function makeLive(seed: string) {
  const address = fixtureAddress(`er-wallet:${seed}`), reserve = fixtureAddress(`er-reserve:${seed}`), charityWallet = fixtureAddress(`er-charity:${seed}`);
  const u = await ctx.pool.query("INSERT INTO users (display_name) VALUES ($1) RETURNING id", [`er-${seed}`]);
  const w = await ctx.pool.query("INSERT INTO wallets (user_id, chain, address, label, data_source, ownership_verified_at) VALUES ($1,'solana',$2,'Live','database', now()) RETURNING id", [u.rows[0].id, address]);
  await ctx.pool.query("INSERT INTO wallets (user_id, chain, address, label, data_source, ownership_verified_at) VALUES ($1,'solana',$2,'Reserve','database', now())", [u.rows[0].id, reserve]);
  const { token } = await createSession(ctx.pool, { userId: u.rows[0].id as string, walletId: w.rows[0].id as string, authMethod: "wallet_signature", ttlHours: 1 });
  const charityId = crypto.randomUUID();
  const db = await ctx.pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("INSERT INTO charities (id, slug, name, verification_state, verification_source, verification_checked_at, data_source) VALUES ($1,$2,'Readiness Charity','VERIFIED','ADMIN_REVIEW', now(), 'database')", [charityId, `readiness-charity-${seed}`]);
    await db.query("INSERT INTO charity_verification_evidence (charity_id, source_type, source_ref, status, checked_at, public_summary, data_source) VALUES ($1,'ADMIN_REVIEW','ref','SUPPORTS', now(), 'summary', 'database')", [charityId]);
    await db.query("INSERT INTO charity_wallets (charity_id, chain, address, verification_status) VALUES ($1,'solana',$2,'verified')", [charityId, charityWallet]);
    await db.query("COMMIT");
  } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  return { userId: u.rows[0].id as string, token, address, reserve, charityId, charityWallet };
}
const call = (method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", url: string, token: string | null, payload?: unknown) =>
  ctx.app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }), headers: token ? bearer(token) : {} });
const body = (name = "Readiness Token") => ({
  name, symbol: "RDY", description: "A test configuration", totalSupply: "1000000000", decimals: 6, creatorAllocationPercent: "8", creatorWallet: live.address, network: "devnet",
  liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 30 }, feeSplit: { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 },
  charityConfiguration: { charityId: live.charityId }, taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: live.reserve },
});
const draft = async (name?: string) => { const r = await call("POST", "/api/launches", live.token, body(name)); expect(r.statusCode, r.body).toBe(201); return Launch.parse(r.json()); };
async function ready(name?: string) {
  const l = await draft(name);
  expect((await call("POST", `/api/launches/${l.id}/configure`, live.token)).statusCode).toBe(200);
  expect((await call("POST", `/api/launches/${l.id}/review`, live.token)).statusCode).toBe(200);
  const r = await call("POST", `/api/launches/${l.id}/ready`, live.token, { fingerprint: l.fingerprint, confirmed: true, publish: true });
  expect(r.statusCode, r.body).toBe(200);
  return Launch.parse(r.json());
}
const readiness = async (id: string, token = live.token) => ExecutionReadinessResponse.parse((await call("GET", `/api/launches/${id}/execution-readiness`, token)).json());
const gate = (r: ExecutionReadinessResponse, id: GateId) => r.readiness.gates.find((g) => g.id === id)!;
const planOf = async (l: Launch) => { const launch = (await getLaunch(ctx.pool, live.userId, l.id))!; const r = buildDeploymentPlan({ launch, charity: await charityForPlan(ctx.pool, launch) }); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.plan; };

describe("execution readiness (owner only, server derived)", () => {
  it("requires a session; foreign equals unknown (404) on all three endpoints; nothing is public", async () => {
    const l = await ready();
    for (const seg of ["execution-readiness", "deployment-decision-summary", "deployment-attempts"]) {
      expect((await call("GET", `/api/launches/${l.id}/${seg}`, null)).statusCode, seg).toBe(401);
      const foreign = await call("GET", `/api/launches/${l.id}/${seg}`, other.token), unknown = await call("GET", `/api/launches/${crypto.randomUUID()}/${seg}`, other.token);
      expect([foreign.statusCode, unknown.statusCode], seg).toEqual([404, 404]); expect(ApiErrorBody.parse(foreign.json()).error.code).toBe("NOT_FOUND"); expect(foreign.body).not.toContain(l.id);
      expect((await call("GET", `/api/public/launches/${l.id}/${seg}`, null)).statusCode, `public ${seg}`).toBe(404);
    }
    expect((await call("GET", "/api/launches/not-a-uuid/execution-readiness", live.token)).statusCode).toBe(400);
  });
  it("a READY launch is BLOCKED today: execution is never permitted, and the response is no-store", async () => {
    const l = await ready();
    const r = await call("GET", `/api/launches/${l.id}/execution-readiness`, live.token);
    expect(r.statusCode, r.body).toBe(200); expect(r.headers["cache-control"]).toBe("no-store");
    const d = ExecutionReadinessResponse.parse(r.json());
    expect(d.readiness).toMatchObject({ overall: "BLOCKED", prerequisitesMet: false, executionPermitted: false });
    expect(d.execution).toEqual({ enabled: false, label: "DISABLED", notices: ["NO TRANSACTIONS SENT", "NO FUNDS MOVED", "NO PRIVATE KEYS STORED"] });
    for (const id of ["LAUNCH_READY", "FINGERPRINT_CURRENT", "PLAN_BUILDABLE", "TOKEN_PROGRAM_SELECTED", "CHARITY_DESTINATIONS_VERIFIED", "TAX_RESERVE_DESTINATION_VALID", "FEE_SPLIT_VALID", "MINT_STRATEGY_DEFINED", "FEE_POLICY_DEFINED", "CLUSTER_VALID"] as const) expect(gate(d, id).status, id).toBe("PASS");
    for (const id of ["SUPPLY_ALLOCATION_DEFINED", "PROTOCOL_DESTINATION_VALID", "LIQUIDITY_STRATEGY_DEFINED", "FEE_ROUTING_ENFORCEABLE", "METADATA_STRATEGY_DEFINED", "LEGAL_REVIEW_COMPLETE", "SECURITY_REVIEW_COMPLETE", "REAL_EXECUTION_ENABLED"] as const) expect(gate(d, id).blocking, id).toBe(true);
    expect(gate(d, "FEE_ROUTING_ENFORCEABLE").reason).toContain("FEE_ROUTING_ENFORCEMENT_NOT_IMPLEMENTED");
  });
  it("recording the current plan passes the recorded-plan gate; editing the launch makes it stale and not READY", async () => {
    const l = await ready();
    expect(gate(await readiness(l.id), "PLAN_RECORDED_CURRENT").status).toBe("PENDING");
    expect((await call("POST", `/api/launches/${l.id}/deployment-plan`, live.token, {})).statusCode).toBe(201);
    const after = await readiness(l.id);
    expect(gate(after, "PLAN_RECORDED_CURRENT").status).toBe("PASS");
    const planHash = DeploymentPlanResponse.parse((await call("GET", `/api/launches/${l.id}/deployment-plan`, live.token)).json()).plan.identity.planHash;
    expect(after.readiness.planHash).toBe(planHash);
    expect((await call("PUT", `/api/launches/${l.id}`, live.token, body("Edited Name"))).statusCode).toBe(200);
    const stale = await readiness(l.id);
    expect(gate(stale, "LAUNCH_READY").status).toBe("BLOCKED"); expect(gate(stale, "PLAN_BUILDABLE").status).toBe("BLOCKED"); expect(stale.readiness.planHash).toBeNull();
  });
  it("a draft is not an error: readiness reports LAUNCH_READY blocked (200), never a 409", async () => {
    const l = await draft();
    const r = await call("GET", `/api/launches/${l.id}/execution-readiness`, live.token);
    expect(r.statusCode).toBe(200); const d = ExecutionReadinessResponse.parse(r.json());
    expect(gate(d, "LAUNCH_READY").status).toBe("BLOCKED"); expect(d.readiness.executionPermitted).toBe(false);
  });
  it("a changed charity wallet makes the recorded plan stale", async () => {
    const l = await ready();
    await call("POST", `/api/launches/${l.id}/deployment-plan`, live.token, {});
    expect(gate(await readiness(l.id), "PLAN_RECORDED_CURRENT").status).toBe("PASS");
    const n = fixtureAddress("er-charity-new");
    await ctx.pool.query("UPDATE charity_wallets SET address = $1 WHERE charity_id = $2", [n, live.charityId]);
    try {
      const d = await readiness(l.id);
      expect(gate(d, "PLAN_RECORDED_CURRENT")).toMatchObject({ status: "BLOCKED" }); expect(gate(d, "PLAN_RECORDED_CURRENT").reason).toMatch(/stale/);
    } finally { await ctx.pool.query("UPDATE charity_wallets SET address = $1 WHERE charity_id = $2", [live.charityWallet, live.charityId]); }
  });
  it("an unverified charity blocks readiness", async () => {
    const l = await ready();
    await ctx.pool.query("UPDATE charity_wallets SET verification_status = 'pending' WHERE charity_id = $1", [live.charityId]);
    try { expect(gate(await readiness(l.id), "CHARITY_DESTINATIONS_VERIFIED").status).toBe("BLOCKED"); }
    finally { await ctx.pool.query("UPDATE charity_wallets SET verification_status = 'verified' WHERE charity_id = $1", [live.charityId]); }
  });
  it("no client flag changes anything: query flags are ignored and body flags are refused", async () => {
    const l = await ready();
    const a = await call("GET", `/api/launches/${l.id}/execution-readiness`, live.token);
    const b = await call("GET", `/api/launches/${l.id}/execution-readiness?ready=true&approved=true&executionEnabled=true&overall=EXECUTION_DISABLED`, live.token);
    expect(b.statusCode).toBe(200); expect(b.json()).toEqual(a.json());
    for (const flags of [{ ready: true }, { approved: true }, { executionEnabled: true }, { status: "VERIFIED" }, { mintPublicKey: fakeMint("m") }, { signature: "x".repeat(88) }, { confirmation: "CONFIRMED" }, { reviewed: true }]) {
      expect((await call("POST", `/api/launches/${l.id}/deployment-plan`, live.token, flags)).statusCode, JSON.stringify(flags)).toBe(400);
      expect([404, 405], JSON.stringify(flags)).toContain((await call("POST", `/api/launches/${l.id}/execution-readiness`, live.token, flags)).statusCode);
    }
  });
});

describe("decision summary", () => {
  it("lists every decision with its status, what is missing and which block this launch", async () => {
    const l = await ready();
    const r = await call("GET", `/api/launches/${l.id}/deployment-decision-summary`, live.token);
    expect(r.statusCode).toBe(200); expect(r.headers["cache-control"]).toBe("no-store");
    const d = DeploymentDecisionSummary.parse(r.json());
    expect(d.counts).toEqual({ decided: 8, pending: 9 }); expect(d.execution.enabled).toBe(false); expect(d.policyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.decisions.find((x) => x.id === "PROTOCOL_DESTINATION")).toMatchObject({ status: "PENDING", value: null });
    expect(d.decisions.find((x) => x.id === "TOKEN_PROGRAM")).toMatchObject({ status: "DECIDED", value: { name: "SPL_TOKEN" } });
    expect(d.blockingForThisLaunch).toEqual(expect.arrayContaining(["SUPPLY_ALLOCATION_MODEL", "PROTOCOL_DESTINATION", "LEGAL_REVIEW"]));
  });
});

describe("what the public can never see", () => {
  it("public launch, proof and listing carry no readiness, policy, decision, destination or review internals", async () => {
    const l = await ready();
    const texts = [(await call("GET", `/api/public/launches/${l.id}`, null)).body, (await call("GET", `/api/public/launches/${l.id}/proof`, null)).body, (await call("GET", "/api/public/launches", null)).body].join(" ");
    expect(PublicLaunch.safeParse(JSON.parse((await call("GET", `/api/public/launches/${l.id}`, null)).body)).success).toBe(true);
    for (const s of ["policyHash", "readiness", "PROTOCOL_DESTINATION", "SECURITY_REVIEW", "LEGAL_REVIEW", "planHash", "deployment-plan", "destinationAddress", live.reserve, live.userId, "executionPermitted"]) expect(texts, s).not.toContain(s);
  });
});

describe("the execution gate: nothing can sign, send or confirm", () => {
  it("has no execute, sign, send, submit, broadcast, confirm, approve, start or ready endpoint under launches", async () => {
    const l = await ready();
    for (const seg of ["execute", "execution", "sign", "send", "submit", "broadcast", "confirm", "approve", "start", "ready-to-sign", "attempt", "mint-key", "mint-public-key", "signature", "confirmation"]) {
      for (const m of ["GET", "POST", "PUT"] as const) expect((await call(m, `/api/launches/${l.id}/${seg}`, live.token, m === "GET" ? undefined : {})).statusCode, `${m} ${seg}`).toBe(404);
    }
    for (const m of ["POST", "PUT", "PATCH", "DELETE"] as const) expect([404, 405], `${m} deployment-attempts`).toContain((await call(m, `/api/launches/${l.id}/deployment-attempts`, live.token, {})).statusCode);
  });
  it("refuses key material on the new routes too, without echoing it", async () => {
    const l = await ready(); const secret = base58Encode(new Uint8Array(64).fill(5));
    for (const q of ["privateKey", "secretKey", "seedPhrase", "mnemonic"]) {
      const r = await call("GET", `/api/launches/${l.id}/execution-readiness?${q}=${secret}`, live.token);
      expect(r.statusCode, q).toBe(400); expect(r.body).not.toContain(secret);
    }
  });
  it("the API refuses to start with real execution enabled; false and unset are fine", () => {
    expect(() => testConfig({ REAL_EXECUTION_ENABLED: "true" })).toThrow(/REAL_EXECUTION_ENABLED/);
    expect(() => testConfig({ REAL_EXECUTION_ENABLED: "1" })).toThrow(); expect(() => testConfig({ REAL_EXECUTION_ENABLED: "TRUE" })).toThrow();
    expect(testConfig({ REAL_EXECUTION_ENABLED: "false" }).REAL_EXECUTION_ENABLED).toBe("false"); expect(testConfig().REAL_EXECUTION_ENABLED).toBe("false");
    expect(() => loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://x", REAL_EXECUTION_ENABLED: "yes" })).toThrow();
  });
  it("no route source can sign, send, serialize or approve, and no route imports the attempt writers or the execution assertion", () => {
    const dir = join(__dirname, "../src/routes");
    for (const f of readdirSync(dir)) {
      const t = readFileSync(join(dir, f), "utf8");
      expect(t, f).not.toMatch(/createAttempt|appendAttemptEvent|assertExecutionDisabled|sendTransaction|sendRawTransaction|signTransaction|Keypair|secretKey|requestAirdrop|REAL_EXECUTION_ENABLED\s*=/);
    }
  });
});

describe("logging", () => {
  it("never writes a query string (and so never a pasted secret) to the request log", async () => {
    const lines: string[] = [];
    const lc = await makeCtx({ LOG_LEVEL: "info" }, { write: (m: string) => { lines.push(m); } });
    try {
      const secret = "5Kb8kLf9zgWQnogidDA76MzPL6TsZZY36hWXMssSzNydYXYB9KF";
      const r = await lc.app.inject({ method: "GET", url: `/api/launches/${crypto.randomUUID()}/execution-readiness?privateKey=${secret}&seedPhrase=a+b+c`, headers: bearer(lc.demoToken) });
      expect(r.statusCode).toBe(400);
      const all = lines.join("\n");
      expect(all).toContain("/execution-readiness"); expect(all).not.toContain(secret); expect(all).not.toMatch(/privateKey|seedPhrase|\?/);
    } finally { await lc.close(); }
  });
});

describe("deployment attempts (foundation; privileged writers, tests only)", () => {
  it("a READY launch can have no attempt; the list is empty and says so", async () => {
    const l = await ready();
    const r = await call("GET", `/api/launches/${l.id}/deployment-attempts`, live.token);
    expect(r.statusCode).toBe(200); const d = DeploymentAttemptList.parse(r.json());
    expect(d.attempts).toEqual([]); expect(d.execution.enabled).toBe(false); expect(d.note).toMatch(/no deployment attempt/);
  });
  it("an attempt records the launch, fingerprint, plan hash, policy hash, environment and expected state, and never rewrites the launch", async () => {
    const l = await ready(); const plan = await planOf(l);
    const id = await createAttempt(ctx.pool, { launchId: l.id, userId: live.userId, plan, mintPublicKey: fixtureAddress("attempt-mint") });
    const row = (await ctx.pool.query("SELECT * FROM deployment_attempts WHERE id = $1", [id])).rows[0];
    expect(row).toMatchObject({ launch_id: l.id, attempt_number: 1, config_fingerprint: l.fingerprint, plan_hash: plan.identity.planHash, policy_hash: plan.identity.policyHash, environment: "devnet", mint_public_key: fixtureAddress("attempt-mint") });
    expect(row.expected_state).toMatchObject({ provenance: "EXPECTED_NOT_OBSERVED", cluster: "devnet" });
    const d = DeploymentAttemptList.parse((await call("GET", `/api/launches/${l.id}/deployment-attempts`, live.token)).json());
    expect(d.attempts).toHaveLength(1); expect(d.attempts[0]).toMatchObject({ status: "PLAN_BUILT", attemptNumber: 1, historyIntact: true, events: 1 });
    expect(Launch.parse((await call("GET", `/api/launches/${l.id}`, live.token)).json()).status).toBe("READY");
    await appendAttemptEvent(ctx.pool, id, "FAILED", { failureCategory: "READINESS_BLOCKED", note: "blocked by readiness" });
    expect(Launch.parse((await call("GET", `/api/launches/${l.id}`, live.token)).json()).status).toBe("READY"); // a failed attempt does not rewrite the launch
    const a2 = await createAttempt(ctx.pool, { launchId: l.id, userId: live.userId, plan });
    expect((await listAttempts(ctx.pool, l.id)).map((x) => [x.attemptNumber, x.status])).toEqual([[1, "FAILED"], [2, "PLAN_BUILT"]]); void a2;
    expect((await call("GET", `/api/launches/${l.id}/deployment-attempts`, other.token)).statusCode).toBe(404);
  });
  it("refuses to record any state that implies a signature, send or confirmation, in the repository and in the database", async () => {
    const l = await ready(); const id = await createAttempt(ctx.pool, { launchId: l.id, userId: live.userId, plan: await planOf(l) });
    for (const s of ["AWAITING_SIGNATURE", "SIGNED", "SUBMITTED", "CONFIRMING", "CONFIRMED", "RECONCILING", "VERIFIED"] as const) {
      await expect(appendAttemptEvent(ctx.pool, id, s), s).rejects.toBeInstanceOf(ExecutionDisabledError);
      await expect(ctx.pool.query("INSERT INTO deployment_attempt_events (attempt_id, seq, status, prev_hash, row_hash) VALUES ($1, 2, $2, $3, $3)", [id, s, "a".repeat(64)]), `db ${s}`).rejects.toThrow();
    }
    await expect(ctx.pool.query("INSERT INTO deployment_attempt_events (attempt_id, seq, status, signatures, prev_hash, row_hash) VALUES ($1, 2, 'FAILED', ARRAY['x'], $2, $2)", [id, "a".repeat(64)])).rejects.toThrow();
    expect((await listAttempts(ctx.pool, l.id))[0]!.events).toBe(1);
  });
  it("only one terminal event can follow, FAILED needs a category, and rows are append-only", async () => {
    const l = await ready(); const id = await createAttempt(ctx.pool, { launchId: l.id, userId: live.userId, plan: await planOf(l) });
    await expect(ctx.pool.query("INSERT INTO deployment_attempt_events (attempt_id, seq, status, prev_hash, row_hash) VALUES ($1, 2, 'FAILED', $2, $2)", [id, "b".repeat(64)])).rejects.toThrow();
    await appendAttemptEvent(ctx.pool, id, "CANCELLED");
    await expect(appendAttemptEvent(ctx.pool, id, "FAILED", { failureCategory: "BUILD_ERROR" })).rejects.toThrow(/transition/);
    await expect(ctx.pool.query("UPDATE deployment_attempt_events SET status = 'FAILED' WHERE attempt_id = $1", [id])).rejects.toThrow();
    await expect(ctx.pool.query("DELETE FROM deployment_attempt_events WHERE attempt_id = $1", [id])).rejects.toThrow();
    await expect(ctx.pool.query("UPDATE deployment_attempts SET plan_hash = $1 WHERE id = $2", ["c".repeat(64), id])).rejects.toThrow();
    expect((await listAttempts(ctx.pool, l.id))[0]).toMatchObject({ status: "CANCELLED", failureCategory: "CANCELLED_BY_USER" });
  });
  it("tampering with a stored event is detected by the hash chain", async () => {
    const l = await ready(); const id = await createAttempt(ctx.pool, { launchId: l.id, userId: live.userId, plan: await planOf(l) });
    await ctx.pool.query("ALTER TABLE deployment_attempt_events DISABLE TRIGGER deployment_attempt_events_immutable");
    try { await ctx.pool.query("UPDATE deployment_attempt_events SET note = 'edited' WHERE attempt_id = $1", [id]); }
    finally { await ctx.pool.query("ALTER TABLE deployment_attempt_events ENABLE TRIGGER deployment_attempt_events_immutable"); }
    expect((await listAttempts(ctx.pool, l.id))[0]!.historyIntact).toBe(false);
  });
  it("an attempt needs a READY launch, its current fingerprint, its owner and the launch's network", async () => {
    const l = await ready(); const plan = await planOf(l);
    const d = await draft("Never Ready");
    await expect(createAttempt(ctx.pool, { launchId: d.id, userId: live.userId, plan })).rejects.toThrow();
    await expect(createAttempt(ctx.pool, { launchId: l.id, userId: other.userId, plan })).rejects.toThrow(/owner/);
    const stale = { ...plan, identity: { ...plan.identity, configFingerprint: "f".repeat(64) }, expectedState: { ...plan.expectedState, configFingerprint: "f".repeat(64) } };
    await expect(createAttempt(ctx.pool, { launchId: l.id, userId: live.userId, plan: stale })).rejects.toThrow(/fingerprint/);
    const wrongEnv = { ...plan, environment: { ...plan.environment, cluster: "mainnet-beta" as const }, expectedState: { ...plan.expectedState, cluster: "mainnet-beta" as const } };
    await expect(createAttempt(ctx.pool, { launchId: l.id, userId: live.userId, plan: wrongEnv })).rejects.toThrow(/network|environment/);
  });
  it("the mint field accepts a public key only: secret-key-shaped, malformed, program and destination values are refused and never echoed or stored", async () => {
    const l = await ready(); const plan = await planOf(l);
    const secret = base58Encode(new Uint8Array(64).fill(8));
    for (const bad of [secret, "not base58", 5, plan.identity.creatorWallet, plan.environment.programs.tokenProgram]) {
      let msg = ""; try { await createAttempt(ctx.pool, { launchId: l.id, userId: live.userId, plan, mintPublicKey: bad }); } catch (e) { msg = String((e as Error).message); }
      expect(msg, String(bad)).toMatch(/mint public key refused/); expect(msg).not.toContain(secret);
    }
    await expect(ctx.pool.query("INSERT INTO deployment_attempts (launch_id, attempt_number, config_fingerprint, plan_hash, policy_hash, environment, mint_public_key, expected_state, created_by) VALUES ($1, 99, $2, $3, $3, 'devnet', $4, $5, $6)",
      [l.id, plan.identity.configFingerprint, plan.identity.planHash, secret, JSON.stringify(plan.expectedState), live.userId])).rejects.toThrow();
    expect(await listAttempts(ctx.pool, l.id)).toEqual([]);
  });
  it("there is no column that could hold a private key, seed phrase or signature outside the always-empty array", async () => {
    const cols = (await ctx.pool.query("SELECT column_name FROM information_schema.columns WHERE table_name IN ('deployment_attempts','deployment_attempt_events','deployment_plans')")).rows.map((r) => r.column_name as string);
    expect(cols.filter((c) => /private|secret|seed|mnemonic|keypair/i.test(c))).toEqual([]);
    expect(DEPLOYMENT_POLICY.decisions.length).toBe(17);
  });
});
