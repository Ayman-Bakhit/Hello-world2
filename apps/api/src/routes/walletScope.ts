import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { actorOf } from "../auth/plugin";
import type { Pool } from "../db/pool";
import { getOwnedWallet } from "../db/repos";
import { notFound } from "../errors";
import { parse } from "../http/validate";

const Params = z.strictObject({ walletId: z.string().uuid() });

/** Validates :walletId and enforces ownership. Foreign and unknown wallets are indistinguishable (404). */
export async function ownedWalletFromParams(pool: Pool, req: FastifyRequest) {
  const { walletId } = parse(Params, req.params);
  const wallet = await getOwnedWallet(pool, actorOf(req).userId, walletId);
  if (!wallet) throw notFound("Wallet");
  return wallet;
}
