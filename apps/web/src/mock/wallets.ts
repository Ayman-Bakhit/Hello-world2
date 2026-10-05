import type { Wallet } from "@/lib/types";

/** Obviously fake addresses (DEMO prefix). Not valid base58 keys, not real wallets. */
export const DEMO_WALLET_POOL: Wallet[] = [
  { id: "w1", address: "DEMO7xK2mQ9vT3pL8aZ4WNr91P", label: "Trading", provider: null },
  { id: "w2", address: "DEMO3fB8cJ5yR1uH6dV2KEq47M", label: "Creator", provider: null },
  { id: "w3", address: "DEMO9aD4nS7eX0gC3tU8LYb62Q", label: "Cold storage", provider: null },
];
