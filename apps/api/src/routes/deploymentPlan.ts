import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  DeploymentPlanResponse, DeploymentReviewResponse, buildDeploymentPlan, buildDeploymentReview, isValidSolanaAddress, type BuildError, type Launch, type PlanCharity,
} from "@project-name/shared";
import { actorOf, requireAuth } from "../auth/plugin";
import { planState, recordDeploymentPlan } from "../db/deploymentRepos";
import { getLaunch } from "../db/launchRepos";
import { getCharity } from "../db/repos";
import { ApiError, notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Pool } from "../db/pool";
import type { Deps } from "./index";

const IdParams = z.strictObject({ id: z.string().uuid() });

/** The registry charity as the builder needs it. A wallet is used only when exactly one verified, well-formed wallet exists. */
export async function charityForPlan(pool: Pool, launch: Launch): Promise<PlanCharity | null> {
  const c = await getCharity(pool, launch.config.charityConfiguration.charityId);
  if (!c) return null;
  const wallets = c.wallets.filter((w) => w.verificationStatus === "verified" && isValidSolanaAddress(w.address));
  return { id: c.id, verificationState: c.verificationState, walletAddress: wallets.length === 1 ? wallets[0]!.address : null };
}

const fieldsOf = (errors: BuildError[]) => {
  const f: Record<string, string[]> = {};
  for (const e of errors) (f[e.field] ??= []).push(`${e.code}: ${e.message}`);
  return f;
};

/**
 * Deployment PLAN review. Read-only except for recording a plan (append-only, owner only). There is no build-and-send, sign, submit,
 * confirm or deploy endpoint, and nothing here accepts key material (a global guard refuses it before any route runs). The plan is
 * derived from the stored, reviewed launch only; the request carries no parameters. A foreign and an unknown launch are the same 404.
 */
export const deploymentPlanRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const auth = requireAuth(pool, config);
  const writeLimit = { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } };

  async function build(userId: string, id: string) {
    const launch = await getLaunch(pool, userId, id);
    if (!launch) throw notFound("Launch");
    const r = buildDeploymentPlan({ launch, charity: await charityForPlan(pool, launch) });
    if (!r.ok) {
      const first = r.errors[0]!;
      const status = first.code === "LAUNCH_NOT_READY" || first.code === "STALE_REVIEW" ? 409 : 422;
      throw new ApiError(status, first.code, first.message, fieldsOf(r.errors));
    }
    return { launch, plan: r.plan };
  }

  app.get("/api/launches/:id/deployment-plan", { preHandler: auth }, async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const { id } = parse(IdParams, req.params);
    const { plan } = await build(actorOf(req).userId, id);
    return respond(DeploymentPlanResponse, { plan, review: buildDeploymentReview(plan), ...(await planState(pool, id, plan.identity.planHash)) });
  });

  app.get("/api/launches/:id/deployment-review", { preHandler: auth }, async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const { id } = parse(IdParams, req.params);
    const { plan } = await build(actorOf(req).userId, id);
    return respond(DeploymentReviewResponse, { review: buildDeploymentReview(plan), planId: plan.identity.planId });
  });

  /** Records the CURRENT plan (idempotent per plan hash). It does not build a transaction, sign, send or execute anything. */
  app.post("/api/launches/:id/deployment-plan", { preHandler: auth, config: writeLimit }, async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const { id } = parse(IdParams, req.params);
    parse(z.strictObject({}).nullish(), req.body ?? undefined);
    const { userId } = actorOf(req);
    const { plan } = await build(userId, id);
    const { created } = await recordDeploymentPlan(pool, { launchId: id, userId, plan });
    return reply.code(created ? 201 : 200).send(respond(DeploymentPlanResponse, { plan, review: buildDeploymentReview(plan), ...(await planState(pool, id, plan.identity.planHash)) }));
  });
};
