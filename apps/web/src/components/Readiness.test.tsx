import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  BANNED_PHRASES, DEMO_IDS, DEMO_WALLETS, DeploymentAttemptList, DeploymentDecisionSummary, ExecutionReadinessResponse, GATE_IDS, buildDecisionSummary, buildReadinessResponse, evaluateExecutionReadiness,
  fixtureReadyLaunch, FIXTURE_CHARITY,
} from "@project-name/shared";
import { createApiClient } from "@/lib/api/client";
import { toLaunchRequest } from "@/lib/launch";
import { DEFAULT_LAUNCH_CONFIG } from "@/mock";
import { ReadinessView } from "./ReadinessView";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const launch = fixtureReadyLaunch();
const readiness = evaluateExecutionReadiness({ launch, charity: FIXTURE_CHARITY, planState: { recorded: false, supersededPlans: 0 } });
const data = buildReadinessResponse(launch, readiness);
const decisions = buildDecisionSummary(launch, readiness);
const out = () => html(<ReadinessView data={data} decisions={decisions} />);

describe("deployment readiness view", () => {
  it("says BLOCKED, REAL EXECUTION: DISABLED and the three NO notices, and never says ready to sign", () => {
    const t = text(out());
    for (const x of ["DEPLOYMENT READINESS", "BLOCKED", "REAL EXECUTION: DISABLED", "NO TRANSACTIONS SENT", "NO FUNDS MOVED", "NO PRIVATE KEYS STORED", "DEMO · FIXTURE", "EXECUTION NOT ENABLED IN THIS BETA"]) expect(t).toContain(x);
    expect(t).not.toMatch(/READY TO SIGN|READY FOR SIGNING|APPROVED FOR (EXECUTION|SIGNING|DEPLOYMENT|MAINNET)|MAINNET READY|READY FOR EXECUTION|EXECUTION ENABLED/);
  });
  it("renders every gate with its status, and every blocked one says what must be decided and by which kind of owner", () => {
    const o = out();
    for (const id of GATE_IDS) expect(o, id).toContain(`data-gate="${id}"`);
    for (const g of readiness.gates.filter((x) => x.blocking)) {
      const li = o.split(`data-gate="${g.id}"`)[1]!.split("</li>")[0]!;
      expect(text(li), g.id).toContain("Must be decided or done"); expect(li).toMatch(/PRODUCT DECISION|TECHNICAL|SECURITY|LEGAL/);
    }
    expect(o).toContain('data-gate="FEE_ROUTING_ENFORCEABLE" data-status="BLOCKED"');
    expect(o).toContain('data-gate="CHARITY_DESTINATIONS_VERIFIED" data-status="PASS"');
  });
  it("uses the exact blocker wording for fee routing, protocol destination and liquidity", () => {
    const t = text(out());
    expect(t).toContain("FEE_ROUTING_ENFORCEMENT_NOT_IMPLEMENTED"); expect(t).toContain("PROTOCOL_DESTINATION_PENDING"); expect(t).toContain("No pool or lock is invented");
  });
  it("lists the decision records with status, version, provenance and what is missing", () => {
    const o = out(); const t = text(o);
    expect(t).toContain("12 DECIDED"); expect(t).toContain("10 PENDING"); expect(t).toContain("11 WITHOUT PRODUCT APPROVAL");
    for (const d of decisions.decisions) expect(o).toContain(`data-decision="${d.id}" data-status="${d.status}"`);
    expect(t).toContain("Missing:"); expect(t).toMatch(/changing it invalidates readiness: yes/);
    expect(t).toContain("approver: none recorded");
    // approved items show who approved, when, and under what reference; the approver is the role (no name was supplied)
    const seg = (id: string) => text(o.split(`data-decision="${id}"`)[1]!.split("data-decision=")[0]!);
    const fee = seg("FEE_ROUTING_MECHANISM");
    expect(fee).toContain("approver: Product owner (name not supplied"); expect(fee).toContain("approved at: 2026-10-07"); expect(fee).toContain("reference: Product Economics decision pass 1");
    expect(o).toContain('data-decision="FEE_ROUTING_MECHANISM" data-status="DECIDED" data-approval="APPROVED" data-blocking="no"');
    expect(fee).toContain("CUSTOM_SOLANA_PROGRAM"); expect(fee).toMatch(/not implemented|No program exists/i);
    expect(seg("LIQUIDITY_STRATEGY")).toContain("Do not guess the venue");
    expect(text(o)).toContain("Product owner notes:"); expect(t).toContain("approved at: not approved"); expect(t).toContain("Depends on:"); expect(t).toContain("Must be pinned down:"); expect(t).toContain("BLOCKING");
    expect(o).toContain('data-decision="LIQUIDITY_STRATEGY" data-status="PENDING" data-approval="PENDING_PRODUCT_APPROVAL" data-blocking="yes"');
    expect(t).toContain("Nothing on this page can approve a decision");
    for (const m of decisions.milestones) expect(o).toContain(`data-milestone="${m.id}" data-unblocked="no"`);
    expect(t).toContain("WHAT EACH DECISION BLOCKS");
  });
  it("has no control that can sign, send, approve or enable execution: one disabled button, no forms", () => {
    const o = out(); const b = o.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
    expect(b).toHaveLength(1); expect(b[0]).toContain("disabled");
    expect(o).not.toMatch(/<form|<input|<textarea|<select|<a [^>]*href="[^"]*(sign|send|submit|approve|execute)/i);
  });
  it("never claims the configured split is enforced, nor immutability, safety or guarantees", () => {
    const t = text(out());
    expect(t).not.toMatch(/\b(is|are|fully|automatically) enforced\b|\b(SAFE|GUARANTEED|TRUSTLESS|IMMUTABLE|AUDITED|AUTOMATIC)\b/);
    for (const b of BANNED_PHRASES) expect(t.toLowerCase()).not.toContain(b.toLowerCase());
    expect(t).toContain("The configured fee split is a configuration, not an on-chain rule");
  });
  it("is escaped and loads nothing remote", () => {
    const o = out(); expect(o).not.toMatch(/<img|<iframe|<script|<object|<embed|<video/i);
  });
  it("the response schema refuses a payload that says execution is permitted or enabled", () => {
    expect(ExecutionReadinessResponse.safeParse({ ...data, readiness: { ...data.readiness, executionPermitted: true } }).success).toBe(false);
    expect(ExecutionReadinessResponse.safeParse({ ...data, execution: { ...data.execution, enabled: true } }).success).toBe(false);
    expect(ExecutionReadinessResponse.safeParse({ ...data, readiness: { ...data.readiness, overall: "READY_FOR_SIGNING" } }).success).toBe(false);
  });
});

