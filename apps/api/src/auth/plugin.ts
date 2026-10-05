import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../errors";
import type { Pool } from "../db/pool";
import { lookupSession } from "./session";

export interface Actor {
  userId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

/**
 * AUTHENTICATION BOUNDARY: a valid, unexpired, unrevoked bearer session maps to exactly one user.
 * AUTHORIZATION BOUNDARY: every wallet-scoped query also filters by that user id (see db/repos.ts);
 * a resource owned by someone else is reported as 404 so existence is not leaked.
 * What is NOT done here: issuing sessions from a wallet signature (see auth/walletAuth.ts).
 */
export function requireAuth(pool: Pool) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    const m = typeof header === "string" ? /^Bearer (\S+)$/.exec(header) : null;
    const session = m?.[1] ? await lookupSession(pool, m[1]) : null;
    if (!session) {
      throw new ApiError(401, "UNAUTHENTICATED", "A valid session is required");
    }
    req.actor = { userId: session.userId };
  };
}

export function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new ApiError(401, "UNAUTHENTICATED", "A valid session is required");
  return req.actor;
}
