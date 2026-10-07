import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import {
  BANNED_PHRASES, DEMO_IDS, DEMO_WALLETS, LAUNCH_COPY, STATUS_MEANING, availableLaunchActions, buildCharityList, buildDemoLaunch, buildDemoPublicLaunch, launchFingerprint, type Launch, type LaunchHistory,
} from "@project-name/shared";
import { describe, expect, it } from "vitest";
import { createApiClient } from "@/lib/api/client";
import { allErrors, stepErrors, toLaunchRequest, type StepContext } from "@/lib/launch";
import { DEFAULT_LAUNCH_CONFIG } from "@/mock";
import { LaunchProvider } from "@/state/launch";
import { makeWalletValue } from "@/state/testing";
import { WalletContext } from "@/state/wallet";
import { FeeSplitEditor } from "./FeeSplitEditor";
import { LaunchLifecyclePanel } from "./LaunchLifecyclePanel";
import { HistoryList, LaunchSummary, PublicLaunchView, launchStatusBadge } from "./LaunchSummary";
import { PublicLaunchListView } from "./screens/PublicLaunchesScreen";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const strip = (s: string) => s.replace(/NOT DEPLOYED/gi, "").replace(/not_deployed/gi, "").replace(/nothing is deployed/gi, "");
const demo = buildDemoLaunch();
const withStatus = (status: Launch["status"], over: Partial<Launch> = {}): Launch => ({ ...demo, status, statusMeaning: STATUS_MEANING[status], ...over });
const snap = (over = {}) => ({ id: DEMO_IDS.charities.c1, name: "Open Water Initiative (demo)", verificationState: "VERIFIED" as const, verificationSource: "FIXTURE" as const, lastReviewedAt: "2026-01-01T00:00:00.000Z", dataSource: "demo" as const, ...over });
const review = (over: Partial<NonNullable<Launch["review"]>> = {}): NonNullable<Launch["review"]> => ({
  passed: true, errors: [], warnings: ["No contract exists: this is a configured fee split, not enforced on-chain."],
  moneyFlowExampleCents: { creator: "60000", taxReserve: "15000", charity: "15000", protocol: "10000" }, feeSplitLabel: "Configured fee split", feeSplitEnforcement: "not_enforced", deployable: false,
  reviewedAt: "2026-01-01T00:00:00.000Z", fingerprint: demo.fingerprint, charity: snap(),
  allocations: [], ...over,
});

describe("fixed fee split display", () => {
  const out = html(<FeeSplitEditor />);
  it("shows CREATOR 60%, TAX RESERVE 15%, CHARITY 15%, PROTOCOL 10% with nothing to edit", () => {
    for (const t of ["CREATOR", "60%", "TAX RESERVE", "CHARITY", "PROTOCOL", "10%", "FIXED FOR THIS VERSION"]) expect(out, t).toContain(t);
    expect(out.match(/>15%</g)).toHaveLength(2);
    expect(out).not.toMatch(/<input|<select|<textarea/);
  });
  it("calls it a configuration, never immutable, and never a payment", () => {
    expect(out).toContain("It is not enforced on-chain.");
    expect(out).toContain("Configured creator allocation");
    expect(out).toContain("Configured tax reserve allocation (launch fee)");
    expect(out).toContain("not your personal Tax Reserve");
    expect(out).toContain("does not execute a donation");
    expect(out).toContain("no protocol address is configured");
    expect(out.toLowerCase()).not.toMatch(/immutable|\b(earned|received|paid)\b|reserved already/);
  });
});

