import { DEMO_CHARITIES, DEMO_DONATIONS, DEMO_EVIDENCE, DEMO_IDS, DEMO_RECEIPT, DEMO_WALLETS, DEMO_DEFAULT_TARGET } from "@project-name/shared";
import type { Pool } from "./pool";

/**
 * Seeds clearly-labeled DEMO rows (fictional wallets, charities, donations). Idempotent via ON CONFLICT.
 * Run explicitly (pnpm --filter @project-name/api db:seed-demo). Never runs automatically.
 * Demo donations are status 'demo' (never 'confirmed': there is no verifiable transaction).
 */
export async function seedDemo(pool: Pool): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("INSERT INTO users (id, display_name, is_demo) VALUES ($1,'Demo user',true), ($2,'Demo admin',true) ON CONFLICT (id) DO NOTHING", [DEMO_IDS.user, DEMO_IDS.admin]);
    for (const w of DEMO_WALLETS) {
      await c.query(
        "INSERT INTO wallets (id, user_id, chain, address, label, data_source) VALUES ($1,$2,'solana',$3,$4,'demo') ON CONFLICT (id) DO NOTHING",
        [w.id, DEMO_IDS.user, w.address, w.label],
      );
    }
    await c.query(
      `INSERT INTO assets (id, chain, address, symbol, name, decimals, kind, data_source) VALUES
       ($1,'solana','DEMO-USDC','USDC','USD Coin (demo)',6,'spl','demo'), ($2,'solana','native','SOL','Solana',9,'native','chain') ON CONFLICT DO NOTHING`,
      [DEMO_IDS.assetUsdc, DEMO_IDS.assetSol],
    );
    for (const ch of DEMO_CHARITIES) {
      const verified = ch.state === "VERIFIED";
      // A fixture charity is never real-world verified: its state rests on FIXTURE evidence (inserted below), and the DB enforces that.
      await c.query(
        `INSERT INTO charities (id, slug, name, description, website, country, category, verification_state, verification_source, verification_checked_at, legal_entity_identifier, data_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'demo') ON CONFLICT (id) DO NOTHING`,
        [ch.id, ch.slug, ch.name, ch.description, ch.website, ch.country, ch.category, ch.state, verified ? "FIXTURE" : null, verified ? new Date("2026-01-01T00:00:00Z") : null, ch.legalEntityIdentifier],
      );
      await c.query(
        `INSERT INTO charity_wallets (id, charity_id, chain, address, supported_assets, verification_status)
         VALUES ($1,$2,'solana',$3,ARRAY['USDC'],$4) ON CONFLICT (id) DO NOTHING`,
        [ch.wallet.id, ch.id, ch.wallet.address, ch.wallet.verification],
      );
    }
    for (const e of DEMO_EVIDENCE) {
      await c.query(
        `INSERT INTO charity_verification_evidence (id, charity_id, source_type, source_ref, status, checked_at, public_summary, data_source)
         VALUES ($1,$2,'FIXTURE','demo-fixture',$3,$4,$5,'demo') ON CONFLICT (id) DO NOTHING`,
        [e.id, e.charityId, e.status, e.checkedAt, e.publicSummary],
      );
    }
    for (const d of DEMO_DONATIONS) {
      const charity = DEMO_CHARITIES.find((x) => x.id === d.charityId)!;
      await c.query(
        `INSERT INTO donations (id, user_id, charity_id, charity_wallet_id, source_wallet_id, asset_id, amount, usd_value_cents, usd_reference_source, provenance, status, created_at, data_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'FIXTURE','DEMO_FIXTURE','demo',$9,'demo') ON CONFLICT (id) DO NOTHING`,
        [d.id, DEMO_IDS.user, d.charityId, charity.wallet.id, d.walletId, DEMO_IDS.assetUsdc, (d.amountCents * 10_000n).toString(), d.amountCents.toString(), d.createdAt],
      );
    }
    await c.query(
      `INSERT INTO donation_receipts (id, donation_id, receipt_reference, issued_at, verification_state, provenance_note, data_source)
       VALUES ($1,$2,$3,$4,'UNVERIFIED','Fixture receipt for development.','demo') ON CONFLICT (id) DO NOTHING`,
      [DEMO_RECEIPT.id, DEMO_RECEIPT.donationId, DEMO_RECEIPT.receiptReference, DEMO_RECEIPT.issuedAt],
    );
    await c.query(
      "INSERT INTO tax_reserves (user_id, rule, percent_bps) VALUES ($1,'FIXED_PERCENT',$2) ON CONFLICT (user_id) DO NOTHING",
      [DEMO_IDS.user, DEMO_DEFAULT_TARGET.percentBps],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
