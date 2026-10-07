import type { Charity, CharityEvidenceResponse, Donation, Launch, LaunchConfig, LaunchReview, Receipt, Wallet } from "@project-name/shared";
import { DONATION_TAX_NOTE, GIVE_COPY, cleanText, safeHttpUrl, type StoredTarget } from "@project-name/shared";
import type { Pool } from "./pool";

/**
 * All SQL lives here, parameterized. Every user-scoped function takes the actor's user id and
 * filters by it: that filter IS the authorization boundary for wallet/donation/launch data.
 */

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

// ---------- wallets ----------
const walletOf = (r: Record<string, unknown>): Wallet => ({
  id: r.id as string,
  chain: "solana",
  address: r.address as string,
  label: (r.label as string | null) ?? null,
  ownershipVerified: r.ownership_verified_at !== null,
  dataSource: r.data_source as Wallet["dataSource"],
  createdAt: iso(r.created_at as Date),
});

export async function listWallets(pool: Pool, userId: string): Promise<Wallet[]> {
  const r = await pool.query("SELECT * FROM wallets WHERE user_id = $1 AND removed_at IS NULL ORDER BY created_at, label", [userId]);
  return r.rows.map(walletOf);
}

export async function getOwnedWallet(pool: Pool, userId: string, walletId: string): Promise<Wallet | null> {
  const r = await pool.query("SELECT * FROM wallets WHERE id = $1 AND user_id = $2 AND removed_at IS NULL", [walletId, userId]);
  return r.rows[0] ? walletOf(r.rows[0]) : null;
}

/** For a session's OWN wallet id (taken from the session row, never from client input). */
export async function getWalletById(pool: Pool, walletId: string): Promise<Wallet | null> {
  const r = await pool.query("SELECT * FROM wallets WHERE id = $1", [walletId]);
  return r.rows[0] ? walletOf(r.rows[0]) : null;
}

export async function ownedAddresses(pool: Pool, userId: string): Promise<string[]> {
  const r = await pool.query("SELECT address FROM wallets WHERE user_id = $1 AND removed_at IS NULL", [userId]);
  return r.rows.map((x) => x.address as string);
}

export async function walletByAddress(pool: Pool, userId: string, address: string): Promise<Wallet | null> {
  const r = await pool.query("SELECT * FROM wallets WHERE user_id = $1 AND address = $2 AND removed_at IS NULL", [userId, address]);
  return r.rows[0] ? walletOf(r.rows[0]) : null;
}

// ---------- charities (registry) ----------
// Public projection only: verification_notes (admin-only) and evidence.verifier_user_id / internal_notes are never selected here.
const CHARITY_SQL = `
  SELECT c.id, c.slug, c.name, c.description, c.website, c.logo_url, c.country, c.category, c.verification_state, c.verification_source,
         c.legal_entity_identifier, c.data_source, c.created_at, c.updated_at,
         (SELECT count(*)::int FROM charity_verification_evidence e WHERE e.charity_id = c.id) AS evidence_count,
         (SELECT max(e.checked_at) FROM charity_verification_evidence e WHERE e.charity_id = c.id) AS last_reviewed_at,
         COALESCE((SELECT json_agg(json_build_object(
           'id', w.id, 'chain', w.chain, 'address', w.address, 'verificationStatus', w.verification_status, 'supportedAssets', w.supported_assets
         ) ORDER BY w.address) FROM charity_wallets w WHERE w.charity_id = c.id), '[]') AS wallets
  FROM charities c`;