describe("launch summary by status", () => {
  it("DRAFT / CONFIGURED / REVIEW / CANCELLED are labeled and always NOT DEPLOYED / NOT VERIFIED ON-CHAIN", () => {
    for (const status of ["DRAFT", "CONFIGURED", "REVIEW", "CANCELLED"] as const) {
      const out = html(<LaunchSummary launch={withStatus(status)} />);
      expect(out, status).toContain(launchStatusBadge(status).label);
      expect(out).toContain("NOT DEPLOYED");
      expect(out).toContain("NOT VERIFIED ON-CHAIN");
      expect(out).not.toContain("READY FOR DEPLOYMENT");
    }
  });
  it("READY says READY FOR DEPLOYMENT with the exact meaning, never deployed or live", () => {
    const out = html(<LaunchSummary launch={withStatus("READY")} />);
    for (const t of ["READY FOR DEPLOYMENT", "Configuration validated.", "ready for a future deployment flow", "No on-chain transaction has been submitted", "On-chain deployment is not enabled in this beta.", "NOT DEPLOYED"]) expect(out, t).toContain(t);
    expect(strip(out).toLowerCase()).not.toMatch(/\bdeployed\b|\blive\b|launched successfully|congratulations|verified on-chain(?!\b)/);
    expect(launchStatusBadge("READY").tone).not.toBe("good"); // never styled as a success state
  });
  it("shows network, supply, decimals, user-provided metadata provenance and the fingerprint with its caveat", () => {
    const out = html(<LaunchSummary launch={withStatus("CONFIGURED")} />);
    for (const t of ["devnet (configuration only)", "1,000,000,000", "USER-PROVIDED", "USER-PROVIDED metadata. It is not verified on-chain.", demo.fingerprint, "It is not a blockchain proof."]) expect(out, t).toContain(t);
    expect(out.toLowerCase()).not.toContain("verified token metadata");
    expect(out).not.toMatch(/explorer|solscan/i);
  });
  it("charity block: name, verification status, source, last reviewed, and a fixture caveat; no donation promise", () => {
    const out = html(<LaunchSummary launch={withStatus("CONFIGURED", { review: review() })} />);
    for (const t of ["Open Water Initiative (demo)", "VERIFIED (FIXTURE, NOT REAL-WORLD)", "FIXTURE", "Last reviewed", "Verification status", "Verification source", "does not execute a donation", "not a real-world verification"]) expect(out, t).toContain(t);
    const pending = html(<LaunchSummary launch={withStatus("DRAFT", { review: review({ passed: false, errors: [{ field: "charityConfiguration.charityId", message: "Charity is not verified (registry status PENDING REVIEW)." }], charity: snap({ verificationState: "PENDING_REVIEW", verificationSource: null }) }) })} />);
    expect(pending).toContain("PENDING REVIEW");
    expect(pending).toContain("Server validation found problems");
    expect(pending).not.toContain("VERIFIED (FIXTURE");
  });
  it("tax reserve allocation is separate from the personal Tax Reserve and is not money", () => {
    const out = html(<LaunchSummary launch={withStatus("CONFIGURED")} />);
    expect(out).toContain("Tax reserve allocation (launch fee)");
    expect(out).toContain("It is not your personal Tax Reserve, and no reserve is created.");
    expect(out.toLowerCase()).not.toMatch(/reserve balance|reserve target|coverage/);
  });
  it("hostile metadata renders as inert text and unsafe links are not linked", () => {
    const hostile = withStatus("CONFIGURED", { config: { ...demo.config, name: "<img src=x onerror=alert(1)>", description: "<script>alert(1)</script>", website: "javascript:alert(1)", imageUri: "data:text/html,x", socials: { twitter: "javascript:x", telegram: null, discord: null, github: null } } });
    const out = html(<LaunchSummary launch={hostile} />);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
    expect(out).not.toContain('href="javascript');
    expect(out).not.toContain('href="data:');
    expect(out).toContain("Not shown (unsafe URL)");
    const ok = html(<LaunchSummary launch={withStatus("CONFIGURED", { config: { ...demo.config, website: "https://example.org/a" } })} />);
    expect(ok).toContain('href="https://example.org/a"');
    expect(ok).toContain("noopener noreferrer nofollow");
  });
  it("renders no external image and no raw HTML", () => {
    expect(html(<LaunchSummary launch={withStatus("READY", { config: { ...demo.config, imageUri: "https://example.org/i.png" } })} />)).not.toContain("<img");
  });
  it("review errors and warnings come from the server and the fee illustration says nothing is paid", () => {
    const out = html(<LaunchSummary launch={withStatus("DRAFT", { review: review({ passed: false, errors: [{ field: "supply", message: "Creator allocation plus liquidity supply exceeds 100% of supply." }] }) })} />);
    expect(out).toContain("Creator allocation plus liquidity supply exceeds 100% of supply.");
    expect(out).toContain("Illustration for a $1,000.00 fee");
    expect(out).toContain("Nothing is paid.");
    expect(out).toContain("Deployable: no.");
  });
});

