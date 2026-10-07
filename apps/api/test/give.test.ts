import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BANNED_PHRASES, Charity, CharityEvidenceResponse, DEMO_IDS, DonationDetail, DonationPlanResponse, DonationsResponse, Receipt } from "@project-name/shared";
import { makeCtx, makeOtherUser, bearer, W, type Ctx } from "./helpers";

let ctx: Ctx;
let other: Awaited<ReturnType<typeof makeOtherUser>>;
const SECRET_NOTE = "SECRET-ADMIN-NOTE-9f3a";
const SECRET_INTERNAL = "SECRET-INTERNAL-EVIDENCE-7c1d";
beforeAll(async () => {
  ctx = await makeCtx();
  other = await makeOtherUser(ctx.pool);
  // admin-only data that no public or user endpoint may ever return
  await ctx.pool.query("UPDATE charities SET verification_notes = $2 WHERE id = $1", [DEMO_IDS.charities.c4, SECRET_NOTE]);
  await ctx.pool.query(
    `INSERT INTO charity_verification_evidence (charity_id, source_type, source_ref, status, checked_at, verifier_user_id, public_summary, internal_notes, data_source)
     VALUES ($1,'FIXTURE','demo-fixture-2','INCONCLUSIVE', now(), $2, 'Fixture: still reviewing.', $3, 'demo')`,
    [DEMO_IDS.charities.c4, DEMO_IDS.admin, SECRET_INTERNAL],
  );
});
afterAll(async () => { await ctx.close(); });
const get = (url: string, token?: string) => ctx.app.inject({ url, headers: token ? bearer(token) : {} });
const authGet = (url: string, token = ctx.demoToken) => get(url, token);
const plan = (payload: unknown, token = ctx.demoToken) => ctx.app.inject({ method: "POST", url: "/api/donations/plan", payload: payload as object, headers: bearer(token) });
const C = DEMO_IDS.charities;
const RECEIPT_ID = "00000000-0000-4000-8000-000000000701";
const DONATION_WITH_RECEIPT = "00000000-0000-4000-8000-000000000501";
const count = async (table: string) => Number((await ctx.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

/** Runs a statement set in a transaction that is always rolled back; resolves to the error message (or null when it was accepted). */
async function attempt(statements: Array<[string, unknown[]?]>, commit = true): Promise<string | null> {
  const c = await ctx.pool.connect();
  try {
    await c.query("BEGIN");
    for (const [sql, params] of statements) await c.query(sql, params);
    if (commit) await c.query("SET CONSTRAINTS ALL IMMEDIATE");
    return null;
  } catch (e) {
    return (e as Error).message;
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
}
const newCharity = (over: { state?: string; source?: string | null; ds?: string; website?: string | null; logo?: string | null; slug?: string } = {}): [string, unknown[]] => [
  `INSERT INTO charities (id, slug, name, verification_state, verification_source, verification_checked_at, data_source, website, logo_url)
   VALUES ('00000000-0000-4000-8000-0000000009a1', $1, 'Test charity', $2, $3, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END, $4, $5, $6)`,
  [over.slug ?? "test-charity", over.state ?? "UNVERIFIED", over.source ?? null, over.ds ?? "database", over.website ?? null, over.logo ?? null],
];
const evidence = (type: string, status: string, ds: string): [string, unknown[]] => [
  `INSERT INTO charity_verification_evidence (charity_id, source_type, source_ref, status, checked_at, public_summary, data_source)
   VALUES ('00000000-0000-4000-8000-0000000009a1', $1, 'ref', $2, now(), 'summary', $3)`,
  [type, status, ds],
];

describe("charity registry (public)", () => {
  it("lists charities with explicit verification state, source, last-reviewed and evidence count", async () => {
    const r = await get("/api/charities");
    expect(r.statusCode).toBe(200);
    const list = (r.json().charities as unknown[]).map((c) => Charity.parse(c));
    expect(list).toHaveLength(4);
    expect(list.map((c) => c.verificationState).sort()).toEqual(["PENDING_REVIEW", "VERIFIED", "VERIFIED", "VERIFIED"]);
    expect(list.every((c) => c.dataSource === "demo")).toBe(true);
    for (const c of list.filter((x) => x.verificationState === "VERIFIED")) {
      expect(c.verificationSource).toBe("FIXTURE"); // never presented as a real source
      expect(c.lastReviewedAt).not.toBeNull();
      expect(c.evidenceCount).toBeGreaterThanOrEqual(1);
    }
    const pending = list.find((c) => c.id === C.c4)!;
    expect(pending.verificationSource).toBeNull();
    expect(pending.lastReviewedAt).not.toBeNull(); // last review comes from evidence, not from the verified flag
  });
  it("filters by verified; rejects junk", async () => {
    expect((await get("/api/charities?verified=true")).json().charities).toHaveLength(3);
    expect((await get("/api/charities?verified=false")).json().charities).toHaveLength(1);
    expect((await get("/api/charities?verified=maybe")).statusCode).toBe(400);
  });
  it("gets one; 404 unknown; 400 malformed", async () => {
    const one = Charity.parse((await get(`/api/charities/${C.c1}`)).json());
    expect(one.wallets).toHaveLength(1);
    expect(one.wallets[0]?.verificationStatus).toBe("verified");
    expect((await get(`/api/charities/${C.c1.replace(/1$/, "f")}`)).statusCode).toBe(404);
    expect((await get("/api/charities/abc")).statusCode).toBe(400);
  });
  it("evidence endpoint is public, labeled FIXTURE, and carries the caveat", async () => {
    const e = CharityEvidenceResponse.parse((await get(`/api/charities/${C.c1}/evidence`)).json());
    expect(e.evidence.length).toBeGreaterThanOrEqual(1);
    expect(e.evidence.every((x) => x.sourceType === "FIXTURE" && x.dataSource === "demo")).toBe(true);
    expect(e.evidence[0]!.publicSummary).toMatch(/not a real-world verification/i);
    expect(e.caveat).toMatch(/does not prove legitimacy/i);
    expect((await get(`/api/charities/${C.c1.replace(/1$/, "f")}/evidence`)).statusCode).toBe(404);
    expect((await get("/api/charities/abc/evidence")).statusCode).toBe(400);
  });
  it("never leaks admin-only verification notes, internal evidence notes, or verifier identity", async () => {
    const bodies = [
      (await get("/api/charities")).body, (await get(`/api/charities/${C.c4}`)).body, (await get(`/api/charities/${C.c4}/evidence`)).body,
      (await authGet("/api/charities")).body,
    ];
    for (const b of bodies) {
      expect(b).not.toContain(SECRET_NOTE);
      expect(b).not.toContain(SECRET_INTERNAL);
      expect(b).not.toContain(DEMO_IDS.admin);
      expect(b).not.toMatch(/verification_notes|internal_notes|verifier_user_id|verifierUserId|internalNotes/);
    }
    const ev = CharityEvidenceResponse.parse((await get(`/api/charities/${C.c4}/evidence`)).json());
    expect(ev.evidence.some((x) => x.reviewedBy === "ADMIN")).toBe(true); // the fact is public, the identity is not
  });
  it("public charity responses contain no donor information", async () => {
    for (const url of ["/api/charities", `/api/charities/${C.c1}`, `/api/charities/${C.c1}/evidence`]) {
      const b = (await get(url)).body;
      expect(b).not.toContain(DEMO_IDS.user);
      expect(b).not.toContain(other.userId);
      expect(b).not.toContain(W.trading);
      expect(b).not.toMatch(/donor|sourceWallet|usdReference|"donations"/i);
    }
  });
  it("returns hostile metadata as inert data with safe headers", async () => {
    const hostile = `<img src=x onerror=alert(1)>Evil‮ Name`;
    await ctx.pool.query("UPDATE charities SET name = $2 WHERE id = $1", [C.c3, hostile]);
    try {
      const r = await get(`/api/charities/${C.c3}`);
      expect(r.headers["content-type"]).toMatch(/application\/json/);
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      const c = Charity.parse(r.json());
      expect(c.name).not.toMatch(/[‮]/); // bidi override stripped
      expect(c.name).toContain("<img"); // kept as text: the UI renders text only, never HTML
    } finally {
      await ctx.pool.query("UPDATE charities SET name = 'Harvest Table Network (demo)' WHERE id = $1", [C.c3]);
    }
  });
});

describe("verification state model and provenance (database)", () => {
  it("a VERIFIED charity needs supporting evidence", async () => {
    const err = await attempt([newCharity({ state: "VERIFIED", source: "ADMIN_REVIEW" })]);
    expect(err).toMatch(/requires supporting evidence/);
  });
  it("a website claim alone can never support VERIFIED", async () => {
    const err = await attempt([newCharity({ state: "VERIFIED", source: "ADMIN_REVIEW" }), evidence("WEBSITE_CLAIM", "SUPPORTS", "database")]);
    expect(err).toMatch(/requires supporting evidence/);
  });
  it("evidence that does not support cannot support VERIFIED either", async () => {
    expect(await attempt([newCharity({ state: "VERIFIED", source: "ADMIN_REVIEW" }), evidence("ADMIN_REVIEW", "INCONCLUSIVE", "database")])).toMatch(/requires supporting evidence/);
  });
  it("real supporting evidence is accepted", async () => {
    expect(await attempt([newCharity({ state: "VERIFIED", source: "ADMIN_REVIEW" }), evidence("ADMIN_REVIEW", "SUPPORTS", "database")])).toBeNull();
  });
  it("VERIFIED needs a recorded source and review time", async () => {
    expect(await attempt([newCharity({ state: "VERIFIED", source: null }), evidence("ADMIN_REVIEW", "SUPPORTS", "database")])).toMatch(/charities_verified_has_provenance/);
  });
  it("FIXTURE provenance is possible only for demo data, in both directions", async () => {
    expect(await attempt([newCharity({ state: "VERIFIED", source: "FIXTURE", ds: "database" })])).toMatch(/charities_fixture_source_only_for_demo/);
    expect(await attempt([newCharity({ state: "VERIFIED", source: "ADMIN_REVIEW", ds: "demo" })])).toMatch(/charities_fixture_source_only_for_demo/);
    expect(await attempt([newCharity(), evidence("FIXTURE", "SUPPORTS", "database")])).toMatch(/evidence_fixture_iff_demo/);
    expect(await attempt([newCharity(), evidence("ADMIN_REVIEW", "SUPPORTS", "demo")])).toMatch(/evidence_fixture_iff_demo|must match the charity/);
    expect(await attempt([newCharity(), evidence("FIXTURE", "SUPPORTS", "demo")])).toMatch(/data_source must match the charity/);
  });
  it("unknown states and sources are rejected", async () => {
    expect(await attempt([newCharity({ state: "verified" })])).toMatch(/charities_state_check/);
    expect(await attempt([newCharity({ source: "GUESS" })])).toMatch(/charities_source_check/);
  });
  it("evidence is append-only", async () => {
    await expect(ctx.pool.query("UPDATE charity_verification_evidence SET status = 'SUPPORTS'")).rejects.toThrow();
    await expect(ctx.pool.query("DELETE FROM charity_verification_evidence")).rejects.toThrow();
  });
  it("unsafe URLs are rejected at the database", async () => {
    for (const website of ["javascript:alert(1)", "data:text/html,x", "ftp://x.test", "http://user:pw@x.test/ is bad", "http://user:pw@x.test/", "x.test"]) {
      expect(await attempt([newCharity({ website })]), website).toMatch(/charities_urls_check/);
    }
    expect(await attempt([newCharity({ logo: "http://x.test/logo.png" })])).toMatch(/charities_urls_check/); // logos must be https
    expect(await attempt([newCharity({ website: "https://example.org", logo: "https://example.org/l.png" })])).toBeNull();
  });
  it("slug is unique and well-formed", async () => {
    expect(await attempt([newCharity({ slug: "Bad Slug!" })])).toMatch(/charities_slug_check/);
    expect(await attempt([newCharity({ slug: "open-water-initiative-demo" })])).toMatch(/charities_slug_idx|duplicate key/);
  });
});

describe("donation records: no money movement, no fake confirmation", () => {
  it("there is no donation creation endpoint", async () => {
    const before = await count("donations");
    for (const method of ["POST", "PUT", "PATCH"] as const) {
      const r = await ctx.app.inject({ method, url: "/api/donations", payload: { walletId: W.trading, charityId: C.c1, amount: "1" }, headers: bearer(ctx.demoToken) });
      expect(r.statusCode, method).toBe(404);
    }
    expect(await count("donations")).toBe(before);
  });
  it("lists fixture donations as demo records: no transaction, no confirmation, labeled provenance", async () => {
    const d = DonationsResponse.parse((await authGet(`/api/donations/${W.trading}`)).json());
    expect(d.donations.length).toBeGreaterThanOrEqual(5);
    expect(d.donations.every((x) => x.status === "demo" && x.transactionSignature === null && x.donatedAt === null)).toBe(true);
    expect(d.donations.every((x) => x.dataSource === "demo" && x.provenance === "DEMO_FIXTURE" && x.usdReferenceSource === "FIXTURE")).toBe(true);
    expect(d.confirmedTotalCents).toBe("0");
    expect(d.demoTotalCents).not.toBe("0");
    expect(d.dataSource).toBe("demo");
    expect(d.verifiedOnChain).toBe(false);
    expect(d.taxNote).toMatch(/Potentially deductible/);
  });
  it("quantities are exact integer strings (USDC base units)", async () => {
    const d = DonationsResponse.parse((await authGet(`/api/donations/${W.trading}`)).json());
    const first = d.donations.find((x) => x.id === DONATION_WITH_RECEIPT)!;
    expect(first.quantity).toBe("500000000"); // $500.00 at 6 decimals
    expect(first.assetDecimals).toBe(6);
    expect(first.usdReferenceCents).toBe("50000");
  });
  it("a quantity above 2^53 survives the round trip without rounding", async () => {
    const big = "9007199254740993123456"; // > Number.MAX_SAFE_INTEGER
    const d = await ctx.pool.query(
      `INSERT INTO donations (user_id, charity_id, charity_wallet_id, source_wallet_id, asset_id, amount, status, data_source, provenance)
       VALUES ($1,$2,$3,$4,$5,$6,'draft','database','USER_PLAN') RETURNING id`,
      [other.userId, C.c1, DEMO_IDS.charityWallets.c1, other.walletId, DEMO_IDS.assetUsdc, big],
    );
    const r = DonationDetail.parse((await authGet(`/api/donations/by-id/${d.rows[0].id}`, other.token)).json());
    expect(r.donation.quantity).toBe(big);
    expect(r.donation.usdReferenceCents).toBeNull(); // a reference value is optional
    expect(r.donation.status).toBe("draft");
    expect(r.donation.transactionSignature).toBeNull();
    expect(r.receipt).toBeNull();
  });
  it("CONFIRMED requires a real indexed transaction of the donor wallet, chain data, and chain provenance", async () => {
    const base = (status: string, ds: string, prov: string, tx: string | null, at: string | null): [string, unknown[]] => [
      `INSERT INTO donations (user_id, charity_id, charity_wallet_id, source_wallet_id, asset_id, amount, status, data_source, provenance, raw_transaction_id, donated_at)
       VALUES ($1,$2,$3,$4,$5,1000000,$6,$7,$8,$9,$10)`,
      [other.userId, C.c1, DEMO_IDS.charityWallets.c1, other.walletId, DEMO_IDS.assetUsdc, status, ds, prov, tx, at],
    ];
    const REFUSED = /donations_(chain_provenance_needs_tx|confirmed_requires_tx|confirmed_is_chain|demo_is_fixture|demo_has_no_tx)/;
    expect(await attempt([base("confirmed", "chain", "CHAIN_INDEXED", null, "2026-09-01T00:00:00Z")])).toMatch(REFUSED);
    expect(await attempt([base("confirmed", "database", "USER_PLAN", null, "2026-09-01T00:00:00Z")])).toMatch(REFUSED);
    expect(await attempt([base("confirmed", "demo", "DEMO_FIXTURE", null, "2026-09-01T00:00:00Z")])).toMatch(REFUSED);

    // a raw transaction that exists but belongs to nobody (or to another wallet) cannot confirm a donation
    const rawId = "00000000-0000-4000-8000-0000000009b1";
    const rawTx: [string, unknown[]] = ["INSERT INTO raw_transactions (id, chain, signature, slot, block_time, payload) VALUES ($1,'solana','SIGDONATIONTEST1',1, now(), '{}')", [rawId]];
    expect(await attempt([rawTx, base("confirmed", "chain", "CHAIN_INDEXED", rawId, "2026-09-01T00:00:00Z")])).toMatch(/must be an indexed chain transaction of the donor wallet/);
    const derived: [string, unknown[]] = [
      "INSERT INTO transactions (raw_transaction_id, wallet_id, kind, data_source) VALUES ($1,$2,'transfer_out','chain')", [rawId, other.walletId],
    ];
    expect(await attempt([rawTx, derived, base("confirmed", "chain", "CHAIN_INDEXED", rawId, "2026-09-01T00:00:00Z")])).toBeNull();
    const foreign: [string, unknown[]] = ["INSERT INTO transactions (raw_transaction_id, wallet_id, kind, data_source) VALUES ($1,$2,'transfer_out','chain')", [rawId, W.trading]];
    expect(await attempt([rawTx, foreign, base("confirmed", "chain", "CHAIN_INDEXED", rawId, "2026-09-01T00:00:00Z")])).toMatch(/donor wallet/);
    // even with a genuine transaction, confirmation needs chain data, chain provenance and a donation time
    expect(await attempt([rawTx, derived, base("confirmed", "database", "USER_PLAN", rawId, "2026-09-01T00:00:00Z")])).toMatch(/donations_confirmed_is_chain/);
    expect(await attempt([rawTx, derived, base("confirmed", "chain", "USER_PLAN", rawId, "2026-09-01T00:00:00Z")])).toMatch(/donations_confirmed_is_chain/);
    expect(await attempt([rawTx, derived, base("confirmed", "chain", "CHAIN_INDEXED", rawId, null)])).toMatch(/donations_confirmed_is_chain/);
    // fixture rows can never carry a transaction
    expect(await attempt([rawTx, derived, base("demo", "demo", "DEMO_FIXTURE", rawId, null)])).toMatch(REFUSED);
  });
  it("fixture data and the demo status are inseparable", async () => {
    const row = (status: string, ds: string, prov: string): [string, unknown[]] => [
      `INSERT INTO donations (user_id, charity_id, charity_wallet_id, source_wallet_id, asset_id, amount, status, data_source, provenance)
       VALUES ($1,$2,$3,$4,$5,1000000,$6,$7,$8)`,
      [other.userId, C.c1, DEMO_IDS.charityWallets.c1, other.walletId, DEMO_IDS.assetUsdc, status, ds, prov],
    ];
    expect(await attempt([row("demo", "database", "USER_PLAN")])).toMatch(/donations_demo_is_fixture/);
    expect(await attempt([row("pending", "demo", "DEMO_FIXTURE")])).toMatch(/donations_demo_is_fixture/);
    expect(await attempt([row("draft", "database", "DEMO_FIXTURE")])).toMatch(/donations_demo_is_fixture/);
    expect(await attempt([row("draft", "database", "USER_PLAN")])).toBeNull();
  });
  it("a USD reference value must say where it came from; negatives are rejected", async () => {
    const row = (usd: number, src: string | null): [string, unknown[]] => [
      `INSERT INTO donations (user_id, charity_id, charity_wallet_id, source_wallet_id, asset_id, amount, usd_value_cents, usd_reference_source, status, data_source, provenance)
       VALUES ($1,$2,$3,$4,$5,1000000,$6,$7,'draft','database','USER_PLAN')`,
      [other.userId, C.c1, DEMO_IDS.charityWallets.c1, other.walletId, DEMO_IDS.assetUsdc, usd, src],
    ];
    expect(await attempt([row(100, null)])).toMatch(/donations_usd_has_source/);
    expect(await attempt([row(-1, "FIXTURE")])).toMatch(/donations_usd_nonneg/);
  });
});

describe("donation and receipt authorization (no IDOR)", () => {
  it("history is owner-scoped by wallet", async () => {
    expect((await authGet(`/api/donations/${W.trading}`, other.token)).statusCode).toBe(404);
    expect((await authGet(`/api/donations/${other.walletId}`)).statusCode).toBe(404);
    expect((await get(`/api/donations/${W.trading}`)).statusCode).toBe(401);
    expect((await authGet("/api/donations/not-a-uuid")).statusCode).toBe(400);
  });
  it("donation detail is owner-scoped; foreign, unknown and unauthenticated are all refused alike", async () => {
    const ok = DonationDetail.parse((await authGet(`/api/donations/by-id/${DONATION_WITH_RECEIPT}`)).json());
    expect(ok.donation.id).toBe(DONATION_WITH_RECEIPT);
    expect(ok.donation.receiptId).toBe(RECEIPT_ID);
    const foreign = await authGet(`/api/donations/by-id/${DONATION_WITH_RECEIPT}`, other.token);
    const unknown = await authGet("/api/donations/by-id/00000000-0000-4000-8000-0000000fffff", other.token);
    expect(foreign.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe(unknown.json().error.code); // existence is not revealed
    expect((await get(`/api/donations/by-id/${DONATION_WITH_RECEIPT}`)).statusCode).toBe(401);
    expect((await authGet("/api/donations/by-id/nope")).statusCode).toBe(400);
  });
  it("receipt detail is owner-scoped", async () => {
    const r = Receipt.parse((await authGet(`/api/receipts/${RECEIPT_ID}`)).json());
    expect(r.donationId).toBe(DONATION_WITH_RECEIPT);
    expect((await authGet(`/api/receipts/${RECEIPT_ID}`, other.token)).statusCode).toBe(404);
    expect((await get(`/api/receipts/${RECEIPT_ID}`)).statusCode).toBe(401);
    expect((await authGet("/api/receipts/zzz")).statusCode).toBe(400);
  });
  it("a fixture receipt is labeled and is not presented as a tax receipt or as verified", async () => {
    const r = Receipt.parse((await authGet(`/api/receipts/${RECEIPT_ID}`)).json());
    expect(r.dataSource).toBe("demo");
    expect(r.labels).toEqual(["DEMO RECEIPT", "FIXTURE DATA", "NOT A TAX RECEIPT"]);
    expect(r.verificationState).toBe("UNVERIFIED");
    expect(r.caveat).toMatch(/does not prove that a contribution is deductible/);
    expect(r.documentUrl).toBeNull();
  });
  it("responses are not cacheable and carry no session or secret material", async () => {
    for (const url of [`/api/donations/${W.trading}`, `/api/donations/by-id/${DONATION_WITH_RECEIPT}`, `/api/receipts/${RECEIPT_ID}`]) {
      const r = await authGet(url);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.body).not.toContain(ctx.demoToken);
      expect(r.body).not.toMatch(/rpc|token_hash|session|secret/i);
    }
  });
  it("a real wallet with no donations gets an honest empty list, not fixture history", async () => {
    const d = DonationsResponse.parse((await authGet(`/api/donations/${other.walletId}`, other.token)).json());
    expect(d.donations.filter((x) => x.dataSource === "demo")).toHaveLength(0);
    expect(d.dataSource).toBe("database");
    expect(d.confirmedTotalCents).toBe("0");
    expect(d.demoTotalCents).toBe("0");
  });
});

describe("receipt rules (database)", () => {
  const receipt = (donationId: string, over: { ds?: string; state?: string; hash?: string | null; doc?: string | null } = {}): [string, unknown[]] => [
    `INSERT INTO donation_receipts (donation_id, receipt_reference, verification_state, data_source, receipt_hash, document_url)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [donationId, `R-${Math.random().toString(36).slice(2)}`, over.state ?? "UNVERIFIED", over.ds ?? "database", over.hash ?? null, over.doc ?? null],
  ];
  const draftDonation = (): [string, unknown[]] => [
    `INSERT INTO donations (id, user_id, charity_id, charity_wallet_id, source_wallet_id, asset_id, amount, status, data_source, provenance)
     VALUES ('00000000-0000-4000-8000-0000000009c1',$1,$2,$3,$4,$5,1000000,'draft','database','USER_PLAN')`,
    [other.userId, C.c1, DEMO_IDS.charityWallets.c1, other.walletId, DEMO_IDS.assetUsdc],
  ];
  it("a real receipt cannot exist for a donation that is not confirmed", async () => {
    expect(await attempt([draftDonation(), receipt("00000000-0000-4000-8000-0000000009c1")])).toMatch(/requires a confirmed donation/);
  });
  it("a receipt must share its donation's data source (no fixture receipt on a real donation, or the reverse)", async () => {
    expect(await attempt([draftDonation(), receipt("00000000-0000-4000-8000-0000000009c1", { ds: "demo" })])).toMatch(/must match its donation/);
    expect(await attempt([receipt(DONATION_WITH_RECEIPT.replace(/1$/, "2"), { ds: "database" })])).toMatch(/must match its donation/);
  });
  it("a fixture receipt can never be marked verified", async () => {
    expect(await attempt([receipt(DONATION_WITH_RECEIPT.replace(/1$/, "2"), { ds: "demo", state: "VERIFIED" })])).toMatch(/receipts_demo_never_verified/);
  });
  it("hash and document URL formats are enforced", async () => {
    expect(await attempt([receipt(DONATION_WITH_RECEIPT.replace(/1$/, "2"), { ds: "demo", hash: "xyz" })])).toMatch(/receipt_hash/);
    expect(await attempt([receipt(DONATION_WITH_RECEIPT.replace(/1$/, "2"), { ds: "demo", doc: "javascript:alert(1)" })])).toMatch(/document_url/);
    expect(await attempt([receipt(DONATION_WITH_RECEIPT.replace(/1$/, "2"), { ds: "demo", doc: "http://x.test/r.pdf" })])).toMatch(/document_url/); // https only
  });
});

describe("donation plan: review only, nothing happens", () => {
  it("returns a review that is never persisted and never enabled", async () => {
    const donationsBefore = await count("donations");
    const rawBefore = await count("raw_transactions");
    const r = await plan({ walletId: W.trading, charityId: C.c2, amount: "25.50" });
    expect(r.statusCode).toBe(200);
    const p = DonationPlanResponse.parse(r.json());
    expect(p).toMatchObject({ transfersEnabled: false, persisted: false, verifiedOnChain: false, quantity: "25500000", usdReferenceCents: "2550", usdReferenceSource: "USER_ENTERED_USDC_PAR" });
    expect(p.disabledReason).toBe("Donation transfers are not enabled in this beta.");
    expect(p.charity).toMatchObject({ id: C.c2, verificationState: "VERIFIED", verificationSource: "FIXTURE", dataSource: "demo", eligible: true });
    expect(p.signingNote).toMatch(/Nothing is signed or sent now/);
    expect(p.usdReferenceNote).toMatch(/not automatically the deductible amount/);
    expect(p.taxNote).toMatch(/Potentially deductible charitable contribution/);
    expect(JSON.stringify(p)).not.toMatch(/signature|txid/i);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(await count("donations")).toBe(donationsBefore);
    expect(await count("raw_transactions")).toBe(rawBefore);
  });
  it("marks an unverified charity as not eligible, with the reason", async () => {
    const p = DonationPlanResponse.parse((await plan({ walletId: W.trading, charityId: C.c4, amount: "10" })).json());
    expect(p.charity.eligible).toBe(false);
    expect(p.charity.verificationState).toBe("PENDING_REVIEW");
    expect(p.charity.blockedReason).toMatch(/PENDING REVIEW/);
    expect(p.transfersEnabled).toBe(false);
  });
  it("is authenticated and owner-scoped; 404s unknown charities", async () => {
    expect((await ctx.app.inject({ method: "POST", url: "/api/donations/plan", payload: { walletId: W.trading, charityId: C.c1, amount: "1" } })).statusCode).toBe(401);
    expect((await plan({ walletId: other.walletId, charityId: C.c1, amount: "10" })).statusCode).toBe(404);
    expect((await plan({ walletId: W.trading, charityId: C.c1, amount: "10" }, other.token)).statusCode).toBe(404);
    expect((await plan({ walletId: W.trading, charityId: C.c1.replace(/1$/, "e"), amount: "10" })).statusCode).toBe(404);
  });
  it("validates the body strictly (no status, no signature, no extra fields, exact amounts)", async () => {
    for (const body of [
      {}, { walletId: "x", charityId: C.c1, amount: "10" }, { walletId: W.trading, charityId: C.c1, amount: "0" },
      { walletId: W.trading, charityId: C.c1, amount: "-5" }, { walletId: W.trading, charityId: C.c1, amount: "1.999" },
      { walletId: W.trading, charityId: C.c1, amount: "abc" }, { walletId: W.trading, charityId: C.c1, amount: 10 },
      { walletId: W.trading, charityId: C.c1, amount: "10", status: "confirmed" }, { walletId: W.trading, charityId: C.c1, amount: "10", signature: "x" },
      { walletId: W.trading, charityId: C.c1, amount: "10", asset: "SOL" },
    ]) {
      const r = await plan(body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(r.json().error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("tax language", () => {
  it("no Give API response contains a banned phrase, and donation tax text stays qualified", async () => {
    const bodies = [
      (await get("/api/charities")).body, (await get(`/api/charities/${C.c1}/evidence`)).body, (await authGet(`/api/donations/${W.trading}`)).body,
      (await authGet(`/api/donations/by-id/${DONATION_WITH_RECEIPT}`)).body, (await authGet(`/api/receipts/${RECEIPT_ID}`)).body,
      (await plan({ walletId: W.trading, charityId: C.c1, amount: "5" })).body,
    ].map((b) => b.toLowerCase());
    for (const b of bodies) for (const p of BANNED_PHRASES) expect(b).not.toContain(p);
    expect(bodies[2]).toContain("consult a tax professional");
    for (const b of bodies) expect(b).not.toMatch(/tax write-off|deductible donation|guaranteed/);
  });
});
