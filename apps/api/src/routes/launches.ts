import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  Launch, LaunchActionRequest, LaunchConfigSchema, LaunchHistory, LaunchList, LaunchReadyRequest, LaunchUpdateRequest, PageQuery, reviewLaunchConfig, type LaunchConfig,
} from "@project-name/shared";
import { actorOf, requireAuth } from "../auth/plugin";
import { applyLaunchAction, countLaunches, createLaunch, getLaunch, getLaunchHistory, listLaunches } from "../db/launchRepos";
import { getCharity, ownedAddresses, walletByAddress } from "../db/repos";
import { ApiError, notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Pool } from "../db/pool";
import type { Deps } from "./index";

const IdParams = z.strictObject({ id: z.string().uuid() });

/** The pure review, run against the registry and the actor's wallets as they are NOW. */
export async function reviewFor(pool: Pool, userId: string, config: LaunchConfig, now = new Date()) {
  const charity = await getCharity(pool, config.charityConfiguration.charityId);
  return reviewLaunchConfig(config, {
    ownedWalletAddresses: await ownedAddresses(pool, userId),
    charity: charity
      ? {
          verified: charity.verificationState === "VERIFIED", hasVerifiedWallet: charity.wallets.some((w) => w.verificationStatus === "verified"),
          snapshot: { id: charity.id, name: charity.name, verificationState: charity.verificationState, verificationSource: charity.verificationSource, lastReviewedAt: charity.lastReviewedAt, dataSource: charity.dataSource },
        }
      : null,
    now,
  });
}

/**
 * Launch CONFIGURATIONS only. There is no deployment, mint, liquidity, fee-distribution, payout, donation or transfer endpoint, and no
 * request can carry a status: the server derives every status from a named action (configure, review, ready, cancel) and a transition
 * table. Ownership comes from the session, never from the body; a foreign and an unknown launch id are the same 404.
 */
