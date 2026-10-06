import type { FastifyPluginAsync } from "fastify";
import {
  CreateDonationRequest, CreateDonationResponse, DONATION_TAX_NOTE, DonationsResponse, parseUsdToCents,
} from "@project-name/shared";
import { actorOf, requireAuth } from "../auth/plugin";
import { createDemoDonation, getDonatableCharityWallet, getOwnedWallet, listDonations } from "../db/repos";
import { ApiError, notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

/**
 * Donations here are RECORDS, not transfers. POST creates a row with status "demo": no transaction is
 * built, signed, or sent, and nothing is ever marked "confirmed" (the DB also forbids confirmed without
 * a recorded transaction). A charity must be verified, with a verified wallet, to be selectable.
 */
export const donationRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const auth = requireAuth(pool, config);

  app.get("/api/donations/:walletId", { preHandler: auth }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req);
    const donations = await listDonations(pool, actorOf(req).userId, wallet.id);
    const sum = (s: string) => donations.filter((d) => d.status === s).reduce((t, d) => t + BigInt(d.amountUsdCents), 0n).toString();
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

  app.post("/api/donations", { preHandler: auth, config: { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } } }, async (req, reply) => {
    const body = parse(CreateDonationRequest, req.body);
    const userId = actorOf(req).userId;
    const wallet = await getOwnedWallet(pool, userId, body.walletId);
    if (!wallet) throw notFound("Wallet");
    const usdCents = parseUsdToCents(body.amount);
    if (usdCents === null) throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", { amount: ["invalid amount"] });
    const dest = await getDonatableCharityWallet(pool, body.charityId, body.asset);
    if (!dest) throw notFound("Charity");
    if (!dest.verified) throw new ApiError(422, "CHARITY_NOT_VERIFIED", "This charity (or its wallet) is not verified and cannot receive donations.");

    const donation = await createDemoDonation(pool, { userId, walletId: wallet.id, charityId: body.charityId, charityWalletId: dest.id, assetSymbol: body.asset, usdCents });
    return reply.code(201).send(respond(CreateDonationResponse, {
      donation,
      notice: "Demo record only. No blockchain transaction was created and no funds moved. A donation is never marked confirmed without a verifiable transaction.",
    }));
  });
};