const charityOf = (r: Record<string, unknown>): Charity => ({
  id: r.id as string,
  slug: r.slug as string,
  name: cleanText(r.name as string, 200),
  description: r.description ? cleanText(r.description as string, 1000) : null,
  // metadata is untrusted: anything that is not a plain http(s) / https URL is dropped, never passed through
  website: safeHttpUrl(r.website as string | null),
  logoUrl: safeHttpUrl(r.logo_url as string | null, { httpsOnly: true }),
  country: (r.country as string | null)?.trim() ?? null,
  category: r.category ? cleanText(r.category as string, 100) : null,
  verificationState: r.verification_state as Charity["verificationState"],
  verificationSource: (r.verification_source as Charity["verificationSource"]) ?? null,
  lastReviewedAt: r.last_reviewed_at ? iso(r.last_reviewed_at as Date) : null,
  evidenceCount: Number(r.evidence_count),
  legalEntityIdentifier: (r.legal_entity_identifier as string | null) ?? null,
  wallets: r.wallets as Charity["wallets"],
  dataSource: r.data_source as Charity["dataSource"],
  createdAt: iso(r.created_at as Date),
  updatedAt: iso(r.updated_at as Date),
});

export async function listCharities(pool: Pool, verifiedOnly?: boolean): Promise<Charity[]> {
  const where = verifiedOnly === undefined ? "" : verifiedOnly ? "WHERE c.verification_state = 'VERIFIED'" : "WHERE c.verification_state <> 'VERIFIED'";
  const r = await pool.query(`${CHARITY_SQL} ${where} ORDER BY c.name`);
  return r.rows.map(charityOf);
}

export async function getCharity(pool: Pool, id: string): Promise<Charity | null> {
  const r = await pool.query(`${CHARITY_SQL} WHERE c.id = $1`, [id]);
  return r.rows[0] ? charityOf(r.rows[0]) : null;
}

/** Public evidence view. No internal notes, no verifier identity (only whether an admin was recorded). */
export async function listCharityEvidence(pool: Pool, charityId: string): Promise<CharityEvidenceResponse["evidence"]> {
  const r = await pool.query(
    `SELECT id, source_type, source_ref, source_url, status, checked_at, (verifier_user_id IS NOT NULL) AS has_verifier, public_summary, data_source
     FROM charity_verification_evidence WHERE charity_id = $1 ORDER BY checked_at DESC, id`,
    [charityId],
  );
  return r.rows.map((e) => ({
    id: e.id as string,
    sourceType: e.source_type as CharityEvidenceResponse["evidence"][number]["sourceType"],
    sourceRef: cleanText(e.source_ref as string, 500),
    sourceUrl: safeHttpUrl(e.source_url as string | null),
    status: e.status as CharityEvidenceResponse["evidence"][number]["status"],
    checkedAt: iso(e.checked_at as Date),
    reviewedBy: e.has_verifier ? ("ADMIN" as const) : ("NOT_RECORDED" as const),
    publicSummary: cleanText(e.public_summary as string, 500),
    dataSource: e.data_source as Charity["dataSource"],
  }));
}

/** A charity can receive funds only if the org is VERIFIED AND the wallet is verified and supports the asset. */
export async function getDonatableCharityWallet(pool: Pool, charityId: string, asset: string) {
  const r = await pool.query(
    `SELECT w.id, w.address, c.verification_state AS charity_state, w.verification_status AS wallet_status, $2 = ANY(w.supported_assets) AS supports
     FROM charities c JOIN charity_wallets w ON w.charity_id = c.id WHERE c.id = $1 ORDER BY (w.verification_status = 'verified') DESC LIMIT 1`,
    [charityId, asset],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    address: row.address as string,
    verified: row.charity_state === "VERIFIED" && row.wallet_status === "verified" && row.supports === true,
  };
}

// ---------- donations (records, not transfers) and receipts ----------
const donationOf = (r: Record<string, unknown>): Donation => ({
  id: r.id as string,
  walletId: r.source_wallet_id as string,
  charityId: r.charity_id as string,
  asset: r.symbol as string,
  quantity: String(r.amount),
  assetDecimals: Number(r.decimals),
  usdReferenceCents: r.usd_value_cents === null ? null : String(r.usd_value_cents),
  usdReferenceSource: (r.usd_reference_source as Donation["usdReferenceSource"]) ?? null,
  status: r.status as Donation["status"],
  transactionSignature: (r.signature as string | null) ?? null,
  donatedAt: r.donated_at ? iso(r.donated_at as Date) : null,
  receiptId: (r.receipt_id as string | null) ?? null,
  receiptStatus: (r.receipt_state as Donation["receiptStatus"]) ?? null,
  destinationAddress: r.destination as string,
  provenance: r.provenance as Donation["provenance"],
  createdAt: iso(r.created_at as Date),
  dataSource: r.data_source as Donation["dataSource"],
  taxNote: DONATION_TAX_NOTE,
});

