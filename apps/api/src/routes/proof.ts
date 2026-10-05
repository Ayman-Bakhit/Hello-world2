import type { FastifyPluginAsync } from "fastify";
import { TokenProof, buildTokenProof } from "@project-name/shared";
import { notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Deps } from "./index";
import { TokenParams } from "./tokens";

/** Public proof page data (same payload as /api/tokens/:id/proof). */
export const proofRoutes: FastifyPluginAsync<Deps> = async (app) => {
  app.get("/api/proof/:id", async (req) => {
    const { id } = parse(TokenParams, req.params);
    const p = buildTokenProof(id);
    if (!p) throw notFound("Token");
    return respond(TokenProof, p);
  });
};
