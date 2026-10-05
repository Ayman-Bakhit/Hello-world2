import type { FastifyPluginAsync } from "fastify";
import { API_VERSION, HealthResponse } from "@project-name/shared";
import { respond } from "../http/validate";
import type { Deps } from "./index";

/** Liveness only: no database call, no config echo. */
export const healthRoutes: FastifyPluginAsync<Deps> = async (app) => {
  const handler = async () => respond(HealthResponse, { status: "ok", service: "api", version: API_VERSION });
  app.get("/health", handler);
  app.get("/api/health", handler);
};
