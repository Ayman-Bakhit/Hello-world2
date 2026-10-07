import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { DEMO_IDS } from "@project-name/shared";
import { createSession, revokeSession } from "../src/auth/session";
import { makeCtx, bearer, W, type Ctx } from "./helpers";

let ctx: Ctx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.close(); });

const PROTECTED: Array<[string, string]> = [
  ["GET", "/api/wallets"], ["GET", `/api/wallets/${W.trading}`], ["GET", `/api/portfolio/${W.trading}`],
  ["GET", `/api/transactions/${W.trading}`], ["GET", `/api/tax/${W.trading}`], ["GET", `/api/tax-reserve/${W.trading}`],
  ["POST", `/api/tax-reserve/${W.trading}/target`], ["GET", `/api/donations/${W.trading}`], ["POST", "/api/donations/plan"], ["GET", "/api/donations/by-id/00000000-0000-4000-8000-000000000501"], ["GET", "/api/receipts/00000000-0000-4000-8000-000000000701"],
  ["GET", "/api/launches"], ["POST", "/api/launches"], ["GET", `/api/launches/${W.trading}`], ["POST", `/api/launches/${W.trading}/review`],
];
const PUBLIC: string[] = ["/health", "/api/auth/status", "/api/auth/session", "/api/charities", "/api/tokens", "/api/tokens/demo/proof", "/api/proof/demo", "/api/discover"];

describe("authentication boundary", () => {
  it.each(PROTECTED)("%s %s requires a session", async (method, url) => {
    const r = await ctx.app.inject({ method: method as "GET" | "POST", url, ...(method === "POST" ? { payload: {} } : {}) });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("UNAUTHENTICATED");
    expect(r.headers["www-authenticate"]).toBe("Bearer");
  });
  it.each(PUBLIC)("%s is public", async (url) => {
    expect((await ctx.app.inject({ url })).statusCode).toBe(200);
  });
  it("authenticated protected request succeeds", async () => {
    expect((await ctx.app.inject({ url: "/api/wallets", headers: bearer(ctx.demoToken) })).statusCode).toBe(200);
  });
  it("rejects garbage, wrong scheme, and unknown tokens", async () => {
    for (const authorization of ["Bearer nope", "Basic abc", `Bearer ${"a".repeat(43)}`, "Bearer", ""]) {
      const r = await ctx.app.inject({ url: "/api/wallets", headers: { authorization } });
      expect(r.statusCode, authorization).toBe(401);
    }
  });
  it("rejects expired and revoked sessions", async () => {
    const { token } = await createSession(ctx.pool, { userId: DEMO_IDS.user, walletId: null, authMethod: "dev_insecure", ttlHours: 1 });
    expect((await ctx.app.inject({ url: "/api/wallets", headers: bearer(token) })).statusCode).toBe(200);
    await ctx.pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id_hash = $1", [createHash("sha256").update(token).digest()]);
    expect((await ctx.app.inject({ url: "/api/wallets", headers: bearer(token) })).statusCode).toBe(401);

    const s2 = await createSession(ctx.pool, { userId: DEMO_IDS.user, walletId: null, authMethod: "dev_insecure", ttlHours: 1 });
    await revokeSession(ctx.pool, s2.token);
    expect((await ctx.app.inject({ url: "/api/wallets", headers: bearer(s2.token) })).statusCode).toBe(401);
  });
  it("stores only a hash of the session token", async () => {
    const { token } = await createSession(ctx.pool, { userId: DEMO_IDS.user, walletId: null, authMethod: "dev_insecure", ttlHours: 1 });
    const rows = await ctx.pool.query("SELECT id_hash FROM sessions");
    const hashes = rows.rows.map((r) => (r.id_hash as Buffer).toString("hex"));
    expect(hashes).toContain(createHash("sha256").update(token).digest("hex"));
    expect(hashes.some((h) => h.includes(Buffer.from(token).toString("hex")))).toBe(false);
  });
});

describe("auth status", () => {
  it("reports real wallet sign-in, still not production ready overall", async () => {
    const r = (await ctx.app.inject({ url: "/api/auth/status" })).json();
    expect(r.walletSignIn).toMatchObject({ implemented: true, chainId: "solana:devnet", domain: "localhost:3000", nonceTtlSeconds: 300 });
    expect(r.productionReady).toBe(false);
  });
});

describe("dev-insecure session endpoint (local development only)", () => {
  it("issues a session for the demo user only, flagged dev_insecure", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/auth/dev-session" });
    expect(r.statusCode).toBe(201);
    expect(r.json().warning).toMatch(/no wallet signature/);
    const w = await ctx.app.inject({ url: "/api/wallets", headers: bearer(r.json().token) });
    expect(w.json().wallets).toHaveLength(3);
    const s = await ctx.app.inject({ url: "/api/auth/session", headers: bearer(r.json().token) });
    expect(s.json().session.authMethod).toBe("dev_insecure");
  });
  it("does not exist in the default (wallet) mode", async () => {
    const off = await makeCtx({ AUTH_MODE: "wallet" });
    try {
      expect((await off.app.inject({ method: "POST", url: "/api/auth/dev-session" })).statusCode).toBe(404);
    } finally { await off.close(); }
  });
});
