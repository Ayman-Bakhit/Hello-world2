import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  API_VERSION, AuthStatusResponse, DEMO_IDS, LogoutResponse, NonceRequest, NonceResponse, SIGN_IN_MESSAGE_VERSION,
  SessionResponse, VerifyRequest, type Wallet,
} from "@project-name/shared";
import { devSessionsAllowed, presentedToken } from "../auth/plugin";
import { createSession, lookupSession, revokeSession } from "../auth/session";
import { issueChallenge, verifySignIn } from "../auth/signin";
import type { Config } from "../config";
import { getWalletById } from "../db/repos";
import { ApiError } from "../errors";
import { parse, respond } from "../http/validate";
import type { Deps } from "./index";

const cookieOptions = (config: Config) => ({ path: "/", httpOnly: true, secure: config.cookieSecure, sameSite: config.COOKIE_SAMESITE });

function setSessionCookie(reply: FastifyReply, config: Config, token: string, expiresAt: Date): void {
  void reply.setCookie(config.cookieName, token, { ...cookieOptions(config), expires: expiresAt });
}

export const authRoutes: FastifyPluginAsync<Deps> = async (app, { config, pool }) => {
  const limit = { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } };
  const noStore = (reply: FastifyReply) => void reply.header("cache-control", "no-store");

  app.get("/api/auth/status", async () =>
    respond(AuthStatusResponse, {
      mode: config.AUTH_MODE,
      walletSignIn: { implemented: true, messageVersion: SIGN_IN_MESSAGE_VERSION, nonceTtlSeconds: config.NONCE_TTL_SECONDS, chainId: config.chainId, domain: config.authDomain },
      // The auth flow is real; the API as a whole still serves demo data and has open gaps (docs/THREAT_MODEL.md).
      productionReady: false,
    }),
  );

  /** Step 1: request a challenge for a wallet address. Public, rate limited, cap on open challenges per address. */
  app.post("/api/auth/nonce", { config: limit }, async (req, reply) => {
    const body = parse(NonceRequest, req.body);
    noStore(reply);
    return respond(NonceResponse, await issueChallenge(pool, config, body.address));
  });

  /**
   * Step 2: submit the wallet's signature over the exact challenge text. On success: user/wallet
   * lookup-or-create, wallet marked verified, session cookie set (HttpOnly). The body NEVER contains the token.
   * Every failure is the same 401 so responses do not reveal which check failed (the reason is logged, not returned).
   */
  app.post("/api/auth/verify", { config: limit }, async (req, reply) => {
    const body = parse(VerifyRequest, req.body);
    const result = await verifySignIn(pool, config, { address: body.address, nonce: body.nonce, message: body.message, signature: new Uint8Array(Buffer.from(body.signature, "base64")) });
    noStore(reply);
    if (!result.ok) {
      req.log.info({ reason: result.reason }, "wallet sign-in rejected");
      throw new ApiError(401, "AUTH_FAILED", "Sign-in failed. Request a new challenge and try again.");
    }
    // Session rotation: whatever session this browser presented before is revoked at login.
    const prev = presentedToken(req, config);
    if (prev) await revokeSession(pool, prev.token);
    setSessionCookie(reply, config, result.session.token, result.session.expiresAt);
    const wallet = await getWalletById(pool, result.walletId);
    return respond(SessionResponse, {
      authenticated: true, user: { id: result.userId }, wallet,
      session: { expiresAt: result.session.expiresAt.toISOString(), authMethod: "wallet_signature" },
    });
  });

  /** Who am I? Public so the web app can ask on page load; never errors for "not logged in". */
  app.get("/api/auth/session", async (req, reply) => {
    noStore(reply);
    const t = presentedToken(req, config);
    const s = t ? await lookupSession(pool, t.token, { allowDev: devSessionsAllowed(config) }) : null;
    if (!s) return respond(SessionResponse, { authenticated: false, user: null, wallet: null, session: null });
    const wallet: Wallet | null = s.walletId ? await getWalletById(pool, s.walletId) : null;
    return respond(SessionResponse, {
      authenticated: true, user: { id: s.userId }, wallet, session: { expiresAt: s.expiresAt.toISOString(), authMethod: s.authMethod },
    });
  });

  /** Revokes the presented session server-side and clears the cookie. Idempotent. */
  app.post("/api/auth/logout", { config: limit }, async (req, reply) => {
    noStore(reply);
    const t = presentedToken(req, config);
    if (t) await revokeSession(pool, t.token);
    void reply.clearCookie(config.cookieName, cookieOptions(config));
    return respond(LogoutResponse, { loggedOut: true });
  });

  if (config.AUTH_MODE === "dev-insecure") {
    /**
     * LOCAL DEVELOPMENT ONLY. Issues a bearer session for the seeded demo user with NO proof of wallet control.
     * Registered only when AUTH_MODE=dev-insecure; config refuses that mode when NODE_ENV=production; and even
     * if such a session row existed, production request handling rejects auth_method=dev_insecure sessions.
     * It cannot target a real user: it only ever logs in the seeded users flagged is_demo.
     */
    app.post("/api/auth/dev-session", { config: limit }, async (_req, reply) => {
      if (config.NODE_ENV === "production") throw new ApiError(404, "NOT_FOUND", "Route not found");
      const u = await pool.query("SELECT id FROM users WHERE id = $1 AND is_demo = true", [DEMO_IDS.user]);
      if (!u.rows[0]) throw new ApiError(409, "DEMO_DATA_MISSING", "Demo user not found. Run db:seed-demo.");
      const { token, expiresAt } = await createSession(pool, { userId: DEMO_IDS.user, walletId: null, authMethod: "dev_insecure", ttlHours: config.SESSION_TTL_HOURS });
      noStore(reply);
      return reply.code(201).send({ token, expiresAt: expiresAt.toISOString(), warning: "dev-insecure session: no wallet signature was verified", apiVersion: API_VERSION });
    });
  }
};
