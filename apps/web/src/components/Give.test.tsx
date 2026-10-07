import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import {
  BANNED_PHRASES, CharityEvidenceResponse, DEMO_IDS, DEMO_RECEIPT, DonationDetail, DonationPlanResponse, Receipt, buildCharityEvidence, buildCharityList,
  buildDonationDetail, buildDonationPlan, buildDonations, type Charity as ApiCharity, type DonationsResponse,
} from "@project-name/shared";
import { describe, expect, it, vi } from "vitest";
import { charityFromApi } from "@/lib/adapters";
import { createApiClient } from "@/lib/api/client";
import { CharityCard, verificationBadge } from "./CharityCard";
import { CharityDetailView, DonationDetailView, DonationPlanView, EvidenceList, ReceiptView, filterCharities } from "./GivePanels";
import { CharityDirectory, DonationHistory, donationStatusView, receiptStatusLabel } from "./screens/GiveScreen";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const W = DEMO_IDS.wallets.trading;
const api0 = buildCharityList()[0]!;
const fromApi = (over: Partial<ApiCharity> = {}) => charityFromApi({ ...api0, ...over });

describe("charity registry UI", () => {
  it("uses the required vocabulary, never 'safe' or 'guaranteed'", () => {
    const out = html(<CharityDirectory charities={buildCharityList().map(charityFromApi)} donations={null} />).toLowerCase();
    for (const w of ["verification status", "verification source", "last reviewed", "evidence"]) expect(out).toContain(w);
    expect(out).not.toMatch(/\bsafe\b|guarantee|irs approved|legitimate/);
  });
  it("a fixture verification is labeled fixture and uses the demo tone, never the 'good' tone", () => {
    const c = fromApi();
    expect(verificationBadge(c)).toEqual({ label: "VERIFIED (FIXTURE, NOT REAL-WORLD)", tone: "demo" });
    const real = fromApi({ dataSource: "database", verificationSource: "ADMIN_REVIEW" });
    expect(verificationBadge(real)).toEqual({ label: "VERIFIED", tone: "good" });
    expect(verificationBadge(fromApi({ verificationState: "SUSPENDED" })).tone).toBe("bad");
    expect(verificationBadge(fromApi({ verificationState: "UNVERIFIED", verificationSource: null })).label).toBe("UNVERIFIED");
  });
  it("hostile charity text renders as inert text and unsafe URLs are never linked", () => {
    const hostile = fromApi({ name: `<img src=x onerror=alert(1)>`, description: `<script>alert(1)</script>`, website: "javascript:alert(1)" });
    expect(hostile.website).toBeNull();
    const out = html(<CharityCard charity={hostile} confirmedCents={0n} demoCents={0n} />);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
    const detail = html(<CharityDetailView charity={hostile} evidence={null} />);
    expect(detail).not.toContain("href=\"javascript");
    expect(detail).not.toContain("<script");
    const ok = fromApi({ website: "https://example.org/about" });
    const withSite = html(<CharityDetailView charity={ok} evidence={null} />);
    expect(withSite).toContain('href="https://example.org/about"');
    expect(withSite).toContain("noopener noreferrer nofollow");
    expect(withSite).toContain("not verified by us");
  });
  it("does not render logos at all (no third-party image requests)", () => {
    const out = html(<CharityDetailView charity={fromApi()} evidence={null} />);
    expect(out).not.toContain("<img");
  });
  it("search and status filter work on plain text", () => {
    const list = buildCharityList().map(charityFromApi);
    expect(filterCharities(list, "", "ALL")).toHaveLength(4);
    expect(filterCharities(list, "water", "ALL").map((c) => c.name)).toEqual(["Open Water Initiative (demo)"]);
    expect(filterCharities(list, "", "PENDING_REVIEW")).toHaveLength(1);
    expect(filterCharities(list, "", "SUSPENDED")).toHaveLength(0);
    expect(filterCharities(list, "<script>", "ALL")).toHaveLength(0);
  });
});

