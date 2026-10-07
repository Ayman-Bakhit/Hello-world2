import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PageQuery, PublicLaunch, PublicLaunchList, toPublicLaunch, type Launch } from "@project-name/shared";
import { getPublicLaunch, listPublicLaunches } from "../db/launchRepos";
import { getCharity } from "../db/repos";
import { notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Pool } from "../db/pool";
import type { Deps } from "./index";

/**
 * Public, read-only view of launch CONFIGURATIONS the creator marked READY and published. It names no user, session or full wallet
 * address, shows the charity's CURRENT registry state, and says CONFIGURED / NOT DEPLOYED / NOT VERIFIED ON-CHAIN. Drafts and anything
 * else are indistinguishable from "does not exist".
 */
async function view(pool: Pool, l: Launch) {
  const c = await getCharity(pool, l.config.charityConfiguration.charityId);
  return toPublicLaunch(l, c ? { id: c.id, name: c.name, verificationState: c.verificationState, verificationSource: c.verificationSource, lastReviewedAt: c.lastReviewedAt, dataSource: c.dataSource } : null);
}

export const publicLaunchRoutes: FastifyPluginAsync<Deps> = async (app, { pool }) => {
  app.get("/api/public/launches", async (req) => {
    const { limit, offset } = parse(PageQuery, req.query);
    const { launches, total } = await listPublicLaunches(pool, limit, offset);
    return respond(PublicLaunchList, { launches: await Promise.all(launches.map((l) => view(pool, l))), pagination: { limit, offset, total } });
  });
  app.get("/api/public/launches/:id", async (req) => {
    const { id } = parse(z.strictObject({ id: z.string().uuid() }), req.params);
    const l = await getPublicLaunch(pool, id);
    if (!l) throw notFound("Launch");
    return respond(PublicLaunch, await view(pool, l));
  });
};
