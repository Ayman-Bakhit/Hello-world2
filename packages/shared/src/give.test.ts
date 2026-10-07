import { describe, expect, it } from "vitest";
import {
  BANNED_PHRASES, CHARITY_VERIFICATION_STATES, CharityEvidenceResponse, Charity, DONATION_STATUSES, DONATION_TAX_NOTE, DonationDetail, DonationPlanRequest,
  DonationPlanResponse, DonationsResponse, GIVE_COPY, Receipt, VERIFYING_SOURCE_TYPES, buildCharityEvidence, buildCharityList, buildDonationDetail,
  buildDonationPlan, buildDonations, buildReceipt, cleanText, DEMO_IDS, DEMO_RECEIPT, donationInvariantViolation, isRealWorldVerified, safeHttpUrl,
  verificationLabel,
} from "./index";

describe("charity verification model", () => {
  it("has explicit states, not booleans", () => {
    expect([...CHARITY_VERIFICATION_STATES]).toEqual(["UNVERIFIED", "PENDING_REVIEW", "VERIFIED", "SUSPENDED"]);
  });
  it("a website claim is never a verifying source", () => {
    expect(VERIFYING_SOURCE_TYPES).not.toContain("WEBSITE_CLAIM");
  });
  it("a fixture verification is never real-world verified and is labeled as such", () => {
    expect(isRealWorldVerified("VERIFIED", "FIXTURE")).toBe(false);
    expect(isRealWorldVerified("VERIFIED", null)).toBe(false);
    expect(isRealWorldVerified("VERIFIED", "WEBSITE_CLAIM")).toBe(false);
    expect(isRealWorldVerified("PENDING_REVIEW", "ADMIN_REVIEW")).toBe(false);
    expect(isRealWorldVerified("SUSPENDED", "ADMIN_REVIEW")).toBe(false);
    expect(isRealWorldVerified("VERIFIED", "ADMIN_REVIEW")).toBe(true);
    expect(isRealWorldVerified("VERIFIED", "REGISTRY_LOOKUP")).toBe(true);
    expect(verificationLabel("VERIFIED", "FIXTURE")).toMatch(/FIXTURE, NOT REAL-WORLD/);
    expect(verificationLabel("VERIFIED", "ADMIN_REVIEW")).toBe("VERIFIED");
    expect(verificationLabel("SUSPENDED", null)).toBe("SUSPENDED");
  });
});

describe("donation invariants", () => {
  it("CONFIRMED needs a transaction signature and chain data", () => {
    expect(donationInvariantViolation({ status: "confirmed", dataSource: "chain", transactionSignature: null })).toMatch(/requires an on-chain transaction/);
    expect(donationInvariantViolation({ status: "confirmed", dataSource: "database", transactionSignature: "SIG" })).toMatch(/indexed chain data/);
    expect(donationInvariantViolation({ status: "confirmed", dataSource: "demo", transactionSignature: "SIG" })).not.toBeNull();
    expect(donationInvariantViolation({ status: "confirmed", dataSource: "chain", transactionSignature: "SIG" })).toBeNull();
  });
  it("fixture data and demo status go together, and a demo record has no transaction", () => {
    expect(donationInvariantViolation({ status: "demo", dataSource: "database", transactionSignature: null })).not.toBeNull();
    expect(donationInvariantViolation({ status: "draft", dataSource: "demo", transactionSignature: null })).not.toBeNull();
    expect(donationInvariantViolation({ status: "demo", dataSource: "demo", transactionSignature: "SIG" })).not.toBeNull();
    expect(donationInvariantViolation({ status: "demo", dataSource: "demo", transactionSignature: null })).toBeNull();
  });
  it("covers the required lifecycle statuses", () => {
    for (const s of ["draft", "pending", "confirmed", "failed", "cancelled"]) expect(DONATION_STATUSES).toContain(s);
  });
});

