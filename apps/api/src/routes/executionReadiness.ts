import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  DEPLOYMENT_POLICY, DeploymentAttemptList, DeploymentDecisionSummary, ExecutionReadinessResponse, buildDecisionSummary, buildDeploymentPlan, buildReadinessResponse, evaluateExecutionReadiness, factsFromPolicy,
} from "@project-name/shared";
import { actorOf, requireAuth } from "../auth/plugin";
import { listAttempts } from "../db/attemptRepos";
import { planState } from "../db/deploymentRepos";
import { getLaunch } from "../db/launchRepos";
import { notFound } from "../errors";
import { parse, respond } from "../http/validate";
import { charityForPlan } from "./deploymentPlan";
import type { Deps } from "./index";

const IdParams = z.strictObject({ id: z.string().uuid() });

/**
 * Execution READINESS, decisions and attempts: owner-only, read-only, server-derived, never cached. Nothing here accepts a flag
 * (ready, approved, executionEnabled) and there is no route that signs, sends, submits, broadcasts or confirms. Even when every
 * prerequisite passes the answer is EXECUTION_DISABLED. Nothing here is public: it discusses destinations and internal review state.
 */
export const executionReadinessRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const auth = requireAuth(pool, config);

  async function evaluate(userId: string, id: string) {
    const launch = await getLaunch(pool, userId, id);
    if (!launch) throw notFound("Launch");
    const charity = await charityForPlan(pool, launch);
    const built = buildDeploymentPlan({ launch, charity, policy: DEPLOYMENT_POLICY, facts: factsFromPolicy(DEPLOYMENT_POLICY) });
    const state = built.ok ? await planState(pool, id, built.plan.identity.planHash) : undefined;
    return { launch, readiness: evaluateExecutionReadiness({ launch, charity, policy: DEPLOYMENT_POLICY, ...(state ? { planState: state } : {}) }) };
  }

  app.get("/api/launches/:id/execution-readiness", { preHandler: auth }, async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const { id } = parse(IdParams, req.params);
    const { launch, readiness } = await evaluate(actorOf(req).userId, id);
    return respond(ExecutionReadinessResponse, buildReadinessResponse(launch, readiness));
  });

  app.get("/api/launches/:id/deployment-decision-summary", { preHandler: auth }, async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const { id } = parse(IdParams, req.params);
    const { launch, readiness } = await evaluate(actorOf(req).userId, id);
    return respond(DeploymentDecisionSummary, buildDecisionSummary(launch, readiness, DEPLOYMENT_POLICY));
  });

  app.get("/api/launches/:id/deployment-attempts", { preHandler: auth }, async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const { id } = parse(IdParams, req.params);
    const launch = await getLaunch(pool, actorOf(req).userId, id);
    if (!launch) throw notFound("Launch");
    return respond(DeploymentAttemptList, {
      launchId: id, attempts: await listAttempts(pool, id), execution: { enabled: false },
      note: "A READY launch can have no deployment attempt. Attempts are a separate, append-only record; none is created while real execution is disabled.",
    });
  });
};
