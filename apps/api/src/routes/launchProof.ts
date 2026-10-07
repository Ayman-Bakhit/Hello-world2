import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { LaunchProof, buildLaunchProof, isBase58Address, type Launch, type ProofSubject } from "@project-name/shared";
import { actorOf, requireAuth } from "../auth/plugin";
import { getLaunch, getPublicLaunch } from "../db/launchRepos";
import { getProofState } from "../db/proofRepos";
import { getCharity } from "../db/repos";
import { notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Pool } from "../db/pool";
import type { Deps } from "./index";

const IdParams = z.strictObject({ id: z.string().uuid() });

/**
 * READ-ONLY token proof. The status, every check and `verifiedOnChain` / `verifiedTransparency` are derived here from stored
 * records by the shared evaluator; nothing in a request can influence them and there is no write endpoint. Today nothing records a
 * deployment or an observation in production, so a real launch is NOT_DEPLOYED. The registry charity wallet is used only when it is
 * unambiguous (exactly one verified wallet); otherwise the charity comparison stays UNKNOWN.
 */
async function build(pool: Pool, l: Launch, audience: "owner" | "public") {
  const charity = await getCharity(pool, l.config.charityConfiguration.charityId);
  const verified = charity ? charity.wallets.filter((w) => w.verificationStatus === "verified" && isBase58Address(w.address)) : [];
  const subject: ProofSubject = {
    launchId: l.id, dataSource: l.dataSource, config: l.config, fingerprint: l.fingerprint,
    charity: charity ? { id: charity.id, name: charity.name, walletAddress: verified.length === 1 ? verified[0]!.address : null } : null,
  };
  const s = await getProofState(pool, l.id);
  return respond(LaunchProof, buildLaunchProof({ subject, deployment: s.deployment, observation: s.observation, observationCount: s.observationCount, historyIntact: s.historyIntact, audience }));
}

export const launchProofRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const auth = requireAuth(pool, config);
  app.get("/api/launches/:id/proof", { preHandler: auth }, async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const { id } = parse(IdParams, req.params);
    const l = await getLaunch(pool, actorOf(req).userId, id);
    if (!l) throw notFound("Launch");
    return build(pool, l, "owner");
  });
  app.get("/api/public/launches/:id/proof", async (req) => {
    const { id } = parse(IdParams, req.params);
    const l = await getPublicLaunch(pool, id);
    if (!l) throw notFound("Launch");
    return build(pool, l, "public");
  });
};