export const launchRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const auth = requireAuth(pool, config);
  const writeLimit = { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } };
  const noStore = (reply: { header: (k: string, v: string) => unknown }) => void reply.header("cache-control", "no-store");

  /** Checks that the body references only things the actor may reference: their own wallets and an existing registry charity. */
  async function checkReferences(userId: string, cfg: LaunchConfig) {
    const wallet = await walletByAddress(pool, userId, cfg.creatorWallet);
    if (!wallet) throw new ApiError(422, "WALLET_NOT_OWNED", "creatorWallet must be one of your registered wallets", { creatorWallet: ["not one of your registered wallets"] });
    if (!(await walletByAddress(pool, userId, cfg.taxReserveConfiguration.destinationAddress))) {
      throw new ApiError(422, "WALLET_NOT_OWNED", "The tax reserve allocation destination must be one of your registered wallets", { "taxReserveConfiguration.destinationAddress": ["not one of your registered wallets"] });
    }
    // a client-supplied charity id must be a registry record; it is never a name, and unverified charities are judged at configure/review time
    if (!(await getCharity(pool, cfg.charityConfiguration.charityId))) throw new ApiError(422, "CHARITY_NOT_FOUND", "The selected charity is not in the registry", { "charityConfiguration.charityId": ["not a registry charity"] });
    return wallet;
  }

  app.post("/api/launches", { preHandler: auth, config: writeLimit }, async (req, reply) => {
    noStore(reply);
    const { userId, authMethod } = actorOf(req);
    const cfg = parse(LaunchConfigSchema, req.body);
    const wallet = await checkReferences(userId, cfg);
    if ((await countLaunches(pool, userId)) >= config.MAX_LAUNCHES_PER_USER) {
      throw new ApiError(409, "LIMIT_REACHED", `At most ${config.MAX_LAUNCHES_PER_USER} launch configurations per account`);
    }
    return reply.code(201).send(respond(Launch, await createLaunch(pool, { userId, walletId: wallet.id, config: cfg, authMethod })));
  });

  app.get("/api/launches", { preHandler: auth }, async (req, reply) => {
    noStore(reply);
    const { limit, offset } = parse(PageQuery, req.query);
    const { launches, total } = await listLaunches(pool, actorOf(req).userId, limit, offset);
    return respond(LaunchList, { launches, pagination: { limit, offset, total } });
  });

  app.get("/api/launches/:id", { preHandler: auth }, async (req, reply) => {
    noStore(reply);
    const { id } = parse(IdParams, req.params);
    const l = await getLaunch(pool, actorOf(req).userId, id);
    if (!l) throw notFound("Launch");
    return respond(Launch, l);
  });

  /** Replaces the configuration. The launch returns to DRAFT: a changed configuration must be validated and reviewed again. */
  app.put("/api/launches/:id", { preHandler: auth, config: writeLimit }, async (req, reply) => {
    noStore(reply);
    const { id } = parse(IdParams, req.params);
    const { userId, authMethod } = actorOf(req);
    const cfg = parse(LaunchUpdateRequest, req.body);
    if (!(await getLaunch(pool, userId, id))) throw notFound("Launch");
    await checkReferences(userId, cfg);
    return finish(await applyLaunchAction(pool, { userId, id, action: "update", authMethod, config: cfg }));
  });

  function finish(r: Awaited<ReturnType<typeof applyLaunchAction>>) {
    if (r.ok) return respond(Launch, r.launch);
    if (r.code === "NOT_FOUND") throw notFound("Launch");
    if (r.code === "STALE") throw new ApiError(409, "LAUNCH_CHANGED", "The launch configuration changed while this request was running. Reload it and try again.");
    throw new ApiError(409, "INVALID_LAUNCH_TRANSITION", `This action is not available while the launch is ${String(r.from)}.`);
  }

  /** Runs server validation on the stored configuration and applies the transition for `action`. */
  const act = (action: "configure" | "review" | "ready" | "cancel", opts: { needsReview: boolean }) =>
    async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
      noStore(reply);
      const { id } = parse(IdParams, req.params);
      const { userId, authMethod } = actorOf(req);
      const body = action === "ready" ? parse(LaunchReadyRequest, req.body) : parse(LaunchActionRequest, req.body ?? {});
      const launch = await getLaunch(pool, userId, id);
      if (!launch) throw notFound("Launch");
      if (action === "ready" && (body as { fingerprint: string }).fingerprint !== launch.fingerprint) {
        throw new ApiError(409, "FINGERPRINT_MISMATCH", "The confirmed fingerprint is not this launch's current configuration fingerprint.");
      }
      const review = opts.needsReview ? await reviewFor(pool, userId, launch.config) : undefined;
      return finish(await applyLaunchAction(pool, {
        userId, id, action, authMethod, expectedFingerprint: launch.fingerprint, ...(review ? { review } : {}),
        reason: (body as { reason?: string }).reason ?? null, publish: action === "ready" ? (body as { publish: boolean }).publish : false,
      }));
    };

  app.post("/api/launches/:id/configure", { preHandler: auth, config: writeLimit }, act("configure", { needsReview: true }));
  app.post("/api/launches/:id/review", { preHandler: auth, config: writeLimit }, act("review", { needsReview: true }));
  app.post("/api/launches/:id/ready", { preHandler: auth, config: writeLimit }, act("ready", { needsReview: true }));
  app.post("/api/launches/:id/cancel", { preHandler: auth, config: writeLimit }, act("cancel", { needsReview: false }));

  app.get("/api/launches/:id/history", { preHandler: auth }, async (req, reply) => {
    noStore(reply);
    const { id } = parse(IdParams, req.params);
    const h = await getLaunchHistory(pool, actorOf(req).userId, id);
    if (!h) throw notFound("Launch");
    return respond(LaunchHistory, {
      launchId: id, revisions: h.revisions, historyIntact: h.intact,
      note: "Append-only and hash-chained, so an edit made outside the API is detectable. This is auditability, not a blockchain proof.",
    });
  });
};
