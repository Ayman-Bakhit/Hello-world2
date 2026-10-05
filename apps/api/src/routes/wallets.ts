import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Wallet, WalletList } from "@project-name/shared";
import { actorOf, requireAuth } from "../auth/plugin";
import { getOwnedWallet, listWallets } from "../db/repos";
import { notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Deps } from "./index";

export const WalletParams = z.strictObject({ walletId: z.string().uuid() });

/** Wallet records hold public information only. This API has no field for keys, seeds, or secrets. */
export const walletRoutes: FastifyPluginAsync<Deps> = async (app, { pool }) => {
  const auth = requireAuth(pool);

  app.get("/api/wallets", { preHandler: auth }, async (req) => respond(WalletList, { wallets: await listWallets(pool, actorOf(req).userId) }));

  app.get("/api/wallets/:id", { preHandler: auth }, async (req) => {
    const { walletId } = parse(WalletParams, { walletId: (req.params as { id: string }).id });
    const w = await getOwnedWallet(pool, actorOf(req).userId, walletId);
    if (!w) throw notFound("Wallet");
    return respond(Wallet, w);
  });
};
