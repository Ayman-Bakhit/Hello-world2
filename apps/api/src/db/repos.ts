import type { Charity, Donation, Launch, LaunchConfig, LaunchReview, Wallet } from "@project-name/shared";
import { DONATION_TAX_NOTE, type StoredTarget } from "@project-name/shared";
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

export async function ownedAddresses(pool: Pool, userId: string): Promise<string[]> {
  const r = await pool.query("SELECT address FROM wallets WHERE user_id = $1 AND removed_at IS NULL", [userId]);
  return r.rows.map((x) => x.address as string);
}

export async function walletByAddress(pool: Pool, userId: string, address: string): Promise<Wallet | null> {
  const r = await pool.query("SELECT * FROM wallets WHERE user_id = $1 AND address = $2 AND removed_at IS NULL", [userId, address]);
  return r.rows[0] ? walletOf(r.rows[0]) : null;
}

// ---------- charities ----------
const CHARITY_SQL = `
  SELECT c.*, COALESCE(json_agg(json_build_object(
    'id', w.id, 'chain', w.chain, 'address', w.address,
    'verificationStatus', w.verification_status, 'supportedAssets', w.supported_assets
  ) ORDER BY w.address) FILTER (WHERE w.id IS NOT NULL), '[]') AS wallets
  FROM charities c LEFT JOIN charity_wallets w ON w.charity_id = c.id`;

const charityOf = (r: Record<string, unknown>): Charity => ({
  id: r.id as string,
  name: r.name as string,
  description: (r.description as string | null) ?? null,
  website: (r.website as string | null) ?? null,
  country: (r.country as string | null)?.trim() ?? null,
  category: (r.category as string | null) ?? null,
  verificationStatus: r.verification_status as Charity["verificationStatus"],
  legalEntityIdentifier: (r.legal_entity_identifier as string | null) ?? null,
  wallets: r.wallets as Charity["wallets"],
  dataSource: r.data_source as Charity["dataSource"],
  createdAt: iso(r.created_at as Date),
});

export async function listCharities(pool: Pool, verifiedOnly?: boolean): Promise<Charity[]> {
  const where = verifiedOnly === undefined ? "" : verifiedOnly ? "WHERE c.verification_status = 'verified'" : "WHERE c.verification_status <> 'verified'";
  const r = await pool.query(`${CHARITY_SQL} ${where} GROUP BY c.id ORDER BY c.name`);
  return r.rows.map(charityOf);
}

export async function getCharity(pool: Pool, id: string): Promise<Charity | null> {
  const r = await pool.query(`${CHARITY_SQL} WHERE c.id = $1 GROUP BY c.id`, [id]);
  return r.rows[0] ? charityOf(r.rows[0]) : null;
}

/** A charity can receive funds only if the org AND the wallet are verified and the wallet supports the asset. */
export async function getDonatableCharityWallet(pool: Pool, charityId: string, asset: string) {
  const r = await pool.query(
    `SELECT w.id, w.address, c.verification_status AS charity_status, w.verification_status AS wallet_status, $2 = ANY(w.supported_assets) AS supports
     FROM charities c JOIN charity_wallets w ON w.charity_id = c.id WHERE c.id = $1 ORDER BY (w.verification_status = 'verified') DESC LIMIT 1`,
    [charityId, asset],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    address: row.address as string,
    verified: row.charity_status === "verified" && row.wallet_status === "verified" && row.supports === true,
  };
}

// ---------- donations ----------
const donationOf = (r: Record<string, unknown>): Donation => ({
  id: r.id as string,
  walletId: r.source_wallet_id as string,
  charityId: r.charity_id as string,
  asset: r.symbol as string,
  amountUsdCents: String(r.usd_value_cents),
  status: r.status as Donation["status"],
  transactionSignature: (r.signature as string | null) ?? null,
  receiptReference: (r.receipt_reference as string | null) ?? null,
  destinationAddress: r.destination as string,
  createdAt: iso(r.created_at as Date),
  dataSource: r.data_source as Donation["dataSource"],
  taxNote: DONATION_TAX_NOTE,
});

const DONATION_SQL = `
  SELECT d.*, a.symbol, cw.address AS destination, rt.signature, dr.receipt_reference
  FROM donations d
  JOIN assets a ON a.id = d.asset_id
  JOIN charity_wallets cw ON cw.id = d.charity_wallet_id
  LEFT JOIN raw_transactions rt ON rt.id = d.raw_transaction_id
  LEFT JOIN donation_receipts dr ON dr.donation_id = d.id`;

export async function listDonations(pool: Pool, userId: string, walletId: string): Promise<Donation[]> {
  const r = await pool.query(`${DONATION_SQL} WHERE d.user_id = $1 AND d.source_wallet_id = $2 ORDER BY d.created_at DESC, d.id`, [userId, walletId]);
  return r.rows.map(donationOf);
}

export async function createDemoDonation(
  pool: Pool,
  a: { userId: string; walletId: string; charityId: string; charityWalletId: string; assetSymbol: string; usdCents: bigint },
): Promise<Donation> {
  const asset = await pool.query("SELECT id, decimals FROM assets WHERE symbol = $1 AND chain = 'solana' ORDER BY (address LIKE 'DEMO%') DESC LIMIT 1", [a.assetSymbol]);
  const row = asset.rows[0];
  if (!row) throw new Error(`asset ${a.assetSymbol} is not configured`);
  // USDC: 6 decimals, 1 cent = 10,000 base units.
  const baseUnits = a.usdCents * 10n ** BigInt(Number(row.decimals) - 2);
  const ins = await pool.query(
    `INSERT INTO donations (user_id, charity_id, charity_wallet_id, source_wallet_id, asset_id, amount, usd_value_cents, status, data_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'demo','demo') RETURNING id`,
    [a.userId, a.charityId, a.charityWalletId, a.walletId, row.id, baseUnits.toString(), a.usdCents.toString()],
  );
  const r = await pool.query(`${DONATION_SQL} WHERE d.id = $1`, [ins.rows[0].id]);
  return donationOf(r.rows[0]);
}

// ---------- tax reserve target ----------
export async function getTaxReserveTarget(pool: Pool, userId: string): Promise<(StoredTarget & { dataSource: "demo" | "database" }) | null> {
  const r = await pool.query("SELECT t.*, u.is_demo FROM tax_reserves t JOIN users u ON u.id = t.user_id WHERE t.user_id = $1", [userId]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    targetType: row.rule === "FIXED_PERCENT" ? "percentage" : "amount",
    percentBps: row.percent_bps as number | null,
    targetCents: row.target_cents === null ? null : BigInt(row.target_cents as string),
    updatedAt: iso(row.updated_at as Date),
    dataSource: row.is_demo ? "demo" : "database",
  };
}

/** Stores the user's reserve TARGET configuration only. Moves no funds; there is no fund-movement code path. */
export async function upsertTaxReserveTarget(pool: Pool, userId: string, t: Omit<StoredTarget, "updatedAt">): Promise<void> {
  await pool.query(
    `INSERT INTO tax_reserves (user_id, rule, percent_bps, target_cents) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE SET rule = EXCLUDED.rule, percent_bps = EXCLUDED.percent_bps, target_cents = EXCLUDED.target_cents, updated_at = now()`,
    [userId, t.targetType === "percentage" ? "FIXED_PERCENT" : "MANUAL_TARGET", t.percentBps, t.targetCents === null ? null : t.targetCents.toString()],
  );
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