const DONATION_SQL = `
  SELECT d.*, a.symbol, a.decimals, cw.address AS destination, rt.signature, dr.id AS receipt_id, dr.verification_state AS receipt_state
  FROM donations d
  JOIN assets a ON a.id = d.asset_id
  JOIN charity_wallets cw ON cw.id = d.charity_wallet_id
  LEFT JOIN raw_transactions rt ON rt.id = d.raw_transaction_id
  LEFT JOIN donation_receipts dr ON dr.donation_id = d.id`;

/** Every donation read filters by user_id: that filter IS the authorization boundary. Non-owners get null/[] (the route answers 404). */
export async function listDonations(pool: Pool, userId: string, walletId: string): Promise<Donation[]> {
  const r = await pool.query(`${DONATION_SQL} WHERE d.user_id = $1 AND d.source_wallet_id = $2 ORDER BY d.created_at DESC, d.id`, [userId, walletId]);
  return r.rows.map(donationOf);
}

export async function getOwnedDonation(pool: Pool, userId: string, donationId: string): Promise<Donation | null> {
  const r = await pool.query(`${DONATION_SQL} WHERE d.id = $1 AND d.user_id = $2`, [donationId, userId]);
  return r.rows[0] ? donationOf(r.rows[0]) : null;
}

const receiptOf = (r: Record<string, unknown>): Receipt => {
  const demo = r.data_source === "demo";
  return {
    id: r.id as string,
    donationId: r.donation_id as string,
    receiptReference: cleanText(r.receipt_reference as string, 200),
    charityReceiptReference: r.charity_receipt_reference ? cleanText(r.charity_receipt_reference as string, 200) : null,
    issuedAt: iso(r.issued_at as Date),
    documentUrl: safeHttpUrl(r.document_url as string | null, { httpsOnly: true }),
    receiptHash: (r.receipt_hash as string | null) ?? null,
    verificationState: r.verification_state as Receipt["verificationState"],
    provenanceNote: r.provenance_note ? cleanText(r.provenance_note as string, 500) : null,
    labels: demo ? [GIVE_COPY.demoReceipt, GIVE_COPY.fixtureData, GIVE_COPY.notTaxReceipt] : [],
    caveat: GIVE_COPY.receiptCaveat,
    dataSource: r.data_source as Receipt["dataSource"],
  };
};

/** Receipts are reachable only through the owning user's donation. */
export async function getOwnedReceipt(pool: Pool, userId: string, receiptId: string): Promise<Receipt | null> {
  const r = await pool.query(
    "SELECT dr.* FROM donation_receipts dr JOIN donations d ON d.id = dr.donation_id WHERE dr.id = $1 AND d.user_id = $2",
    [receiptId, userId],
  );
  return r.rows[0] ? receiptOf(r.rows[0]) : null;
}

export async function getOwnedReceiptForDonation(pool: Pool, userId: string, donationId: string): Promise<Receipt | null> {
  const r = await pool.query(
    "SELECT dr.* FROM donation_receipts dr JOIN donations d ON d.id = dr.donation_id WHERE dr.donation_id = $1 AND d.user_id = $2",
    [donationId, userId],
  );
  return r.rows[0] ? receiptOf(r.rows[0]) : null;
}

