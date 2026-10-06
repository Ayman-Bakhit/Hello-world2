import type { FastifyPluginAsync } from "fastify";
import { TransactionsQuery, TransactionsResponse, buildTransactions } from "@project-name/shared";
import { requireAuth } from "../auth/plugin";
import { notFound } from "../errors";
import { parse, respond } from "../http/validate";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

/** DEMO-BACKED. Records carry source "demo"; indexed (chain) records do not exist yet. */
export const transactionRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  app.get("/api/transactions/:walletId", { preHandler: requireAuth(pool, config) }, async (req) => {
    const wallet = await ownedWalletFromParams(pool, req);
    const { limit, offset } = parse(TransactionsQuery, req.query);
    const body = wallet.dataSource === "demo" ? buildTransactions(wallet.id, limit, offset) : null;
    if (!body) throw notFound("Transaction data");
    return respond(TransactionsResponse, body);
  });
};
