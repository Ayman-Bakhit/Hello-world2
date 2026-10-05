import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { DEMO_TOKENS, TokenList, TokenProof, buildTokenProof, summarizeToken } from "@project-name/shared";
import { notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Deps } from "./index";

export const TokenParams = z.strictObject({ id: z.string().regex(/^[a-z0-9-]{1,48}$/) });

/** DEMO-BACKED and public. No launched (real) tokens exist, so only fictional demo tokens are returned. */
export const tokenRoutes: FastifyPluginAsync<Deps> = async (app) => {
  app.get("/api/tokens", async () => respond(TokenList, { tokens: DEMO_TOKENS.map(summarizeToken), dataSource: "demo", verifiedOnChain: false }));

  app.get("/api/tokens/:id/proof", async (req) => {
    const { id } = parse(TokenParams, req.params);
    const p = buildTokenProof(id);
    if (!p) throw notFound("Token");
    return respond(TokenProof, p);
  });
};
