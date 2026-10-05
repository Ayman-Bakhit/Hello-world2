import { splitAmount, type FeeSplitBps } from "@project-name/shared";
import type { Token, TransparencyCheckKey } from "@/lib/types";
import { TRANSPARENCY_CHECKS } from "@/lib/types";

const allChecks = (off: TransparencyCheckKey[] = []) =>
  Object.fromEntries(TRANSPARENCY_CHECKS.map(([k]) => [k, !off.includes(k)])) as Record<TransparencyCheckKey, boolean>;

const split = (creator: number, taxReserve: number, charity: number, protocol: number): FeeSplitBps => ({
  creator, taxReserve, charity, protocol,
});

const fake = (tag: string) => `DEMO${tag}`.padEnd(26, "x");

/**
 * Fictional demo tokens. None is deployed; contractAddress is null on purpose.
 * Market figures are illustrative only and do not describe any real market.
 */
export const DEMO_TOKENS: Token[] = [
  {
    slug: "demo", name: "Harbor Demo Token", symbol: "HRBR",
    description: "Fictional token used to demonstrate the proof page. It does not exist on any chain.",
    priceMicro: 2_150n, marketCapCents: 215_000_000n, liquidityCents: 8_420_000n, liquidityLockDays: 30,
    volume24hCents: 2_124_000n, volume7dChangeBps: 420, holders: 1_284, launchedAt: "2026-08-14T15:00:00Z",
    creatorLabel: "Harbor Labs (demo)", creatorAddress: fake("Creator01"), contractAddress: null,
    mintAuthority: "disabled", freezeAuthority: "disabled", creatorAllocationBps: 800, top10Bps: 2_100,
    adminPrivileges: "fee-config", feeSplit: split(6000, 1500, 1500, 1000), lifetimeFeesCents: 8_220_000n,
    charity: { donations: 18, charities: 4, lastDonationAt: "2026-10-02T14:03:00Z" }, checks: allChecks(),
  },
  {
    slug: "demo-orchard", name: "Orchard Demo", symbol: "ORCH",
    description: "Fictional demo token.", priceMicro: 34_000n, marketCapCents: 340_000_000n,
    liquidityCents: 31_000_000n, liquidityLockDays: 180, volume24hCents: 4_020_000n, volume7dChangeBps: -310,
    holders: 3_870, launchedAt: "2026-07-02T12:00:00Z", creatorLabel: "Orchard Collective (demo)",
    creatorAddress: fake("Creator02"), contractAddress: null, mintAuthority: "disabled", freezeAuthority: "disabled",
    creatorAllocationBps: 600, top10Bps: 1_800, adminPrivileges: "none", feeSplit: split(6000, 1500, 1500, 1000),
    lifetimeFeesCents: 21_400_000n, charity: { donations: 41, charities: 6, lastDonationAt: "2026-10-04T08:30:00Z" }, checks: allChecks(),
  },
  {
    slug: "demo-tidepool", name: "Tidepool Demo", symbol: "TIDE",
    description: "Fictional demo token.", priceMicro: 1_700n, marketCapCents: 170_000_000n,
    liquidityCents: 14_000_000n, liquidityLockDays: 90, volume24hCents: 950_000n, volume7dChangeBps: 1_250,
    holders: 2_150, launchedAt: "2026-06-20T09:00:00Z", creatorLabel: "Tidepool DAO (demo)",
    creatorAddress: fake("Creator03"), contractAddress: null, mintAuthority: "disabled", freezeAuthority: "creator",
    creatorAllocationBps: 1_100, top10Bps: 3_000, adminPrivileges: "fee-config", feeSplit: split(7000, 500, 1500, 1000),
    lifetimeFeesCents: 6_300_000n, charity: { donations: 12, charities: 3, lastDonationAt: "2026-09-29T17:10:00Z" },
    checks: allChecks(["charityWalletsVerified", "noHiddenAdmin"]),
  },
  {
    slug: "demo-meridian", name: "Meridian Demo", symbol: "MRDN",
    description: "Fictional demo token.", priceMicro: 9_100n, marketCapCents: 91_000_000n,
    liquidityCents: 6_600_000n, liquidityLockDays: null, volume24hCents: 710_000n, volume7dChangeBps: 80,
    holders: 735, launchedAt: "2026-09-10T18:00:00Z", creatorLabel: "Meridian Studio (demo)",
    creatorAddress: fake("Creator04"), contractAddress: null, mintAuthority: "disabled", freezeAuthority: "disabled",
    creatorAllocationBps: 2_400, top10Bps: 4_200, adminPrivileges: "fee-config", feeSplit: split(6500, 1000, 1500, 1000),
    lifetimeFeesCents: 2_900_000n, charity: { donations: 7, charities: 2, lastDonationAt: "2026-10-01T11:45:00Z" },
    checks: allChecks(["noHiddenAdmin"]),
  },
  {
    slug: "demo-fieldnotes", name: "Fieldnotes Demo", symbol: "FNDM",
    description: "Fictional demo token.", priceMicro: 640n, marketCapCents: 64_000_000n,
    liquidityCents: 4_100_000n, liquidityLockDays: 30, volume24hCents: 189_000n, volume7dChangeBps: 2_900,
    holders: 412, launchedAt: "2026-09-28T13:00:00Z", creatorLabel: "Fieldnotes (demo)",
    creatorAddress: fake("Creator05"), contractAddress: null, mintAuthority: "disabled", freezeAuthority: "disabled",
    creatorAllocationBps: 1_900, top10Bps: 3_400, adminPrivileges: "none", feeSplit: split(5000, 1000, 2500, 1500),
    lifetimeFeesCents: 960_000n, charity: { donations: 4, charities: 2, lastDonationAt: "2026-10-03T20:00:00Z" },
    checks: allChecks(["charityWalletsVerified"]),
  },
  {
    slug: "demo-lantern", name: "Lantern Demo", symbol: "LNTN",
    description: "Fictional demo token.", priceMicro: 120n, marketCapCents: 12_000_000n,
    liquidityCents: 1_800_000n, liquidityLockDays: null, volume24hCents: 61_000n, volume7dChangeBps: -1_500,
    holders: 96, launchedAt: "2026-10-01T10:00:00Z", creatorLabel: "Anonymous creator (undisclosed)",
    creatorAddress: fake("Creator06"), contractAddress: null, mintAuthority: "creator", freezeAuthority: "creator",
    creatorAllocationBps: 3_800, top10Bps: 6_100, adminPrivileges: "fee-config", feeSplit: split(7000, 0, 2000, 1000),
    lifetimeFeesCents: 140_000n, charity: { donations: 1, charities: 1, lastDonationAt: "2026-10-02T09:00:00Z" },
    checks: allChecks(["creatorWalletDisclosed", "mintAuthorityKnown", "noHiddenAdmin", "liquidityDisclosed", "charityWalletsVerified"]),
  },
];

export const FEATURED_TOKEN = DEMO_TOKENS[0]!;

export const tokenCharityGeneratedCents = (t: Token): bigint => splitAmount(t.lifetimeFeesCents, t.feeSplit).charity;
export const tokenMoneyFlow = (t: Token) => splitAmount(t.lifetimeFeesCents, t.feeSplit);
export const tokenChecksPassed = (t: Token): number => Object.values(t.checks).filter(Boolean).length;