describe("client: readiness, decisions, attempts", () => {
  const c = createApiClient({ mode: "mock" });
  it("mock: the demo launch is BLOCKED with execution disabled; nothing is fetched", async () => {
    const f = vi.fn(); const mc = createApiClient({ mode: "mock", fetchImpl: f as unknown as typeof fetch });
    const d = ExecutionReadinessResponse.parse(await mc.getExecutionReadiness(DEMO_IDS.launch));
    expect(d.readiness).toMatchObject({ overall: "BLOCKED", executionPermitted: false }); expect(d.dataSource).toBe("demo");
    expect(DeploymentDecisionSummary.parse(await mc.getDeploymentDecisionSummary(DEMO_IDS.launch)).counts).toEqual({ decided: 12, pending: 10, unapproved: 11 });
    expect(DeploymentAttemptList.parse(await mc.getDeploymentAttempts(DEMO_IDS.launch)).attempts).toEqual([]);
    await expect(mc.getExecutionReadiness(crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(f).not.toHaveBeenCalled();
  });
  it("mock: a saved DRAFT launch is blocked at LAUNCH_READY, not an error", async () => {
    const l = await c.createLaunch(toLaunchRequest({ ...DEFAULT_LAUNCH_CONFIG, name: "Mine", symbol: "MINE" }, { creatorAddress: DEMO_WALLETS[1]!.address, reserveAddress: DEMO_WALLETS[1]!.address, charityId: DEMO_IDS.charities.c1 }));
    const d = await c.getExecutionReadiness(l.id);
    expect(d.readiness.gates.find((g) => g.id === "LAUNCH_READY")!.status).toBe("BLOCKED"); expect(d.readiness.executionPermitted).toBe(false);
  });
  it("api: GET only, to the read-only endpoints", async () => {
    const f = vi.fn(async (url: unknown) => new Response(JSON.stringify(String(url).endsWith("/execution-readiness") ? data : String(url).endsWith("/deployment-decision-summary") ? decisions : { launchId: DEMO_IDS.launch, attempts: [], execution: { enabled: false }, note: "n" }), { status: 200, headers: { "content-type": "application/json" } }));
    const ac = createApiClient({ mode: "api", baseUrl: "http://api.test", fetchImpl: f as unknown as typeof fetch });
    const id = "11111111-1111-4111-8111-111111111111";
    await ac.getExecutionReadiness(id); await ac.getDeploymentDecisionSummary(id); await ac.getDeploymentAttempts(id);
    expect(f.mock.calls.map((x) => String((x as unknown[])[0]))).toEqual([`http://api.test/api/launches/${id}/execution-readiness`, `http://api.test/api/launches/${id}/deployment-decision-summary`, `http://api.test/api/launches/${id}/deployment-attempts`]);
    for (const call of f.mock.calls) expect(((call as unknown[])[1] as RequestInit | undefined)?.method ?? "GET").toBe("GET");
  });
  it("api: a payload claiming execution is permitted is rejected", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ...data, readiness: { ...data.readiness, executionPermitted: true } }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(createApiClient({ mode: "api", baseUrl: "http://api.test", fetchImpl: f as unknown as typeof fetch }).getExecutionReadiness("11111111-1111-4111-8111-111111111111")).rejects.toThrow();
  });
});
