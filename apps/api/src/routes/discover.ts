import type { FastifyPluginAsync } from "fastify";
import { DiscoverQuery, DiscoverResponse, buildDiscover } from "@project-name/shared";
import { parse, respond } from "../http/validate";
import type { Deps } from "./index";

/** DEMO-BACKED and public. Filters/sorts only fields that exist; boosts, paid placement, and synthetic metrics do not exist. */
export const discoverRoutes: FastifyPluginAsync<Deps> = async (app) => {
  app.get("/api/discover", async (req) => respond(DiscoverResponse, buildDiscover(parse(DiscoverQuery, req.query))));
};