// ---------- tax reserve target (USER CONFIGURATION only: no tax figure, no balance, no funds) ----------
export async function getTaxReserveTarget(pool: Pool, userId: string): Promise<(StoredTarget & { dataSource: "demo" | "database" }) | null> {
  const r = await pool.query("SELECT t.*, u.is_demo FROM tax_reserves t JOIN users u ON u.id = t.user_id WHERE t.user_id = $1", [userId]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    targetType: row.rule === "FIXED_PERCENT" ? "percentage" : "amount",
    percentBps: row.percent_bps as number | null,
    targetCents: row.target_cents === null ? null : BigInt(row.target_cents as string),
    source: row.target_source as StoredTarget["source"],
    enabled: row.enabled as boolean,
    updatedAt: iso(row.updated_at as Date),
    dataSource: row.is_demo ? "demo" : "database",
  };
}

/**
 * Stores the user's reserve TARGET configuration and appends one history row (same transaction). Moves no funds; there is no
 * fund-movement code path. Derived values (recommendation, coverage, remaining) are never stored.
 */
export async function upsertTaxReserveTarget(pool: Pool, userId: string, t: Omit<StoredTarget, "updatedAt">, authMethod: string): Promise<void> {
  const rule = t.targetType === "percentage" ? "FIXED_PERCENT" : "MANUAL_TARGET";
  const cents = t.targetCents === null ? null : t.targetCents.toString();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO tax_reserves (user_id, rule, percent_bps, target_cents, target_source, enabled) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO UPDATE SET rule = EXCLUDED.rule, percent_bps = EXCLUDED.percent_bps, target_cents = EXCLUDED.target_cents,
         target_source = EXCLUDED.target_source, enabled = EXCLUDED.enabled, updated_at = now()`,
      [userId, rule, t.percentBps, cents, t.source, t.enabled],
    );
    await c.query(
      "INSERT INTO tax_reserve_target_events (user_id, rule, percent_bps, target_cents, target_source, enabled, created_auth_method) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [userId, rule, t.percentBps, cents, t.source, t.enabled, authMethod],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

// ---------- launches ----------
const launchOf = (r: Record<string, unknown>): Launch => ({
  id: r.id as string,
  status: r.status as Launch["status"],
  config: r.config as LaunchConfig,
  review: (r.review as LaunchReview | null) ?? null,
  deployment: { status: "not_deployed", contractAddress: null },
  createdAt: iso(r.created_at as Date),
  updatedAt: iso(r.updated_at as Date),
  dataSource: r.data_source as Launch["dataSource"],
});

export const MAX_LAUNCH_DRAFTS_PER_USER = 50;

export async function countLaunches(pool: Pool, userId: string): Promise<number> {
  return Number((await pool.query("SELECT count(*) FROM launch_configurations WHERE creator_user_id = $1", [userId])).rows[0].count);
}

export async function insertLaunch(pool: Pool, userId: string, walletId: string, config: LaunchConfig): Promise<Launch> {
  const r = await pool.query(
    "INSERT INTO launch_configurations (creator_user_id, creator_wallet_id, name, symbol, config) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [userId, walletId, config.name, config.symbol, JSON.stringify(config)],
  );
  return launchOf(r.rows[0]);
}

export async function listLaunches(pool: Pool, userId: string, limit: number, offset: number): Promise<{ launches: Launch[]; total: number }> {
  const total = await countLaunches(pool, userId);
  const r = await pool.query("SELECT * FROM launch_configurations WHERE creator_user_id = $1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3", [userId, limit, offset]);
  return { launches: r.rows.map(launchOf), total };
}

export async function getLaunch(pool: Pool, userId: string, id: string): Promise<Launch | null> {
  const r = await pool.query("SELECT * FROM launch_configurations WHERE id = $1 AND creator_user_id = $2", [id, userId]);
  return r.rows[0] ? launchOf(r.rows[0]) : null;
}

export async function saveLaunchReview(pool: Pool, userId: string, id: string, review: LaunchReview): Promise<Launch | null> {
  const r = await pool.query(
    "UPDATE launch_configurations SET review = $3, status = $4, updated_at = now() WHERE id = $1 AND creator_user_id = $2 RETURNING *",
    [id, userId, JSON.stringify(review), review.passed ? "review_passed" : "review_failed"],
  );
  return r.rows[0] ? launchOf(r.rows[0]) : null;
}
