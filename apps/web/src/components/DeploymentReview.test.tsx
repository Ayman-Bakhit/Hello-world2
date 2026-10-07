import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  BANNED_PHRASES, DEMO_IDS, DEMO_WALLETS, DeploymentPlanResponse, FIXTURE_WALLETS, buildDemoDeploymentPlan, buildDeploymentReview, deploymentFixtureInput, buildDeploymentPlan, fixtureReadyLaunch, fixtureLaunchConfig,
} from "@project-name/shared";
import { createApiClient } from "@/lib/api/client";
import { toLaunchRequest } from "@/lib/launch";
import { DEFAULT_LAUNCH_CONFIG } from "@/mock";
import { DeploymentReviewView } from "./DeploymentReviewView";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const plan = buildDemoDeploymentPlan();
const data = () => DeploymentPlanResponse.parse({ plan, review: buildDeploymentReview(plan), recorded: false, supersededPlans: 0 });
const out = () => html(<DeploymentReviewView data={data()} />);

describe("deployment review view", () => {
  it("says PLAN BLOCKED, NOT DEPLOYED, NOT SIGNED, NO FUNDS MOVED and never READY FOR USER REVIEW while blockers exist", () => {
    const t = text(out());
    for (const x of ["PLAN BLOCKED", "NOT DEPLOYED", "NOT SIGNED", "NO FUNDS MOVED", "DEMO · FIXTURE"]) expect(t).toContain(x);
    expect(t).not.toContain("READY FOR USER REVIEW");
  });
  it("shows all nine review sections, the blockers, and who receives what", () => {
    const t = text(out());
    for (const h of ["1 · TOKEN", "2 · AUTHORITIES", "3 · METADATA", "4 · ALLOCATIONS", "5 · DESTINATIONS", "6 · FUTURE LIQUIDITY", "7 · FUTURE FEE ROUTING", "8 · EXPECTED POST-DEPLOYMENT STATE", "9 · WHAT THE WALLET WILL NEED TO SIGN", "WHO RECEIVES WHAT", "WHAT DOES NOT HAPPEN", "DECISIONS REQUIRED"]) expect(t).toContain(h);
    for (const b of plan.blockers) expect(out()).toContain(`data-blocker="${b.code}"`);
    expect(t).toContain("LIQUIDITY_BUILD_NOT_IMPLEMENTED"); expect(t).toContain("NOT IMPLEMENTED");
  });
  it("has no control that can sign, send or deploy: the only button is disabled and says execution is not enabled", () => {
    const o = out();
    const buttons = o.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
    expect(buttons).toHaveLength(1); expect(buttons[0]).toContain("disabled"); expect(buttons[0]).toContain("EXECUTION NOT ENABLED IN THIS BETA");
    expect(o).not.toMatch(/<form|<input|<textarea|<select|href="[^"]*(sign|send|submit|deploy)[^"]*"/i);
    expect(text(o)).not.toMatch(/DEPLOY NOW|SIGN NOW|SEND|CONFIRMED|SUCCESS|DEPLOYED SUCCESSFULLY/);
  });
  it("shows unknown values as unknown, never invented: no mint, no pool, no signature, no explorer, undefined allocation", () => {
    const t = text(out()); const o = out();
    expect(t).toContain("NOT KNOWN YET"); expect(t).toContain("NONE (not created)"); expect(t).toContain("NOT DECIDED"); expect(t).toContain("UNDEFINED");
    expect(o).not.toMatch(/solscan|explorer/i); expect(t).not.toMatch(/\$0\b|\bnull\b|\bundefined\b|NaN/);
  });
  it("separates token supply allocation from the fee split and labels the split as not enforced", () => {
    const t = text(out());
    expect(t).toContain("Token supply and the fee split are different things".replace("Token supply and the fee split", "Token supply allocation and the fee split"));
    expect(t).toContain("Fee split (configured, not enforced on-chain)"); expect(t).toContain("60%"); expect(t).toContain("15%"); expect(t).toContain("10%");
  });
  it("authority wording never implies revocation before the instruction runs", () => {
    const t = text(out());
    expect(t).toContain("none (only after the revoke instruction runs)"); expect(t).not.toMatch(/\b(has been|is|are|was) revoked\b|immutable/i);
  });
  it("lists transactions with signers, instruction status and dependencies", () => {
    const o = out();
    for (const t of plan.transactions) expect(o).toContain(`data-transaction="${t.id}"`);
    expect(o).toContain('data-instruction="revoke-mint-authority" data-status="BLOCKED"'); expect(text(o)).toContain("after transaction 1");
  });
  it("is escaped: hostile user text is inert and no remote content loads", () => {
    const cfg = { ...fixtureLaunchConfig(), name: "<script>alert(1)</script>", description: "<img src=x onerror=alert(1)>", imageUri: "javascript:alert(1)", website: "https://example.org/<b>" };
    const r = buildDeploymentPlan({ launch: fixtureReadyLaunch(cfg), charity: deploymentFixtureInput("A_VALID_READY").charity });
    if (!r.ok) throw new Error("must build");
    const o = html(<DeploymentReviewView data={DeploymentPlanResponse.parse({ plan: r.plan, review: buildDeploymentReview(r.plan), recorded: false, supersededPlans: 0 })} />);
    expect(o).not.toContain("<script>"); expect(o).toContain("&lt;script&gt;"); expect(o).not.toMatch(/<img|<iframe|<object|<embed|<video/i); expect(o).not.toMatch(/href="javascript:/i);
  });
  it("avoids banned and overclaiming vocabulary", () => {
    const t = text(out());
    for (const b of BANNED_PHRASES) expect(t.toLowerCase()).not.toContain(b.toLowerCase());
    expect(t).not.toMatch(/\b(SAFE|GUARANTEED|TRUSTLESS|IMMUTABLE|AUDITED)\b|(?<!NOT )\bVERIFIED\b/);
  });
  it("shows an owner their addresses (this is the owner view) and a superseded-plan note", () => {
    const o = html(<DeploymentReviewView data={{ ...data(), recorded: true, supersededPlans: 2 }} />);
    expect(o).toContain(FIXTURE_WALLETS.reserve); expect(text(o)).toContain("2 earlier plans no longer current"); expect(text(o)).toContain("recorded");
  });
});

describe("client: deployment plan", () => {
  const c = createApiClient({ mode: "mock" });
  it("mock: the labeled demo launch serves a fixture plan, never executable; unknown ids are NOT_FOUND", async () => {
    const f = vi.fn();
    const mc = createApiClient({ mode: "mock", fetchImpl: f as unknown as typeof fetch });
    const d = DeploymentPlanResponse.parse(await mc.getDeploymentPlan(DEMO_IDS.launch));
    expect(d.plan).toMatchObject({ status: "BLOCKED", executionEnabled: false, dataSource: "demo" });
    expect((await mc.getDeploymentReview(DEMO_IDS.launch)).review.executionEnabled).toBe(false);
    await expect(mc.getDeploymentPlan(crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(f).not.toHaveBeenCalled();
  });
  it("mock: a saved DRAFT launch is refused with LAUNCH_NOT_READY (409), like the API", async () => {
    const l = await c.createLaunch(toLaunchRequest({ ...DEFAULT_LAUNCH_CONFIG, name: "Mine", symbol: "MINE" }, { creatorAddress: DEMO_WALLETS[1]!.address, reserveAddress: DEMO_WALLETS[1]!.address, charityId: DEMO_IDS.charities.c1 }));
    await expect(c.getDeploymentPlan(l.id)).rejects.toMatchObject({ status: 409, code: "LAUNCH_NOT_READY" });
  });
  it("api: requests the read-only endpoints and nothing else, and rejects a malformed or executable plan", async () => {
    const good = data();
    const f = vi.fn(async () => new Response(JSON.stringify(good), { status: 200, headers: { "content-type": "application/json" } }));
    const ac = createApiClient({ mode: "api", baseUrl: "http://api.test", fetchImpl: f as unknown as typeof fetch });
    const id = "11111111-1111-4111-8111-111111111111";
    await ac.getDeploymentPlan(id);
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe(`http://api.test/api/launches/${id}/deployment-plan`);
    expect(((f.mock.calls[0] as unknown[])[1] as RequestInit | undefined)?.method ?? "GET").toBe("GET");
    const bad = vi.fn(async () => new Response(JSON.stringify({ ...good, plan: { ...good.plan, executionEnabled: true } }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(createApiClient({ mode: "api", baseUrl: "http://api.test", fetchImpl: bad as unknown as typeof fetch }).getDeploymentPlan(id)).rejects.toThrow();
  });
  it("the client exposes no sign, send, submit or deploy method", () => {
    expect(Object.keys(c).filter((k) => /sign|send|submit|deploy(?!mentPlan|mentReview)|execute|broadcast/i.test(k))).toEqual([]);
    const src = readFileSync(join(__dirname, "../lib/api/client.ts"), "utf8");
    expect(src).not.toMatch(/signTransaction|sendTransaction|signAndSend|Keypair|secretKey|privateKey/);
  });
});