describe("untrusted metadata", () => {
  it("accepts plain http(s) URLs and normalizes them", () => {
    expect(safeHttpUrl("https://example.org/a?b=1")).toBe("https://example.org/a?b=1");
    expect(safeHttpUrl("http://example.org")).toBe("http://example.org/");
    expect(safeHttpUrl("http://example.org", { httpsOnly: true })).toBeNull();
  });
  it("rejects dangerous and malformed URLs", () => {
    for (const bad of [
      "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "file:///etc/passwd", "ftp://x.test", "//evil.test",
      "https://user:pw@example.org", "https://example.org/a b", "https://example.org/\n", "https://", "not a url", "", " https://example.org", "https://example.org/‮",
      `https://example.org/${"a".repeat(600)}`,
    ]) expect(safeHttpUrl(bad), JSON.stringify(bad)).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
  it("cleans text: control and bidi characters out, whitespace collapsed, length capped", () => {
    expect(cleanText("a‮b\u0000c\n\n d", 50)).toBe("a b c d");
    expect(cleanText("x".repeat(500), 10)).toHaveLength(10);
    expect(cleanText("<img src=x onerror=alert(1)>", 100)).toBe("<img src=x onerror=alert(1)>"); // text is kept as text; rendering never uses HTML
  });
});

describe("Give contracts and fixture builders", () => {
  it("fixture charities parse, are demo, and verified ones rest on FIXTURE evidence", () => {
    const list = buildCharityList().map((c) => Charity.parse(c));
    expect(list).toHaveLength(4);
    for (const c of list) {
      expect(c.dataSource).toBe("demo");
      if (c.verificationState === "VERIFIED") {
        expect(c.verificationSource).toBe("FIXTURE");
        const ev = CharityEvidenceResponse.parse(buildCharityEvidence(c.id));
        expect(ev.evidence.every((e) => e.sourceType === "FIXTURE")).toBe(true);
        expect(ev.evidence.some((e) => e.status === "SUPPORTS")).toBe(true);
      }
      expect(isRealWorldVerified(c.verificationState, c.verificationSource)).toBe(false);
    }
    expect(buildCharityEvidence("00000000-0000-4000-8000-0000000fffff")).toBeNull();
  });
  it("fixture donations are demo records: no signature, never confirmed", () => {
    const d = DonationsResponse.parse(buildDonations(DEMO_IDS.wallets.trading));
    expect(d.donations.length).toBeGreaterThan(0);
    for (const x of d.donations) {
      expect(x).toMatchObject({ status: "demo", transactionSignature: null, dataSource: "demo", provenance: "DEMO_FIXTURE" });
      expect(donationInvariantViolation({ status: x.status, dataSource: x.dataSource, transactionSignature: x.transactionSignature })).toBeNull();
    }
    expect(d.confirmedTotalCents).toBe("0");
    expect(buildDonations("00000000-0000-4000-8000-0000000fffff")).toBeNull();
  });
  it("fixture receipt is labeled and never verified", () => {
    const r = Receipt.parse(buildReceipt(DEMO_RECEIPT.id));
    expect(r.labels).toEqual([GIVE_COPY.demoReceipt, GIVE_COPY.fixtureData, GIVE_COPY.notTaxReceipt]);
    expect(r.verificationState).toBe("UNVERIFIED");
    expect(DonationDetail.parse(buildDonationDetail(DEMO_RECEIPT.donationId)).receipt?.id).toBe(DEMO_RECEIPT.id);
    expect(buildReceipt("00000000-0000-4000-8000-0000000fffff")).toBeNull();
  });
  it("the plan is stateless, disabled, precise and conservative", () => {
    const charity = buildCharityList()[0]!;
    const p = DonationPlanResponse.parse(buildDonationPlan({ walletId: DEMO_IDS.wallets.trading, charity, hasVerifiedWalletForAsset: true, amountUsdCents: 123_456_789_012n, walletDataSource: "demo" }));
    expect(p.quantity).toBe("1234567890120000"); // exact integer math, beyond float-safe range for cents * 10^4
    expect(p.transfersEnabled).toBe(false);
    expect(p.persisted).toBe(false);
    expect(p.disabledReason).toBe(GIVE_COPY.transfersDisabled);
    expect(p.charity.eligible).toBe(true);
    const blocked = buildDonationPlan({ walletId: DEMO_IDS.wallets.trading, charity: { ...charity, verificationState: "SUSPENDED" }, hasVerifiedWalletForAsset: true, amountUsdCents: 100n, walletDataSource: "demo" });
    expect(blocked.charity.eligible).toBe(false);
    expect(blocked.charity.blockedReason).toMatch(/SUSPENDED/);
    const noWallet = buildDonationPlan({ walletId: DEMO_IDS.wallets.trading, charity, hasVerifiedWalletForAsset: false, amountUsdCents: 100n, walletDataSource: "demo" });
    expect(noWallet.charity.eligible).toBe(false);
  });
  it("the plan request is strict and amounts are exact decimals", () => {
    const ok = { walletId: DEMO_IDS.wallets.trading, charityId: DEMO_IDS.charities.c1, amount: "10.25" };
    expect(DonationPlanRequest.safeParse(ok).success).toBe(true);
    for (const bad of [{ ...ok, amount: "1e3" }, { ...ok, amount: "0.00" }, { ...ok, amount: "1.234" }, { ...ok, status: "confirmed" }, { ...ok, signature: "x" }, { ...ok, asset: "SOL" }]) {
      expect(DonationPlanRequest.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("tax language", () => {
  it("Give copy and fixture text avoid banned phrases and keep donation tax statements qualified", () => {
    const text = [
      ...Object.values(GIVE_COPY), DONATION_TAX_NOTE, JSON.stringify(buildCharityList()), JSON.stringify(buildDonations(DEMO_IDS.wallets.trading)),
      JSON.stringify(buildCharityEvidence(DEMO_IDS.charities.c1)), JSON.stringify(buildReceipt(DEMO_RECEIPT.id)),
    ].join(" ").toLowerCase();
    for (const p of BANNED_PHRASES) expect(text).not.toContain(p);
    expect(GIVE_COPY.taxNote).toMatch(/Potentially deductible/);
    expect(GIVE_COPY.taxNote).toMatch(/Consult a tax professional/);
    expect(GIVE_COPY.usdReference).toMatch(/not automatically the deductible amount/);
    expect(GIVE_COPY.receiptCaveat).toMatch(/does not prove/);
    expect(GIVE_COPY.verificationStatus).not.toMatch(/safe|guarantee/i);
  });
  it("the banned list covers the Slice 9 phrases", () => {
    for (const p of ["tax write-off", "guaranteed deduction", "tax loophole", "guaranteed tax benefit", "deductible donation", "guaranteed legitimate", "guaranteed tax deductible", "irs approved", "safe charity"]) {
      expect(BANNED_PHRASES).toContain(p);
    }
  });
});
