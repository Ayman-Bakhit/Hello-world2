import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_VERSION, ApiErrorBody, HealthResponse } from "@project-name/shared";
import { loadConfig } from "../src/config";
import { makeCtx, bearer, type Ctx } from "./helpers";

let ctx: Ctx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.close(); });

describe("health", () => {
  it("GET /health and /api/health", async () => {
    for (const url of ["/health", "/api/health"]) {
      const r = await ctx.app.inject({ url });
      expect(r.statusCode).toBe(200);
      expect(HealthResponse.parse(r.json())).toEqual({ status: "ok", service: "api", version: API_VERSION });
    }
  });
  it("is public and leaks no config", async () => {
    const r = await ctx.app.inject({ url: "/health" });
    expect(Object.keys(r.json()).sort()).toEqual(["service", "status", "version"]);
  });
});

describe("structured errors", () => {
  it("unknown route -> NOT_FOUND body", async () => {
    const r = await ctx.app.inject({ url: "/api/nope" });
    expect(r.statusCode).toBe(404);
    expect(ApiErrorBody.parse(r.json()).error.code).toBe("NOT_FOUND");
  });
  it("malformed JSON -> 400 BAD_REQUEST, not a stack trace", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/donations/plan", headers: { ...bearer(ctx.demoToken), "content-type": "application/json" }, payload: "{not json" });
    expect(r.statusCode).toBe(400);
    expect(ApiErrorBody.parse(r.json()).error.code).toBe("BAD_REQUEST");
    expect(r.body).not.toContain("at ");
  });
  it("oversized body is rejected", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/donations/plan", headers: { ...bearer(ctx.demoToken), "content-type": "application/json" }, payload: JSON.stringify({ pad: "x".repeat(70_000) }) });
    expect(r.statusCode).toBe(413);
    expect(ApiErrorBody.safeParse(r.json()).success).toBe(true);
  });
  it("validation errors list fields", async () => {
    const r = await ctx.app.inject({ url: "/api/discover?sort=pump&minHolders=abc" });
    expect(r.statusCode).toBe(400);
    const body = ApiErrorBody.parse(r.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(body.error.fields ?? {})).toEqual(expect.arrayContaining(["sort", "minHolders"]));
  });
});

describe("http hardening", () => {
  it("sets security headers", async () => {
    const r = await ctx.app.inject({ url: "/health" });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });
  it("CORS allows only configured origins", async () => {
    const ok = await ctx.app.inject({ url: "/health", headers: { origin: "http://localhost:3000" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const bad = await ctx.app.inject({ url: "/health", headers: { origin: "https://evil.example" } });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    const pre = await ctx.app.inject({ method: "OPTIONS", url: "/api/donations/plan", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("rate limits with a structured 429", async () => {
    const limited = await makeCtx({ RATE_LIMIT_MAX: "3" });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await limited.app.inject({ url: "/health" })).statusCode);
      expect(codes).toEqual([200, 200, 200, 429, 429]);
      const r = await limited.app.inject({ url: "/health" });
      expect(ApiErrorBody.parse(r.json()).error.code).toBe("RATE_LIMITED");
    } finally { await limited.close(); }
  });
  it("write routes have a stricter limit", async () => {
    const limited = await makeCtx({ RATE_LIMIT_WRITE_MAX: "2" });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await limited.app.inject({ method: "POST", url: "/api/auth/nonce", payload: {} })).statusCode);
      expect(codes).toEqual([400, 400, 429, 429]);
    } finally { await limited.close(); }
  });
  it("never logs the Authorization header", async () => {
    const lines: string[] = [];
    const c = await makeCtx({ LOG_LEVEL: "info" }, { write: (m) => void lines.push(m) });
    try {
      const secret = "SECRETTOKEN".padEnd(43, "x");
      await c.app.inject({ url: "/api/wallets", headers: { authorization: `Bearer ${secret}`, cookie: "sid=abc123secret" } });
      const all = lines.join("\n");
      expect(all.length).toBeGreaterThan(0);
      expect(all).not.toContain(secret);
      expect(all).not.toContain("abc123secret");
    } finally { await c.close(); }
  });
});

describe("config", () => {
  const base = { DATABASE_URL: "postgresql://x/y" };
  it("requires DATABASE_URL", () => expect(() => loadConfig({})).toThrow(/DATABASE_URL/));
  it("rejects wildcard / malformed CORS origins", () => {
    expect(() => loadConfig({ ...base, CORS_ORIGINS: "*" })).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig({ ...base, CORS_ORIGINS: "http://a.example/path" })).toThrow();
    expect(() => loadConfig({ ...base, CORS_ORIGINS: "https://a.example,https://b.example" })).not.toThrow();
  });
  it("refuses dev-insecure auth in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production", AUTH_MODE: "dev-insecure", CORS_ORIGINS: "https://a.example" })).toThrow(/not allowed/);
    expect(loadConfig({ ...base, NODE_ENV: "production", CORS_ORIGINS: "https://a.example" }).AUTH_MODE).toBe("wallet");
  });
  it("treats an empty AUTH_ORIGIN as unset", () => expect(loadConfig({ ...base, AUTH_ORIGIN: "" }).authOrigin).toBe("http://localhost:3000"));
  it("defaults to wallet-only auth", () => expect(loadConfig(base).AUTH_MODE).toBe("wallet"));
  it("production requires https origins and the AUTH_ORIGIN must be an allowed origin", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/https/);
    expect(() => loadConfig({ ...base, CORS_ORIGINS: "http://a.example", AUTH_ORIGIN: "http://b.example" })).toThrow(/AUTH_ORIGIN/);
    const c = loadConfig({ ...base, NODE_ENV: "production", CORS_ORIGINS: "https://app.example.com,https://admin.example.com", AUTH_ORIGIN: "https://admin.example.com" });
    expect(c).toMatchObject({ authDomain: "admin.example.com", cookieSecure: true, cookieName: "__Host-pn_session", chainId: "solana:devnet" });
  });
  it("dev cookies are not Secure by default (http localhost) but can be made so", () => {
    expect(loadConfig(base)).toMatchObject({ cookieSecure: false, cookieName: "pn_session" });
    expect(loadConfig({ ...base, COOKIE_SECURE: "true" })).toMatchObject({ cookieSecure: true, cookieName: "__Host-pn_session" });
  });
  it("binds to localhost by default", () => expect(loadConfig(base).HOST).toBe("127.0.0.1"));
});
