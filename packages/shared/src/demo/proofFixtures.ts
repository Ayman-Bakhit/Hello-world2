/**
 * Token Proof fixtures (Slice 12). Scenarios A-J. FIXTURE data only: deterministic, base58-shaped, never read from a chain.
 * A FIXTURE observation can never produce VERIFIED (see evaluateProof), however consistent it is. Mock mode and tests only;
 * nothing in the API's production path reads these.
 */
import { LaunchConfigSchema, type LaunchConfig } from "../api/schemas";
import { fakeBase58, fakeMint, fakeSignature } from "../chain/testing";
import { fixtureAddress } from "../deployment";
import { expectedSupply } from "../proof";
import type { DeploymentPolicy } from "../deploymentPolicy";
import { launchFingerprint } from "../launchModel";
import { buildLaunchProof, type ChainObservation, type DeploymentRecord, type LaunchProof, type Observed, type ProofSubject } from "../proof";
import { DEMO_IDS } from "./fixtures";

export const PROOF_SCENARIOS = [
  "NOT_DEPLOYED", "DEPLOYED_BUT_UNOBSERVED", "FULL_MATCH", "SUPPLY_MISMATCH", "DECIMALS_MISMATCH", "AUTHORITY_MISMATCH",
  "NETWORK_MISMATCH", "PARTIAL_OBSERVATION", "MISSING_METADATA", "UNAVAILABLE_OBSERVATION",
] as const;
export type ProofScenario = (typeof PROOF_SCENARIOS)[number];
export const PROOF_SCENARIO_LETTER: Record<ProofScenario, string> = Object.fromEntries(PROOF_SCENARIOS.map((s, i) => [s, String.fromCharCode(65 + i)])) as Record<ProofScenario, string>;

export const FIXTURE_OBSERVED_AT = "2026-01-02T00:00:00.000Z";
export const FIXTURE_WALLETS = {
  creator: fixtureAddress("creator"), reserve: fixtureAddress("reserve"), charity: fixtureAddress("charity"), other: fixtureAddress("other"),
};
export const FIXTURE_MINT = fakeMint("fixture-proof");
export const FIXTURE_SIGNATURE = fakeSignature("fixture-proof");

export function fixtureLaunchConfig(): LaunchConfig {
  return LaunchConfigSchema.parse({
    name: "Harbor Demo Launch", symbol: "HRBRD", description: "Fictional demo configuration. Nothing is deployed.", totalSupply: "1000000000", decimals: 6, network: "devnet",
    creatorAllocationPercent: "8", creatorWallet: FIXTURE_WALLETS.creator,
    liquidityConfiguration: { initialLiquidityUsdc: "50000", supplyPercentage: "40", lockDays: 30 },
    feeSplit: { creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 }, charityConfiguration: { charityId: DEMO_IDS.charities.c1 },
    taxReserveConfiguration: { destinationType: "creator_controlled", destinationAddress: FIXTURE_WALLETS.reserve },
  });
}

const ok = <T,>(value: T): Observed<T> => ({ status: "OBSERVED", value });
const gone = (reason: string): Observed<never> => ({ status: "UNAVAILABLE", reason });

/** An observation that matches the fixture configuration exactly (before any scenario mutation). */
export function matchingFixtureObservation(c: LaunchConfig): ChainObservation {
  return {
    source: "FIXTURE", observedAt: FIXTURE_OBSERVED_AT,
    network: ok(c.network), mintAddress: ok(FIXTURE_MINT), decimals: ok(c.decimals), supplyRaw: ok(expectedSupply(c).mintedRaw),
    mintAuthority: ok(null), freezeAuthority: ok(null),
    metadata: ok({ address: fakeBase58("fixture:metadata", 44), name: c.name, symbol: c.symbol, uri: null }),
    liquidity: ok({ initialLiquidityUsdc: c.liquidityConfiguration.initialLiquidityUsdc, lockDays: c.liquidityConfiguration.lockDays }),
    feeRouting: ok({
      creatorBps: c.feeSplit.creator, taxReserveBps: c.feeSplit.taxReserve, charityBps: c.feeSplit.charity, protocolBps: c.feeSplit.protocol,
      creatorRecipient: c.creatorWallet, taxReserveRecipient: c.taxReserveConfiguration.destinationAddress, charityRecipient: FIXTURE_WALLETS.charity,
    }),
  };
}

export interface ProofFixtureInputs { subject: ProofSubject; deployment: DeploymentRecord | null; observation: ChainObservation | null }

export function proofFixtureInputs(scenario: ProofScenario): ProofFixtureInputs {
  const config = fixtureLaunchConfig();
  const fingerprint = launchFingerprint(config);
  const subject: ProofSubject = { launchId: DEMO_IDS.launch, dataSource: "demo", config, fingerprint, charity: { id: DEMO_IDS.charities.c1, name: "Open Water Initiative (demo)", walletAddress: FIXTURE_WALLETS.charity } };
  const deployed: DeploymentRecord = { network: config.network, mintAddress: FIXTURE_MINT, deploymentSignature: FIXTURE_SIGNATURE, deployedFingerprint: fingerprint };
  const match = matchingFixtureObservation(config);
  switch (scenario) {
    case "NOT_DEPLOYED": return { subject, deployment: null, observation: null };
    case "DEPLOYED_BUT_UNOBSERVED": return { subject, deployment: deployed, observation: null };
    case "FULL_MATCH": return { subject, deployment: deployed, observation: match };
    case "SUPPLY_MISMATCH": return { subject, deployment: deployed, observation: { ...match, supplyRaw: ok((BigInt(match.supplyRaw.status === "OBSERVED" ? match.supplyRaw.value : "0") + 1n).toString()) } };
    case "DECIMALS_MISMATCH": return { subject, deployment: deployed, observation: { ...match, decimals: ok(9) } };
    case "AUTHORITY_MISMATCH": return { subject, deployment: deployed, observation: { ...match, mintAuthority: ok(FIXTURE_WALLETS.other) } };
    case "NETWORK_MISMATCH": return { subject, deployment: deployed, observation: { ...match, network: ok("mainnet-beta") } };
    case "PARTIAL_OBSERVATION": return { subject, deployment: deployed, observation: { ...match, liquidity: gone("The observer could not read the liquidity pool."), feeRouting: gone("The observer could not read the fee routing account."), metadata: gone("The metadata account could not be read.") } };
    case "MISSING_METADATA": return { subject, deployment: deployed, observation: { ...match, metadata: gone("The token has no readable metadata account.") } };
    case "UNAVAILABLE_OBSERVATION": {
      const r = "The RPC endpoint did not respond.";
      return { subject, deployment: deployed, observation: { source: "FIXTURE", observedAt: FIXTURE_OBSERVED_AT, network: gone(r), mintAddress: gone(r), decimals: gone(r), supplyRaw: gone(r), mintAuthority: gone(r), freezeAuthority: gone(r), metadata: gone(r), liquidity: gone(r), feeRouting: gone(r) } };
    }
  }
}

export function buildProofFixture(scenario: ProofScenario, audience: "owner" | "public" = "public", policy?: DeploymentPolicy): LaunchProof {
  const i = proofFixtureInputs(scenario);
  return buildLaunchProof({ ...i, observationCount: i.observation ? 1 : 0, historyIntact: true, audience, policy });
}