describe("evidence UI", () => {
  it("shows source, status, last checked and the caveat; unsafe evidence URLs are not linked", () => {
    const base = CharityEvidenceResponse.parse(buildCharityEvidence(DEMO_IDS.charities.c1));
    const out = html(<EvidenceList data={base} />);
    expect(out).toContain("FIXTURE");
    expect(out).toContain("Checked");
    expect(out).toContain("does not prove legitimacy");
    const hostile = { ...base, evidence: [{ ...base.evidence[0]!, sourceUrl: "javascript:alert(1)", sourceRef: "<b>x</b>" }] };
    const bad = html(<EvidenceList data={hostile as CharityEvidenceResponse} />);
    expect(bad).not.toContain('href="javascript');
    expect(bad).not.toContain("<b>x");
  });
});

describe("donation history UI", () => {
  const charities = buildCharityList().map(charityFromApi);
  it("a real wallet with no donations says NO DONATIONS YET and shows no demo labels", () => {
    const empty: DonationsResponse = { walletId: W, donations: [], confirmedTotalCents: "0", demoTotalCents: "0", taxNote: "n", dataSource: "database", verifiedOnChain: false };
    const out = html(<DonationHistory data={empty} charities={charities} />);
    expect(out).toContain("NO DONATIONS YET");
    expect(out).not.toContain("DEMO");
    expect(out).not.toContain("<table");
  });
  it("the demo wallet stays explicitly DEMO DATA and never looks confirmed", () => {
    const out = html(<DonationHistory data={buildDonations(W)!} charities={charities} />);
    expect(out).toContain("DEMO DATA");
    expect(out).toContain("DEMO RECORD · NOT ON-CHAIN");
    expect(out).toContain("DEMO RECEIPT · NOT A TAX RECEIPT");
    expect(out).not.toContain("CONFIRMED ON-CHAIN");
    expect(out).not.toMatch(/DEMO-SIG|signature/i);
  });
  it("only 'confirmed' claims an on-chain transaction", () => {
    for (const s of ["draft", "pending", "failed", "cancelled", "demo"] as const) expect(donationStatusView(s).label).not.toMatch(/^CONFIRMED/);
    expect(donationStatusView("confirmed").label).toBe("CONFIRMED ON-CHAIN");
    expect(donationStatusView("demo").tone).toBe("demo");
    expect(donationStatusView("draft").label).toMatch(/NOT SENT/);
  });
  it("receipt status wording", () => {
    expect(receiptStatusLabel({ receiptId: null, receiptStatus: null, dataSource: "database" })).toBe("No receipt");
    expect(receiptStatusLabel({ receiptId: "x", receiptStatus: "CHARITY_REPORTED", dataSource: "database" })).toBe("Receipt CHARITY REPORTED");
  });
  it("amounts keep exact integer precision above 2^53", () => {
    const d = buildDonations(W)!;
    const big = { ...d, donations: [{ ...d.donations[0]!, quantity: "9007199254740993123456", assetDecimals: 6, usdReferenceCents: "900719925474099312" }] };
    const out = html(<DonationHistory data={big} charities={charities} />);
    expect(out).toContain("9,007,199,254,740,993.12"); // 2 decimals shown, nothing rounded through floats
    expect(out).toContain("$9,007,199,254,740,993");
  });
});

describe("donation review (no transfer)", () => {
  const charity = buildCharityList()[1]!;
  const plan = (over: Partial<Parameters<typeof buildDonationPlan>[0]> = {}) =>
    DonationPlanResponse.parse(buildDonationPlan({ walletId: W, charity, hasVerifiedWalletForAsset: true, amountUsdCents: 2550n, walletDataSource: "demo", ...over }));
  it("shows the review facts, discloses fees and signing, and the final action is disabled", () => {
    const out = html(<DonationPlanView plan={plan()} />);
    for (const t of ["Clear Sky Education Fund", "USDC", "25.5", "$25.50", "Network fee", "Potentially deductible charitable contribution", "not automatically the deductible amount",
      "explicitly sign", "Donation transfers are not enabled in this beta.", "REVIEW ONLY · NOTHING SENT"]) expect(out, t).toContain(t);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>CONFIRM DONATION/);
  });
  it("never simulates success or invents a signature", () => {
    const out = html(<DonationPlanView plan={plan()} />).toLowerCase();
    expect(out).not.toMatch(/success|thank you|donated|transaction id|signature:|confirmed/);
  });
  it("shows why an unverified charity is blocked", () => {
    const out = html(<DonationPlanView plan={plan({ charity: { ...charity, verificationState: "PENDING_REVIEW", verificationSource: null } })} />);
    expect(out).toContain("PENDING REVIEW");
    expect(out).toMatch(/verification status is PENDING REVIEW/);
  });
});

