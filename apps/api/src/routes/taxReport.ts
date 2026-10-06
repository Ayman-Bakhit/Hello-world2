import type { FastifyPluginAsync } from "fastify";
import {
  TaxQuery, TaxReportExportRequest, TaxReportResponse, buildDemoTaxReport, canonicalReport, exportFilename, reportToCsv, reportToJson, type TaxReport,
} from "@project-name/shared";
import { createHash } from "node:crypto";
import { actorOf, requireAuth } from "../auth/plugin";
import { ApiError } from "../errors";
import { parse, respond } from "../http/validate";
import { runUserTax, taxReportOf } from "../services/tax";
import type { Deps } from "./index";
import { ownedWalletFromParams } from "./walletScope";

/**
 * Tax REPORT and EXPORT: a read-only view over the same calculation the Tax Center uses. Session + ownership on every
 * route (the wallet comes from the path and is checked in SQL; the data is the session user's own). Nothing is stored.
 * Estimates for planning and review only.
 */
export const taxReportRoutes: FastifyPluginAsync<Deps> = async (app, { pool, config }) => {
  const auth = requireAuth(pool, config);
  const limits = { maxRows: config.REPORT_MAX_ROWS, transactionCap: config.TAX_MAX_TRANSACTIONS };

  const build = async (req: Parameters<typeof actorOf>[0], wallet: { id: string; dataSource: string }, q: { taxYear?: number | undefined; method?: "FIFO" | "LIFO" | "HIFO" | undefined; swapTreatment?: "DISPOSAL_AND_ACQUISITION" | "NOT_ASSESSED" | undefined }): Promise<TaxReport> => {
    if (wallet.dataSource === "demo") {
      const d = buildDemoTaxReport(wallet.id, new Date().toISOString())!;
      d.reportHash = createHash("sha256").update(canonicalReport(d)).digest("hex");
      return d;
    }
    const run = await runUserTax({ pool, prices: app.taxPrices, maxTransactions: config.TAX_MAX_TRANSACTIONS, gate: app.taxGate }, actorOf(req).userId, {
      ...(q.taxYear !== undefined ? { taxYear: q.taxYear } : {}), ...(q.method ? { method: q.method } : {}), ...(q.swapTreatment ? { swapTreatment: q.swapTreatment } : {}),
    });
    return taxReportOf(wallet.id, run, limits);
  };

  app.get("/api/tax/:walletId/report", { preHandler: auth, config: { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX * 3, timeWindow: config.RATE_LIMIT_WINDOW } } }, async (req, reply) => {
    const wallet = await ownedWalletFromParams(pool, req);
    const q = parse(TaxQuery, req.query);
    void reply.header("cache-control", "no-store");
    return respond(TaxReportResponse, await build(req, wallet, q));
  });

  app.post("/api/tax/:walletId/report/export", { preHandler: auth, config: { rateLimit: { max: config.RATE_LIMIT_WRITE_MAX, timeWindow: config.RATE_LIMIT_WINDOW } } }, async (req, reply) => {
    const wallet = await ownedWalletFromParams(pool, req);
    const body = parse(TaxReportExportRequest, req.body);
    const report = await build(req, wallet, body);
    if (report.limits.rowsExceeded) {
      throw new ApiError(413, "EXPORT_TOO_LARGE", `This report has more than ${report.limits.maxRows} disposals, which is more than an export can list. Nothing was truncated; narrow the tax year.`);
    }
    // validate what leaves the server against the shared contract (a server bug becomes a 500, never a malformed file)
    respond(TaxReportResponse, report);
    const csv = body.format === "csv";
    void reply
      .header("content-type", csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="${exportFilename(report, body.format)}"`)
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff");
    return reply.send(csv ? reportToCsv(report) : reportToJson(report));
  });
};
