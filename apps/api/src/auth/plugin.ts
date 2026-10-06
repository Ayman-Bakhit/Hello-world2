import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config";
import type { Pool } from "../db/pool";
import { ApiError } from "../errors";
import { lookupSession, type SessionInfo } from "./session";

export interface Actor {
  userId: string;
  walletId: string | null;
  authMethod: SessionInfo["authMethod"];
}

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

/** The session token presented by the request: Authorization bearer first, else the HttpOnly cookie. */
export function presentedToken(req: FastifyRequest, config: Config): { token: string; via: "bearer" | "cookie" } | null {
  const header = req.headers.authorization;
  const m = typeof header === "string" ? /^Bearer (\S+)$/.exec(header) : null;
  if (m?.[1]) return { token: m[1], via: "bearer" };
  const c = req.cookies?.[config.cookieName];
  return typeof c === "string" && c ? { token: c, via: "cookie" } : null;
}

export const devSessionsAllowed = (config: Config) => config.NODE_ENV !== "production";

/**
 * AUTHENTICATION BOUNDARY: a valid, unexpired, unrevoked session maps to exactly one user.
 * In production, sessions created by the dev-only endpoint are rejected even if one exists in the database.
 * AUTHORIZATION BOUNDARY: every wallet-scoped query also filters by that user id (see db/repos.ts);
 * a resource owned by someone else is reported as 404 so existence is not leaked.
 */
export function requireAuth(pool: Pool, config: Config) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const t = presentedToken(req, config);
    const s = t ? await lookupSession(pool, t.token, { allowDev: devSessionsAllowed(config) }) : null;
    if (!s) throw new ApiError(401, "UNAUTHENTICATED", "A valid session is required");
    req.actor = { userId: s.userId, walletId: s.walletId, authMethod: s.authMethod };
  };
}

export function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new ApiError(401, "UNAUTHENTICATED", "A valid session is required");
  return req.actor;
}

/**
 * CSRF defense for cookie sessions (OWASP "verify origin with standard headers") on top of SameSite:
 * any state-changing request that carries an Origin must come from an allowlisted origin, and a
 * state-changing request that presents the session COOKIE must carry an allowlisted Origin
 * (browsers always send it on cross-origin and same-origin POST). Bearer/no-cookie clients are unaffected.
 */
export function csrfGuard(config: Config) {
  const allowed = new Set(config.CORS_ORIGINS);
  return async (req: FastifyRequest): Promise<void> => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!allowed.has(origin)) throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed");
      return;
    }
    if (req.cookies?.[config.cookieName]) throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Cookie-authenticated requests must include an allowed Origin");
  };
}
