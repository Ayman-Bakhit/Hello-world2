import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  DONATION_TAX_NOTE, DonationDetail, DonationPlanRequest, DonationPlanResponse, DonationsResponse, Receipt, buildDonationPlan, parseUsdToCents,
} from "@project-name/shared";
import { actorOf, requireAuth } from "../auth/plugin";
import { getCharity, getDonatableCharityWallet, getOwnedDonation, getOwnedReceipt, getOwnedReceiptForDonation, getOwnedWallet, listDonations } from "../db/repos";
import { ApiError, notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

const IdParams = z.strictObject({ id: z.string().uuid() });

/**
 * Donation RECORDS and receipt references. There is no endpoint that creates a donation, builds a transaction, asks for a
 * signature or sends funds in this slice. Every read is scoped to the signed-in user in SQL; a foreign or unknown id is a 404.
 * `plan` is a stateless review: it persists nothing and always reports transfersEnabled: false.
 */
export const donationRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const auth = requireAuth(pool, config);
  const noStore = (reply: { header: (k: string, v: string) => unknown }) => void reply.header("cache-control", "no-store");

  app.get("/api/donations/:walletId", { preHandler: auth }, async (req, reply) => {
    noStore(reply);
    const wallet = await ownedWalletFromParams(pool, req);
    const donations = await listDonations(pool, actorOf(req).userId, wallet.id);
    const sum = (s: string) => donations.filter((d) => d.status === s).reduce((t, d) => t + BigInt(d.usdReferenceCents ?? "0"), 0n).toString();
    return respond(DonationsResponse, {
      walletId: wallet.id,
      donations,
      confirmedTotalCents: sum("confirmed"),
      demoTotalCents: sum("demo"),
      taxNote: DONATION_TAX_NOTE,
      dataSource: donations.length > 0 && donations.every((d) => d.dataSource === "demo") ? "demo" : wallet.dataSource,
      verifiedOnChain: false,
    });
  });

  app.get("/api/donations/by-id/:id", { preHandler: auth }, async (req, reply) => {
    noStore(reply);
    const { id } = parse(IdParams, req.params);
    const userId = actorOf(req).userId;
    const donation = await getOwnedDonation(pool, userId, id);
    if (!donation) throw notFound("Donation");
    return respond(DonationDetail, { donation, receipt: await getOwnedReceiptForDonation(pool, userId, id) });
  });

  app.get("/api/receipts/:id", { preHandler: auth }, async (req, reply) => {
    noStore(reply);
    const { id } = parse(IdParams, req.params);
    const receipt = await getOwnedReceipt(pool, actorOf(req).userId, id);
    if (!receipt) throw notFound("Receipt");
    return respond(Receipt, receipt);
  });

  app.post("/api/donations/plan", { preHandler: auth, config: { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } } }, async (req, reply) => {
    noStore(reply);
    const body = parse(DonationPlanRequest, req.body);
    const wallet = await getOwnedWallet(pool, actorOf(req).userId, body.walletId);
    if (!wallet) throw notFound("Wallet");
    const cents = parseUsdToCents(body.amount);
    if (cents === null) throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", { amount: ["invalid amount"] });
    const charity = await getCharity(pool, body.charityId);
    if (!charity) throw notFound("Charity");
    const dest = await getDonatableCharityWallet(pool, charity.id, body.asset);
    return respond(DonationPlanResponse, buildDonationPlan({
      walletId: wallet.id, charity, hasVerifiedWalletForAsset: dest?.verified === true, amountUsdCents: cents, walletDataSource: wallet.dataSource,
    }));
  });
};
