import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { actorOf } from "../auth/plugin";
import type { Pool } from "../db/pool";
import { getOwnedWallet } from "../db/repos";
import { notFound } from "../errors";
import { parse } from "../http/validate";

const Uuid = z.string().uuid();

/** Validates :walletId and enforces ownership. Foreign and unknown wallets are indistinguishable (404). */
export async function ownedWalletFromParams(pool: Pool, req: FastifyRequest, key: "walletId" | "id" = "walletId") {
  const walletId = parse(z.strictObject({ [key]: Uuid }), req.params)[key] as string;
  const wallet = await getOwnedWallet(pool, actorOf(req).userId, walletId);
  if (!wallet) throw notFound("Wallet");
  return wallet;
}
