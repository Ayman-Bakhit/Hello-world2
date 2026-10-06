export * from "./wallets";
export * from "./portfolio";
export * from "./tax";
export * from "./charities";
export * from "./transactions";
export * from "./tokens";

import type { LaunchConfiguration } from "@/lib/types";
import { draftsFromSplit } from "@/lib/feeDrafts";

export const DEFAULT_LAUNCH_CONFIG: LaunchConfiguration = {
  name: "",
  symbol: "",
  description: "",
  imageName: "",
  totalSupply: "1000000000",
  decimals: "6",
  creatorAllocationPercent: "8",
  creatorWalletId: "",
  mintAuthority: "disabled",
  freezeAuthority: "disabled",
  updateAuthority: "creator",
  liquidityUsdc: "50000",
  liquiditySupplyPercent: "40",
  liquidityLockDays: "30",
  feeDrafts: draftsFromSplit({ creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 }),
  charityId: "",
  reserveWalletId: "",
};