describe("history", () => {
  const h: LaunchHistory = {
    launchId: demo.id, historyIntact: true, note: "Append-only and hash-chained. This is auditability, not a blockchain proof.",
    revisions: [
      { seq: 1, action: "create", statusAfter: "DRAFT", fingerprint: "a".repeat(64), reason: null, createdAt: "2026-01-01T00:00:00.000Z", prevHash: null, rowHash: "1".repeat(64) },
      { seq: 2, action: "cancel", statusAfter: "CANCELLED", fingerprint: "a".repeat(64), reason: "changed my mind", createdAt: "2026-01-02T00:00:00.000Z", prevHash: "1".repeat(64), rowHash: "2".repeat(64) },
    ],
  };
  it("lists actions in order, with reasons, and does not overclaim", () => {
    const out = html(<HistoryList history={h} />);
    for (const t of ["CREATE", "CANCEL", "changed my mind", "Hash chain verified.", "not a blockchain proof"]) expect(out, t).toContain(t);
    expect(out.toLowerCase()).not.toMatch(/immutable|cryptographically/);
  });
  it("says plainly when the chain does not verify", () => {
    expect(html(<HistoryList history={{ ...h, historyIntact: false }} />)).toContain("does not verify");
  });
});

describe("public launch view", () => {
  it("is labeled CONFIGURED / NOT DEPLOYED / NOT VERIFIED ON-CHAIN / DEMO DATA and shows no full wallet address", () => {
    const out = html(<PublicLaunchView launch={buildDemoPublicLaunch()} />);
    for (const t of ["CONFIGURED", "NOT DEPLOYED", "NOT VERIFIED ON-CHAIN", "DEMO DATA", "USER-PROVIDED", "Configured allocations", "On-chain deployment is not enabled in this beta."]) expect(out, t).toContain(t);
    expect(out).not.toContain(DEMO_WALLETS[1]!.address);
    expect(out).toContain("…");
  });
  it("list view: empty state, and entries link to the read-only detail", () => {
    expect(html(<PublicLaunchListView launches={[]} />)).toContain("NO PUBLIC LAUNCH CONFIGURATIONS");
    const out = html(<PublicLaunchListView launches={[buildDemoPublicLaunch()]} />);
    expect(out).toContain(`/launches/view?id=${buildDemoPublicLaunch().id}`);
    expect(out).toContain("DEMO DATA");
  });
});

describe("lifecycle panel", () => {
  const ctx: StepContext = { walletConnected: true, verifiedCharityIds: [DEMO_IDS.charities.c1], walletIds: ["w2"] };
  const panel = html(<WalletContext.Provider value={makeWalletValue({})}><LaunchProvider><LaunchLifecyclePanel ctx={ctx} blocked={false} /></LaunchProvider></WalletContext.Provider>);
  it("before anything is saved: SAVE DRAFT only, and nothing deploys", () => {
    expect(panel).toContain("SAVE DRAFT");
    expect(panel).toMatch(/<button[^>]*disabled[^>]*>VALIDATE CONFIGURATION/);
    expect(panel).toMatch(/<button[^>]*disabled[^>]*>SUBMIT FOR REVIEW/);
    expect(panel).not.toContain("MARK READY");
    expect(panel).toContain("NOTHING IS DEPLOYED");
    expect(panel).toContain("your wallet is never asked to sign");
    expect(panel).not.toMatch(/\bDEPLOY\b(?! )/);
  });
  it("offers exactly the actions the transition table allows", () => {
    expect(availableLaunchActions(null, false)).toEqual({ save: true, configure: false, review: false, ready: false, cancel: false });
    expect(availableLaunchActions("DRAFT", false)).toEqual({ save: false, configure: true, review: false, ready: false, cancel: true });
    expect(availableLaunchActions("CONFIGURED", false)).toMatchObject({ configure: false, review: true, ready: false });
    expect(availableLaunchActions("REVIEW", false)).toMatchObject({ review: false, ready: true });
    expect(availableLaunchActions("READY", false)).toMatchObject({ configure: false, review: false, ready: false, cancel: true });
    expect(availableLaunchActions("READY", true)).toMatchObject({ save: true, ready: false }); // unsaved edits must be saved (and re-reviewed) first
    expect(availableLaunchActions("CANCELLED", true)).toEqual({ save: false, configure: false, review: false, ready: false, cancel: false });
  });
});

