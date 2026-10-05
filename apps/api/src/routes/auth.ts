import type { FastifyPluginAsync } from "fastify";
import { DEMO_IDS } from "@project-name/shared";
import { createSession } from "../auth/session";
import { WALLET_AUTH_STATUS } from "../auth/walletAuth";
import { ApiError } from "../errors";
import type { Deps } from "./index";

export const authRoutes: FastifyPluginAsync<Deps> = async (app, { config, pool }) => {
  app.get("/api/auth/status", async () => ({
    mode: config.AUTH_MODE,
    walletSignIn: WALLET_AUTH_STATUS,
    productionReady: false,
  }));

  // Wallet sign-in is not implemented. Honest 501s, not a fake success.
  const notImplemented = () => {
    throw new ApiError(501, "NOT_IMPLEMENTED", "Wallet signature sign-in is not implemented yet (Slice 2). No session can be issued in this build.");
  };
  app.post("/api/auth/nonce", { config: { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } } }, notImplemented);
  app.post("/api/auth/verify", { config: { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } } }, notImplemented);

  if (config.AUTH_MODE === "dev-insecure") {
    /**
     * LOCAL DEVELOPMENT ONLY. Issues a session for the seeded demo user with NO proof of wallet control.
     * Not registered unless AUTH_MODE=dev-insecure; config refuses that mode when NODE_ENV=production.
     * Cannot impersonate real users: restricted to users flagged is_demo.
     */
    app.post("/api/auth/dev-session", { config: { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } } }, async (_req, reply) => {
      const u = await pool.query("SELECT id FROM users WHERE id = $1 AND is_demo = true", [DEMO_IDS.user]);
      if (!u.rows[0]) throw new ApiError(409, "DEMO_DATA_MISSING", "Demo user not found. Run db:seed-demo.");
      const { token, expiresAt } = await createSession(pool, DEMO_IDS.user, config.SESSION_TTL_HOURS);
      return reply.code(201).send({ token, expiresAt: expiresAt.toISOString(), warning: "dev-insecure session: no wallet signature was verified" });
    });
  }
};
