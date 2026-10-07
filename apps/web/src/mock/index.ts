export * from "./wallets";
export * from "./portfolio";
export * from "./tax";
export * from "./charities";
export * from "./transactions";
export * from "./tokens";

import type { LaunchConfiguration } from "@/lib/types";

export const DEFAULT_LAUNCH_CONFIG: LaunchConfiguration = {
  name: "",
  symbol: "",
  description: "",
  network: "devnet",
  imageUrl: "",
  website: "",
  twitter: "",
  telegram: "",
  discord: "",
  github: "",
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
  charityId: "",
  reserveWalletId: "",
};