describe("wizard validation and request mapping", () => {
  const ctx: StepContext = { walletConnected: true, verifiedCharityIds: ["c1"], walletIds: ["w1"] };
  const ok = { ...DEFAULT_LAUNCH_CONFIG, name: "Example", symbol: "EXMPL" };
  it("the request carries the canonical split, nulls for empty URLs, and no status, owner or fingerprint", () => {
    const req = toLaunchRequest(ok, { creatorAddress: DEMO_WALLETS[1]!.address, reserveAddress: DEMO_WALLETS[1]!.address, charityId: DEMO_IDS.charities.c1 });
    expect(req).toMatchObject({ feeSplit: { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 }, network: "devnet", imageUri: null, website: null, socials: { twitter: null, telegram: null, discord: null, github: null } });
    for (const k of ["status", "userId", "creatorUserId", "fingerprint", "deployment", "mintAddress", "transactionSignature"]) expect(req).not.toHaveProperty(k);
    expect(toLaunchRequest({ ...ok, website: " https://example.org " }, { creatorAddress: "a", reserveAddress: "b", charityId: "c" }).website).toBe("https://example.org");
  });
  it("token details: plain text only, safe URLs only", () => {
    expect(stepErrors("info", ok, ctx)).toEqual([]);
    for (const patch of [{ name: "<b>x</b>" }, { name: "A  B" }, { description: "<script>" }, { imageUrl: "javascript:alert(1)" }, { imageUrl: "http://example.org/a.png" }, { website: "data:text/html,x" }, { twitter: "http://example.org" }, { github: "https://u:p@example.org" }]) {
      expect(stepErrors("info", { ...ok, ...patch }, ctx).length, JSON.stringify(patch)).toBeGreaterThan(0);
    }
    expect(stepErrors("info", { ...ok, imageUrl: "https://example.org/a.png", website: "http://example.org", twitter: "https://example.org/t" }, ctx)).toEqual([]);
  });
  it("supply must fit a u64 once scaled by decimals (exact, no floats)", () => {
    expect(stepErrors("supply", { ...ok, totalSupply: "18446744073709551615", decimals: "0" }, ctx)).toEqual([]);
    expect(stepErrors("supply", { ...ok, totalSupply: "18446744073709551616", decimals: "0" }, ctx).join()).toMatch(/64-bit/);
    expect(stepErrors("supply", { ...ok, totalSupply: "20000000000", decimals: "9" }, ctx).join()).toMatch(/64-bit/);
    expect(allErrors(ok, ctx)).toEqual([]);
  });
});

describe("mock client: no deployment surface", () => {
  it("exposes no deploy, mint, liquidity, distribution, payout, donation or transfer function", () => {
    const names = Object.keys(createApiClient({ mode: "mock" })).join(" ").toLowerCase();
    expect(names).not.toMatch(/deploy|mint|liquidity|distribut|payout|donate|transfer|swap|sign/);
  });
  it("a saved mock launch is DEMO DATA, DRAFT and has a deterministic fingerprint", async () => {
    const c = createApiClient({ mode: "mock" });
    const req = toLaunchRequest({ ...DEFAULT_LAUNCH_CONFIG, name: "Example", symbol: "EXMPL" }, { creatorAddress: DEMO_WALLETS[1]!.address, reserveAddress: DEMO_WALLETS[1]!.address, charityId: DEMO_IDS.charities.c1 });
    const a = await c.createLaunch(req);
    const b = await c.createLaunch(req);
    expect(a).toMatchObject({ status: "DRAFT", dataSource: "demo" });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toBe(launchFingerprint(a.config));
    expect(buildCharityList().find((x) => x.id === a.config.charityConfiguration.charityId)!.verificationSource).toBe("FIXTURE");
  });
});

describe("language and source lint (launch UI)", () => {
  const sources = ["components/LaunchSummary.tsx", "components/LaunchLifecyclePanel.tsx", "components/FeeSplitEditor.tsx", "components/screens/PublicLaunchesScreen.tsx"].map((f) => readFileSync(join(__dirname, "..", f), "utf8").toLowerCase());
  it("no banned phrase, no immutability or deployment claim, no raw HTML, no external images", () => {
    for (const t of sources) {
      for (const p of BANNED_PHRASES) expect(t, p).not.toContain(p);
      expect(t).not.toMatch(/dangerouslysetinnerhtml|<img|\bimmutable\b|sendtransaction|signtransaction|api\.deploy|api\.mint/);
    }
  });
  it("shared launch copy is qualified", () => {
    expect(LAUNCH_COPY.feeSplitNote).toBe("60/15/15/10 is a validated launch configuration. It is not enforced on-chain.");
    expect(LAUNCH_COPY.readyTitle).toBe("READY FOR DEPLOYMENT");
    expect(LAUNCH_COPY.deploymentDisabled).toBe("On-chain deployment is not enabled in this beta.");
  });
});
