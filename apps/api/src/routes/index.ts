import type { FastifyInstance } from "fastify";
import type { Config } from "../config";
import type { Pool } from "../db/pool";
import { authRoutes } from "./auth";
import { charityRoutes } from "./charities";
import { discoverRoutes } from "./discover";
import { donationRoutes } from "./donations";
import { healthRoutes } from "./health";
import { launchRoutes } from "./launches";
import { publicLaunchRoutes } from "./publicLaunches";
import { manualBasisRoutes } from "./manualBasis";
import { portfolioRoutes } from "./portfolio";
import { proofRoutes } from "./proof";
import { syncRoutes } from "./sync";
import { taxReportRoutes } from "./taxReport";
import { taxReserveRoutes } from "./taxReserve";
import { taxRoutes } from "./tax";
import { tokenRoutes } from "./tokens";
import { transactionRoutes } from "./transactions";
import { walletRoutes } from "./wallets";

export interface Deps {
  config: Config;
  pool: Pool;
}

/** Public: health, auth status, charities, tokens, proof, discover. Everything else needs a session. */
export async function registerRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  await app.register(healthRoutes, deps);
  await app.register(authRoutes, deps);
  await app.register(walletRoutes, deps);
  await app.register(syncRoutes, deps);
  await app.register(manualBasisRoutes, deps);
  await app.register(portfolioRoutes, deps);
  await app.register(transactionRoutes, deps);
  await app.register(taxRoutes, deps);
  await app.register(taxReportRoutes, deps);
  await app.register(taxReserveRoutes, deps);
  await app.register(charityRoutes, deps);
  await app.register(donationRoutes, deps);
  await app.register(launchRoutes, deps);
  await app.register(publicLaunchRoutes, deps);
  await app.register(tokenRoutes, deps);
  await app.register(proofRoutes, deps);
  await app.register(discoverRoutes, deps);
}
