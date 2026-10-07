import { buildReserveState, type ReserveInput, type ReserveTargetConfig } from "../reserve";
import type { TaxReserveResponse } from "../api/schemas";
import { DEMO_IDS } from "./fixtures";

/**
 * Tax reserve scenarios for tests and demos. Every one is a DEMO fixture (taxSource DEMO_FIXTURE, dataSource "demo"): none can be
 * mistaken for live data, and none is ever produced for a real wallet.
 */
const target = (cents: bigint, over: Partial<ReserveTargetConfig> = {}): ReserveTargetConfig =>
  ({ targetType: "amount", percentBps: null, targetCents: cents, source: "USER_SET", enabled: true, updatedAt: "2026-01-01T00:00:00.000Z", dataSource: "demo", ...over });
const base: ReserveInput = {
  walletId: DEMO_IDS.wallets.trading, taxSource: "DEMO_FIXTURE", taxStatus: "COMPLETE", exposureCents: 1_243_000n, netGainsCents: 5_810_000n,
  ratesSupplied: true, requirements: [], target: null, balance: null,
};
const incomplete = [{ kind: "CLASSIFICATION", severity: "incomplete", count: 2, message: "UNKNOWN or unassessed transactions: these are not included in any figure." }];
const required = [{ kind: "PRICE", severity: "blocks_total", count: 3, message: "Data required: a USD price is missing for these events." }];

export const RESERVE_SCENARIOS = {
  COMPLETE_NO_TARGET: base,
  COMPLETE_TARGET_BELOW_ESTIMATE: { ...base, target: target(1_000_000n) },
  COMPLETE_TARGET_ABOVE_ESTIMATE: { ...base, exposureCents: 800_000n, target: target(1_000_000n) },
  COMPLETE_DEMO_BALANCE: { ...base, target: target(1_000_000n), balance: { source: "DEMO_FIXTURE", cents: 800_000n } },
  PARTIAL: { ...base, taxStatus: "PARTIAL", requirements: incomplete, target: target(1_000_000n) },
  DATA_REQUIRED: { ...base, taxStatus: "DATA_REQUIRED", requirements: required, target: target(1_000_000n) },
  UNAVAILABLE: { ...base, taxStatus: "UNAVAILABLE", exposureCents: null, netGainsCents: null, target: target(1_000_000n) },
  NO_RATES: { ...base, ratesSupplied: false, exposureCents: null },
} as const satisfies Record<string, ReserveInput>;
export type ReserveScenarioId = keyof typeof RESERVE_SCENARIOS;

export function buildReserveScenario(id: ReserveScenarioId): TaxReserveResponse {
  return buildReserveState(RESERVE_SCENARIOS[id] as ReserveInput);
}
