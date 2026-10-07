/**
 * Deployment plan fixtures (Slice 13). FIXTURE data only: deterministic launches and charities used to exercise the plan builder.
 * No fixture is ever signed, serialized or broadcast; there is no code path that could.
 */
import type { Launch, LaunchConfig } from "../api/schemas";
import { launchFingerprint, STATUS_MEANING } from "../launchModel";
import { buildDeploymentPlan, CURRENT_DEPLOYMENT_FACTS, type DeploymentFacts, type PlanCharity, type PlanInput, type PlanResult } from "../deployment";
import { DEMO_IDS } from "./fixtures";
import { FIXTURE_WALLETS, fixtureLaunchConfig } from "./proofFixtures";

export const DEPLOYMENT_FIXTURES = [
  "A_VALID_READY", "B_NOT_READY", "C_STALE_REVIEW", "D_INVALID_SUPPLY", "E_INVALID_DECIMALS", "F_INVALID_DESTINATION", "G_INVALID_AUTHORITY", "H_VALID_PLAN",
  "I_UNSUPPORTED_TOKEN_PROGRAM", "J_MISSING_METADATA", "K_MISSING_LIQUIDITY", "L_MISSING_FEE_ROUTING", "M_MAX_SAFE_VALUES", "N_OVERFLOW_BOUNDARY", "O_CHANGED_CONFIGURATION",
] as const;
export type DeploymentFixture = (typeof DEPLOYMENT_FIXTURES)[number];

export const FIXTURE_CHARITY: PlanCharity = { id: DEMO_IDS.charities.c1, verificationState: "VERIFIED", walletAddress: FIXTURE_WALLETS.charity };

/** a READY launch for a (possibly deliberately invalid) configuration, reviewed at that exact configuration unless `reviewedFingerprint` says otherwise */
export function fixtureReadyLaunch(config: LaunchConfig = fixtureLaunchConfig(), over: { status?: Launch["status"]; reviewedFingerprint?: string } = {}): Launch {
  const fp = launchFingerprint(config);
  return {
    id: DEMO_IDS.launch, status: over.status ?? "READY", statusMeaning: STATUS_MEANING[over.status ?? "READY"], config,
    review: {
      passed: true, errors: [], warnings: [], moneyFlowExampleCents: { creator: "60000", taxReserve: "15000", charity: "15000", protocol: "10000" }, feeSplitLabel: "Configured fee split",
      feeSplitEnforcement: "not_enforced", deployable: false, reviewedAt: "2026-01-01T00:00:00.000Z", fingerprint: over.reviewedFingerprint ?? fp, charity: null, allocations: [],
    },
    fingerprint: fp, revision: 5, publicVisible: true, readyAt: "2026-01-01T00:00:00.000Z",
    deployment: { status: "not_deployed", mintAddress: null, transactionSignature: null, contractAddress: null }, metadata: { source: "USER_PROVIDED", verifiedOnChain: false },
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", dataSource: "demo",
  };
}

const cfg = (over: Record<string, unknown>): LaunchConfig => ({ ...fixtureLaunchConfig(), ...over } as LaunchConfig);

export function deploymentFixtureInput(f: DeploymentFixture): PlanInput {
  const base: PlanInput = { launch: fixtureReadyLaunch(), charity: FIXTURE_CHARITY };
  switch (f) {
    case "A_VALID_READY": case "H_VALID_PLAN": case "J_MISSING_METADATA": case "K_MISSING_LIQUIDITY": case "L_MISSING_FEE_ROUTING": return base;
    case "B_NOT_READY": return { ...base, launch: fixtureReadyLaunch(undefined, { status: "REVIEW" }) };
    case "C_STALE_REVIEW": return { ...base, launch: fixtureReadyLaunch(undefined, { reviewedFingerprint: "a".repeat(64) }) };
    case "D_INVALID_SUPPLY": return { ...base, launch: fixtureReadyLaunch(cfg({ totalSupply: "0" })) };
    case "E_INVALID_DECIMALS": return { ...base, launch: fixtureReadyLaunch(cfg({ decimals: 10 })) };
    case "F_INVALID_DESTINATION": return { ...base, launch: fixtureReadyLaunch(cfg({ taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: "DEMO-not-a-valid-address-0000000" } })) };
    case "G_INVALID_AUTHORITY": return { ...base, launch: fixtureReadyLaunch(cfg({ mintAuthority: "root" })) };
    case "I_UNSUPPORTED_TOKEN_PROGRAM": return { ...base, tokenProgram: "TOKEN_2022" };
    case "M_MAX_SAFE_VALUES": return { ...base, launch: fixtureReadyLaunch(cfg({ totalSupply: "18446744073709551615", decimals: 0, creatorAllocationPercent: "0", liquidityConfiguration: { initialLiquidityUsdc: "1", supplyPercentage: "100", lockDays: 0 } })) };
    case "N_OVERFLOW_BOUNDARY": return { ...base, launch: fixtureReadyLaunch(cfg({ totalSupply: "18446744074", decimals: 9 })) };
    case "O_CHANGED_CONFIGURATION": return { ...base, launch: fixtureReadyLaunch(cfg({ name: "Changed Name" })) };
  }
}

export function buildDeploymentFixture(f: DeploymentFixture): PlanResult { return buildDeploymentPlan(deploymentFixtureInput(f)); }
export const FIXTURE_FACTS: DeploymentFacts = CURRENT_DEPLOYMENT_FACTS;
/** the labeled demo launch's plan (mock mode and tests) */
export function buildDemoDeploymentPlan() {
  const r = buildDeploymentFixture("H_VALID_PLAN");
  if (!r.ok) throw new Error("the demo deployment fixture must build");
  return r.plan;
}
