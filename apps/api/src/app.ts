import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config";
import type { Pool } from "./db/pool";
import { csrfGuard } from "./auth/plugin";
import { registerErrorHandling } from "./errors";
import { ObservationHistoricalPriceProvider, type HistoricalPriceProvider } from "./prices/historical";
import { IndexerService, createIndexerParts, type IndexerParts } from "./indexer/service";
import { registerRoutes } from "./routes";

declare module "fastify" {
  interface FastifyInstance {
    indexer: IndexerService;
    taxPrices: HistoricalPriceProvider;
  }
}

export async function buildApp(deps: { config: Config; pool: Pool; logStream?: { write(msg: string): void }; /** test seam: replaces the RPC / metadata / price providers */ indexer?: IndexerParts; /** test seam: historical price source for tax */ taxPrices?: HistoricalPriceProvider }): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(deps.logStream ? { stream: deps.logStream } : {}),
      // Secrets never reach logs.
      redact: { paths: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"], censor: "[redacted]" },
    },
    bodyLimit: 64 * 1024,
    trustProxy: config.TRUST_PROXY,
  });

  registerErrorHandling(app);
  await app.register(helmet);
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    // Needed for the HttpOnly session cookie. Safe only because origins are an exact allowlist (wildcards are rejected at config load).
    credentials: true,
    maxAge: 600,
  });
  await app.register(cookie);
  app.addHook("onRequest", csrfGuard(config));
  // In-memory limiter: fine for one process. Use a shared store (Redis) before running multiple instances.
  await app.register(rateLimit, { global: true, max: config.RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW });

  app.decorateRequest("actor", null);
  const indexer = new IndexerService(deps.pool, config, deps.indexer ?? createIndexerParts(config), app.log);
  app.decorate("indexer", indexer);
  app.decorate("taxPrices", deps.taxPrices ?? new ObservationHistoricalPriceProvider(deps.pool, config.TAX_PRICE_MAX_AGE_SECONDS));
  await indexer.sweepStale();
  app.addHook("onClose", async () => { await indexer.drain(); });
  await registerRoutes(app, deps);
  return app;
}
