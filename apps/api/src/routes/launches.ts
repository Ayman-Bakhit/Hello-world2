import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Launch, LaunchConfigSchema, LaunchList, PageQuery, reviewLaunchConfig } from "@project-name/shared";
import { actorOf, requireAuth } from "../auth/plugin";
import { MAX_LAUNCH_DRAFTS_PER_USER, countLaunches, getCharity, getLaunch, insertLaunch, listLaunches, ownedAddresses, saveLaunchReview, walletByAddress } from "../db/repos";
import { ApiError, notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Deps } from "./index";

const IdParams = z.strictObject({ id: z.string().uuid() });

/**
 * Launch CONFIGURATIONS only. Nothing is deployed, no token or liquidity is created, no transaction is
 * built. The fee split is validated by the shared implementation and described as "Configured fee split".
 */
export const launchRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const auth = requireAuth(pool, config);
  const writeLimit = { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } };

  app.post("/api/launches", { preHandler: auth, config: writeLimit }, async (req, reply) => {
    const userId = actorOf(req).userId;
    const cfg = parse(LaunchConfigSchema, req.body);
    const wallet = await walletByAddress(pool, userId, cfg.creatorWallet);
    if (!wallet) throw new ApiError(422, "WALLET_NOT_OWNED", "creatorWallet must be one of your registered wallets", { creatorWallet: ["not one of your registered wallets"] });
    if ((await countLaunches(pool, userId)) >= MAX_LAUNCH_DRAFTS_PER_USER) {
      throw new ApiError(409, "LIMIT_REACHED", `At most ${MAX_LAUNCH_DRAFTS_PER_USER} launch configurations per account`);
    }
    return reply.code(201).send(respond(Launch, await insertLaunch(pool, userId, wallet.id, cfg)));
  });

  app.get("/api/launches", { preHandler: auth }, async (req) => {
    const { limit, offset } = parse(PageQuery, req.query);
    const { launches, total } = await listLaunches(pool, actorOf(req).userId, limit, offset);
    return respond(LaunchList, { launches, pagination: { limit, offset, total } });
  });

  app.get("/api/launches/:id", { preHandler: auth }, async (req) => {
    const { id } = parse(IdParams, req.params);
    const l = await getLaunch(pool, actorOf(req).userId, id);
    if (!l) throw notFound("Launch");
    return respond(Launch, l);
  });

  app.post("/api/launches/:id/review", { preHandler: auth, config: writeLimit }, async (req) => {
    const { id } = parse(IdParams, req.params);
    const userId = actorOf(req).userId;
    const launch = await getLaunch(pool, userId, id);
    if (!launch) throw notFound("Launch");
    const charity = await getCharity(pool, launch.config.charityConfiguration.charityId);
    const review = reviewLaunchConfig(launch.config, {
      ownedWalletAddresses: await ownedAddresses(pool, userId),
      charity: charity ? { verified: charity.verificationStatus === "verified", hasVerifiedWallet: charity.wallets.some((w) => w.verificationStatus === "verified") } : null,
      now: new Date(),
    });
    const saved = await saveLaunchReview(pool, userId, id, review);
    if (!saved) throw notFound("Launch");
    return respond(Launch, saved);
  });
};
