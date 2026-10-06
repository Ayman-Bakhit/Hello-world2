import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CreateManualBasisRequest, ManualBasisDetail, ManualBasisList, ManualBasisView, ManualBasisValidationError, ReviseManualBasisRequest, VoidManualBasisRequest,
  normalizeManualBasis, type ManualBasisReview,
} from "@project-name/shared";
import { actorOf, requireAuth } from "../auth/plugin";
import { createBasis, getBasis, knownDecimals, listBasis, reviseBasis, RepoError, voidBasis, type BasisRow } from "../db/manualBasisRepos";
import { getOwnedWallet } from "../db/repos";
import { ApiError, notFound } from "../errors";
import { parse, respond } from "../http/validate";
import { basisDetail, basisView } from "../services/manualBasis";
import { runUserTax } from "../services/tax";
import type { Deps } from "./index";

const WalletParam = z.strictObject({ id: z.string().uuid() });
const RecordParams = z.strictObject({ id: z.string().uuid(), basisId: z.string().uuid() });
const ListQuery = z.strictObject({ includeVoided: z.enum(["true", "false"]).default("false") });

/**
 * USER_PROVIDED cost basis. Every operation is scoped by the session's user AND the path wallet, both checked in SQL; a
 * record id alone never grants access, and foreign/unknown records are indistinguishable (404). There is no DELETE:
 * corrections and voids are new, immutable, hash-chained revisions. Nothing here is verified against any blockchain.
 */
export const manualBasisRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const auth = requireAuth(pool, config);
  const write = { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } };

  const walletOf = async (req: FastifyRequest, withRecord = false) => {
    const p = parse(withRecord ? RecordParams : WalletParam, req.params) as { id: string; basisId?: string };
    const w = await getOwnedWallet(pool, actorOf(req).userId, p.id);
    if (!w) throw notFound("Wallet");
    if (w.dataSource === "demo") throw new ApiError(409, "MANUAL_BASIS_UNSUPPORTED", "Demo wallets use fixture data. Cost basis can only be added to real wallets.");
    return { wallet: w, basisId: p.basisId };
  };
  const reviews = async (userId: string): Promise<Map<string, ManualBasisReview>> => {
    const run = await runUserTax({ pool, prices: app.taxPrices, maxTransactions: config.TAX_MAX_TRANSACTIONS, gate: app.taxGate }, userId, {});
    return new Map(run.result.manualBasisReview.map((r) => [r.manualBasisId, r]));
  };
  const toApi = (e: unknown): never => {
    if (e instanceof ManualBasisValidationError) throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", e.fields);
    if (e instanceof RepoError) {
      const map = { NOT_FOUND: [404, "NOT_FOUND"], STALE_REVISION: [409, "STALE_REVISION"], VOIDED: [409, "BASIS_VOIDED"], LIMIT_REACHED: [409, "LIMIT_REACHED"] } as const;
      const [status, code] = map[e.code];
      throw new ApiError(status, code, e.code === "NOT_FOUND" ? "Cost basis record not found" : e.message);
    }
    throw e;
  };
  const one = async (userId: string, b: BasisRow) => basisView(b, (await reviews(userId)).get(b.id) ?? null);

  app.get("/api/wallets/:id/manual-basis", { preHandler: auth }, async (req) => {
    const { wallet } = await walletOf(req);
    const q = parse(ListQuery, req.query);
    const userId = actorOf(req).userId;
    const [rows, rv] = await Promise.all([listBasis(pool, userId, wallet.id, q.includeVoided === "true"), reviews(userId)]);
    return respond(ManualBasisList, { walletId: wallet.id, source: "USER_PROVIDED", records: rows.map((b) => basisView(b, rv.get(b.id) ?? null)) });
  });

  app.post("/api/wallets/:id/manual-basis", { preHandler: auth, config: write }, async (req, reply) => {
    const { wallet } = await walletOf(req);
    const body = parse(CreateManualBasisRequest, req.body);
    const userId = actorOf(req).userId;
    try {
      const n = normalizeManualBasis(body, { knownDecimals: await knownDecimals(pool, body.asset), nowUnix: Math.floor(Date.now() / 1000) });
      const b = await createBasis(pool, { userId, walletId: wallet.id, authMethod: actorOf(req).authMethod, n });
      return reply.code(201).send(respond(ManualBasisView, await one(userId, b)));
    } catch (e) { return toApi(e); }
  });

  app.get("/api/wallets/:id/manual-basis/:basisId", { preHandler: auth }, async (req) => {
    const { wallet, basisId } = await walletOf(req, true);
    const userId = actorOf(req).userId;
    const b = await getBasis(pool, userId, wallet.id, basisId!);
    if (!b) throw notFound("Cost basis record");
    const d = await basisDetail(pool, b, (await reviews(userId)).get(b.id) ?? null);
    return { ...respond(ManualBasisDetail, d), historyIntact: d.historyIntact };
  });

  /** Correction = a NEW revision (full replacement of the editable fields) with a mandatory reason. The old values stay in the history. */
  app.post("/api/wallets/:id/manual-basis/:basisId/revisions", { preHandler: auth, config: write }, async (req) => {
    const { wallet, basisId } = await walletOf(req, true);
    const body = parse(ReviseManualBasisRequest, req.body);
    const userId = actorOf(req).userId;
    const cur = await getBasis(pool, userId, wallet.id, basisId!);
    if (!cur) throw notFound("Cost basis record");
    try {
      const n = normalizeManualBasis({ ...body, asset: cur.asset, decimals: cur.decimals }, { knownDecimals: cur.decimals, nowUnix: Math.floor(Date.now() / 1000) });
      const b = await reviseBasis(pool, { userId, walletId: wallet.id, id: cur.id, f: { quantity: n.quantityRaw, acquiredAt: n.acquiredAt, costBasisCents: n.costBasisCents, reason: n.reason, signature: n.signature, notes: n.notes, acknowledgeOverlap: body.acknowledgeOverlap, changeReason: body.changeReason, expectedRevision: body.expectedRevision } });
      return respond(ManualBasisView, await one(userId, b));
    } catch (e) { return toApi(e); }
  });

  /** Soft removal: a "void" revision. The record and its history remain; it stops counting in tax calculations. */
  app.post("/api/wallets/:id/manual-basis/:basisId/void", { preHandler: auth, config: write }, async (req) => {
    const { wallet, basisId } = await walletOf(req, true);
    const body = parse(VoidManualBasisRequest, req.body);
    const userId = actorOf(req).userId;
    try {
      const b = await voidBasis(pool, { userId, walletId: wallet.id, id: basisId!, changeReason: body.changeReason, expectedRevision: body.expectedRevision });
      return respond(ManualBasisView, basisView(b, null));
    } catch (e) { return toApi(e); }
  });
};
