import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Charity, CharitiesQuery, CharityList } from "@project-name/shared";
import { getCharity, listCharities } from "../db/repos";
import { notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Deps } from "./index";

/** Public, database-backed. verificationStatus is whatever admin review recorded; demo rows are labeled dataSource "demo". */
export const charityRoutes: FastifyPluginAsync<Deps> = async (app, { pool }) => {
  app.get("/api/charities", async (req) => {
    const q = parse(CharitiesQuery, req.query);
    return respond(CharityList, { charities: await listCharities(pool, q.verified === undefined ? undefined : q.verified === "true") });
  });

  app.get("/api/charities/:id", async (req) => {
    const { id } = parse(z.strictObject({ id: z.string().uuid() }), req.params);
    const c = await getCharity(pool, id);
    if (!c) throw notFound("Charity");
    return respond(Charity, c);
  });
};
