import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  BANNED_PHRASES, DEMO_IDS, DEMO_WALLETS, FIXTURE_MINT, FIXTURE_WALLETS, LaunchProof, PROOF_COPY, PROOF_SCENARIOS, buildLaunchProof, buildProofFixture, proofFixtureInputs, type ChainObservation,
} from "@project-name/shared";
import { createApiClient } from "@/lib/api/client";
import { toLaunchRequest } from "@/lib/launch";
import { transparencyBadge } from "@/lib/transparency";
import { DEFAULT_LAUNCH_CONFIG } from "@/mock";
import { LaunchProofView } from "./LaunchProofView";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const view = (s: (typeof PROOF_SCENARIOS)[number], audience: "owner" | "public" = "public") => html(<LaunchProofView proof={buildProofFixture(s, audience)} />);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("token proof view: status labels come from the server and never overstate", () => {
  it("shows the exact status wording per scenario", () => {
    expect(view("NOT_DEPLOYED")).toContain("NOT DEPLOYED");
    expect(view("DEPLOYED_BUT_UNOBSERVED")).toContain("AWAITING OBSERVATION");
    expect(view("FULL_MATCH")).toContain("PARTIAL PROOF");
    expect(view("SUPPLY_MISMATCH")).toContain("VERIFICATION FAILED");
    expect(view("UNAVAILABLE_OBSERVATION")).toContain("PROOF UNAVAILABLE");
  });
  it("no fixture scenario ever prints VERIFIED TRANSPARENCY, and each is labeled DEMO / FIXTURE / NOT VERIFIED ON-CHAIN", () => {
    for (const s of PROOF_SCENARIOS) {
      const out = view(s);
      expect(out.toUpperCase(), s).not.toContain("VERIFIED TRANSPARENCY</SPAN>");
      expect(text(out), s).not.toMatch(/\bVERIFIED TRANSPARENCY\b(?! is shown only)/);
      expect(out, s).toContain("DEMO · FIXTURE · NOT VERIFIED ON-CHAIN");
    }
  });
  it("prints VERIFIED TRANSPARENCY only when the SERVER object says verifiedTransparency (synthetic RPC proof)", () => {
    const i = proofFixtureInputs("FULL_MATCH");
    const rpc: ChainObservation = { ...i.observation!, source: "RPC" };
    const proof = buildLaunchProof({ ...i, subject: { ...i.subject, dataSource: "chain" }, observation: rpc, observationCount: 1, historyIntact: true, audience: "owner" });
    expect(proof.verifiedTransparency).toBe(true);
    const out = html(<LaunchProofView proof={proof} />);
    expect(out).toContain("VERIFIED TRANSPARENCY");
    expect(out).not.toContain("DEMO · FIXTURE");
    // the view must not decide: flip only the server flag and status, the wording follows the object
    const forged = { ...proof, status: "PARTIAL" as const, statusLabel: "PARTIAL PROOF", verifiedTransparency: false, verifiedOnChain: false };
    expect(text(html(<LaunchProofView proof={forged} />))).not.toMatch(/VERIFIED TRANSPARENCY(?! is shown only)/);
  });
  it("renders all seven sections A-G with the required disclosure sentences", () => {
    const out = view("FULL_MATCH", "owner"); const t = text(out);
    for (const h of ["A · IDENTITY", "B · CONFIGURATION", "C · OBSERVED ON-CHAIN", "D · VERIFICATION CHECKS", "E · MISMATCHES", "F · PROVENANCE", "G · DISCLOSURE"]) expect(t).toContain(h);
    expect(t).toContain("TOKEN PROOF");
    expect(t).toContain(PROOF_COPY.configuredNotProof);
    expect(t).toContain("Verified Transparency is shown only when every required objective check passes");
    expect(t).toContain("Metadata may be user-provided and is not verified unless a check explicitly says it matches on-chain data.");
  });
  it("mismatch scenarios show configured and observed values side by side", () => {
    const t = text(view("SUPPLY_MISMATCH"));
    expect(t).toContain("Total supply matches"); expect(t).toContain("1,000,000,000,000,000"); expect(t).toContain("1000000000000001");
    expect(view("NETWORK_MISMATCH")).toContain("mainnet-beta");
    expect(view("DECIMALS_MISMATCH")).toContain('data-check="DECIMALS_MATCH" data-state="FAIL"');
    expect(view("AUTHORITY_MISMATCH")).toContain('data-check="MINT_AUTHORITY_MATCH" data-state="FAIL"');
  });
  it("unavailable values say UNAVAILABLE with a reason, never $0 / 0 / false placeholders", () => {
    const t = text(view("PARTIAL_OBSERVATION"));
    expect(t).toContain("UNAVAILABLE (The observer could not read the liquidity pool.)");
    expect(t).not.toMatch(/\$0\b|\bfalse\b|\bnull\b|\bundefined\b|NaN/);
    expect(view("MISSING_METADATA")).toContain('data-check="METADATA_MATCH" data-state="UNAVAILABLE"');
  });
  it("not deployed shows no mint, signature, or explorer link", () => {
    const out = view("NOT_DEPLOYED", "owner");
    expect(text(out)).toContain("NOT DEPLOYED"); expect(text(out)).toContain("NOT AVAILABLE");
    expect(out).not.toContain(FIXTURE_MINT); expect(out).not.toMatch(/solscan|explorer\.solana/i);
    expect(out).not.toMatch(/<a [^>]*href="[^"]*(tx|address)\//);
  });
  it("public view explains the four questions and hides private wallet data; owner view shows it", () => {
    const pub = text(view("FULL_MATCH", "public"));
    for (const q of ["What was promised?", "What was observed?", "Do they match?", "What could not be verified?"]) expect(pub).toContain(q);
    expect(pub).not.toContain(FIXTURE_WALLETS.reserve); expect(pub).not.toContain(FIXTURE_WALLETS.creator);
    expect(text(view("FULL_MATCH", "owner"))).toContain(FIXTURE_WALLETS.reserve);
  });
  it("is escaped: hostile user metadata renders as inert text", () => {
    const i = proofFixtureInputs("FULL_MATCH");
    const hostile = { ...i.subject.config, name: "<script>alert(1)</script>", description: "<img src=x onerror=alert(1)>", imageUri: "javascript:alert(1)", website: "https://evil.example/<b>" };
    const p = buildLaunchProof({ ...i, subject: { ...i.subject, config: hostile as typeof i.subject.config }, observationCount: 1, historyIntact: true, audience: "owner" });
    const out = html(<LaunchProofView proof={p} />);
    expect(out).not.toContain("<script>"); expect(out).not.toMatch(/<img /); expect(out).toContain("&lt;script&gt;");
    expect(out).not.toMatch(/href="javascript:/i);
    expect(out).not.toMatch(/<img|<iframe|<object|<embed|<video|<audio/i);
  });
  it("never loads a remote image, even when an image URL is configured", () => {
    const i = proofFixtureInputs("FULL_MATCH");
    const cfg = { ...i.subject.config, imageUri: "https://example.org/logo.png" };
    const out = html(<LaunchProofView proof={buildLaunchProof({ ...i, subject: { ...i.subject, config: cfg }, observationCount: 1, historyIntact: true, audience: "public" })} />);
    expect(out).not.toMatch(/<img/i); expect(out).toContain("https://example.org/logo.png");
  });
  it("avoids banned and overclaiming vocabulary", () => {
    for (const s of PROOF_SCENARIOS) {
      const t = text(view(s, "owner"));
      for (const b of BANNED_PHRASES) expect(t.toLowerCase(), `${s}: ${b}`).not.toContain(b.toLowerCase());
      expect(t, s).not.toMatch(/\b(SAFE|GUARANTEED|TRUSTLESS|IMMUTABLE|AUDITED)\b/);
    }
  });
});

describe("server-derived transparency badge", () => {
  it("never says VERIFIED TRANSPARENCY from reported checks alone", () => {
    expect(transparencyBadge({ reported: 9, total: 9, verifiedTransparency: false, dataSource: "chain" }).label).toBe("ALL 9 CHECKS REPORTED");
    expect(transparencyBadge({ reported: 0, total: 9, verifiedTransparency: true, dataSource: "chain" }).label).toBe("VERIFIED TRANSPARENCY");
  });
  it("the source no longer derives the badge from verifiedOnChain", () => {
    const src = readFileSync(join(__dirname, "../lib/transparency.ts"), "utf8");
    expect(src).not.toMatch(/verifiedOnChain\s*&&/);
  });
});

describe("client: mock mode proof", () => {
  const c = createApiClient({ mode: "mock" });
  it("serves the labeled demo launch as a FIXTURE scenario that is never verified, and honors a known scenario", async () => {
    const f = vi.fn();
    const mc = createApiClient({ mode: "mock", fetchImpl: f as unknown as typeof fetch });
    const a = LaunchProof.parse(await mc.getPublicLaunchProof(DEMO_IDS.launch));
    expect(a).toMatchObject({ status: "PARTIAL", verifiedTransparency: false, verifiedOnChain: false, dataSource: "demo", audience: "public" });
    expect((await mc.getPublicLaunchProof(DEMO_IDS.launch, "SUPPLY_MISMATCH")).status).toBe("FAILED");
    expect((await mc.getPublicLaunchProof(DEMO_IDS.launch, "<script>")).status).toBe("PARTIAL"); // unknown scenario falls back, never evaluated
    expect(f).not.toHaveBeenCalled();
  });
  it("a saved mock launch has a NOT DEPLOYED proof and an unknown id is NOT_FOUND", async () => {
    const l = await c.createLaunch(toLaunchRequest({ ...DEFAULT_LAUNCH_CONFIG, name: "Mine", symbol: "MINE" }, { creatorAddress: DEMO_WALLETS[1]!.address, reserveAddress: DEMO_WALLETS[1]!.address, charityId: DEMO_IDS.charities.c1 }));
    expect(LaunchProof.parse(await c.getLaunchProof(l.id))).toMatchObject({ status: "NOT_DEPLOYED", verifiedTransparency: false, audience: "owner" });
    await expect(c.getLaunchProof(crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(c.getPublicLaunchProof(crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
  });
});

describe("client: api mode", () => {
  it("requests the proof endpoints and sends no scenario", async () => {
    const proof = buildProofFixture("NOT_DEPLOYED", "owner");
    const f = vi.fn(async () => new Response(JSON.stringify(proof), { status: 200, headers: { "content-type": "application/json" } }));
    const c = createApiClient({ mode: "api", baseUrl: "http://api.test", fetchImpl: f as unknown as typeof fetch });
    await c.getLaunchProof("11111111-1111-4111-8111-111111111111");
    await c.getPublicLaunchProof("11111111-1111-4111-8111-111111111111", "FULL_MATCH");
    const urls = f.mock.calls.map((x) => String((x as unknown[])[0]));
    expect(urls[0]).toBe("http://api.test/api/launches/11111111-1111-4111-8111-111111111111/proof");
    expect(urls[1]).toBe("http://api.test/api/public/launches/11111111-1111-4111-8111-111111111111/proof");
  });
  it("rejects a response that is not a valid proof (no trusting an unexpected shape)", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: "VERIFIED", verifiedTransparency: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const c = createApiClient({ mode: "api", baseUrl: "http://api.test", fetchImpl: f as unknown as typeof fetch });
    await expect(c.getPublicLaunchProof("11111111-1111-4111-8111-111111111111")).rejects.toThrow();
  });
});