describe("receipt UI", () => {
  const detail = DonationDetail.parse(buildDonationDetail(DEMO_RECEIPT.donationId));
  it("a fixture receipt carries the three labels and the deductibility caveat", () => {
    const out = html(<DonationDetailView detail={detail} />);
    for (const t of ["DEMO RECEIPT", "FIXTURE DATA", "NOT A TAX RECEIPT", "does not prove that a contribution is deductible", "None. No transaction exists for this record."]) expect(out, t).toContain(t);
    expect(out).toContain("Potentially deductible");
  });
  it("a hostile document URL is never linked", () => {
    const r = { ...detail.receipt!, documentUrl: "javascript:alert(1)" } as Receipt;
    expect(html(<ReceiptView receipt={r} />)).not.toContain('href="javascript');
    const ok = { ...detail.receipt!, documentUrl: "https://example.org/r.pdf" } as Receipt;
    expect(html(<ReceiptView receipt={ok} />)).toContain('href="https://example.org/r.pdf"');
    const insecure = { ...detail.receipt!, documentUrl: "http://example.org/r.pdf" } as Receipt;
    expect(html(<ReceiptView receipt={insecure} />)).not.toContain("href=");
  });
  it("a donation without a receipt says so", () => {
    expect(html(<DonationDetailView detail={{ ...detail, receipt: null }} />)).toContain("No receipt recorded");
  });
});

describe("mock client: Give", () => {
  const c = createApiClient({ mode: "mock", fetchImpl: vi.fn() as unknown as typeof fetch });
  it("plans a donation locally: not persisted, not enabled, no network", async () => {
    const f = vi.fn();
    const mc = createApiClient({ mode: "mock", fetchImpl: f as unknown as typeof fetch });
    const p = await mc.planDonation({ walletId: "w1", charityId: DEMO_IDS.charities.c1, amount: "10" });
    expect(p).toMatchObject({ transfersEnabled: false, persisted: false, quantity: "10000000", dataSource: "demo" });
    expect(f).not.toHaveBeenCalled();
    await expect(mc.planDonation({ walletId: "w1", charityId: DEMO_IDS.charities.c1, amount: "0" })).rejects.toMatchObject({ status: 400 });
    await expect(mc.planDonation({ walletId: "w1", charityId: "nope", amount: "5" })).rejects.toMatchObject({ status: 404 });
  });
  it("reads evidence, donation detail and receipts from fixtures; unknown ids are 404", async () => {
    expect((await c.getCharityEvidence(DEMO_IDS.charities.c1)).evidence.length).toBeGreaterThan(0);
    expect((await c.getDonation(DEMO_RECEIPT.donationId)).receipt?.id).toBe(DEMO_RECEIPT.id);
    expect((await c.getReceipt(DEMO_RECEIPT.id)).labels).toContain("NOT A TAX RECEIPT");
    for (const f of [() => c.getReceipt("00000000-0000-4000-8000-0000000fffff"), () => c.getDonation("00000000-0000-4000-8000-0000000fffff"), () => c.getDonations("00000000-0000-4000-8000-0000000fffff")]) {
      await expect(f()).rejects.toMatchObject({ status: 404 });
    }
  });
});

describe("tax language lint over Give UI sources", () => {
  const files = ["components/CharityCard.tsx", "components/GivePanels.tsx", "components/screens/GiveScreen.tsx"].map((f) => readFileSync(join(__dirname, "..", f), "utf8").toLowerCase());
  it("contains no banned phrase and no unqualified tax claim", () => {
    for (const t of files) {
      for (const p of BANNED_PHRASES) expect(t, p).not.toContain(p);
      expect(t).not.toMatch(/tax[- ]deductible|write-off|tax benefit/);
    }
  });
  it("renders no external image and no raw HTML injection", () => {
    for (const t of files) {
      expect(t).not.toContain("dangerouslysetinnerhtml");
      expect(t).not.toContain("<img");
    }
  });
});
