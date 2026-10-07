import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CHARITY_EVIDENCE_CAVEAT, Charity, CharitiesQuery, CharityEvidenceResponse, CharityList } from "@project-name/shared";
import { getCharity, listCharities, listCharityEvidence } from "../db/repos";
import { notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Deps } from "./index";

const IdParams = z.strictObject({ id: z.string().uuid() });

/**
 * Public registry and public evidence, database-backed and read-only. Nothing here is donor-specific, and nothing here is
 * admin-only: internal verification notes, verifier identity and internal evidence notes are not selected by the repositories.
 * verificationState rests on evidence rows; a demo charity can only rest on FIXTURE evidence and is labeled dataSource "demo".
 */
export const charityRoutes: FastifyPluginAsync<Deps> = async (app, { pool }) => {
  app.get("/api/charities", async (req) => {
    const q = parse(CharitiesQuery, req.query);
    return respond(CharityList, { charities: await listCharities(pool, q.verified === undefined ? undefined : q.verified === "true") });
  });

  app.get("/api/charities/:id", async (req) => {
    const { id } = parse(IdParams, req.params);
    const c = await getCharity(pool, id);
    if (!c) throw notFound("Charity");
    return respond(Charity, c);
  });

  app.get("/api/charities/:id/evidence", async (req) => {
    const { id } = parse(IdParams, req.params);
    const c = await getCharity(pool, id);
    if (!c) throw notFound("Charity");
    return respond(CharityEvidenceResponse, {
      charityId: c.id, verificationState: c.verificationState, verificationSource: c.verificationSource, lastReviewedAt: c.lastReviewedAt,
      evidence: await listCharityEvidence(pool, c.id), caveat: CHARITY_EVIDENCE_CAVEAT, dataSource: c.dataSource,
    });
  });
};
