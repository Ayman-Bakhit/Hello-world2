"use client";

import { useState } from "react";
import type { Wallet } from "@project-name/shared";
import { api } from "@/lib/api/client";
import { useResource, type Resource } from "@/lib/api/useResource";
import { useWallet } from "@/state/wallet";

export type WalletGate = "checking" | "unauthenticated" | "ready";

/**
 * api mode needs a verified session (and waits for the first session answer so nothing flashes);
 * mock mode shows demo data, which its responses label DEMO DATA.
 */
export function walletGate(mode: "mock" | "api", sessionChecked: boolean, authenticated: boolean): WalletGate {
  if (mode === "mock") return "ready";
  return !sessionChecked ? "checking" : authenticated ? "ready" : "unauthenticated";
}

/**
 * Decides which wallet a wallet-scoped screen shows, from the SERVER's point of view.
 *  - api mode: needs an authenticated session; the wallet list comes from GET /api/wallets (only your own wallets).
 *  - mock mode: demo wallets from shared fixtures (labeled DEMO DATA by the responses).
 * Demo data therefore never gets attached to a signed-in real wallet: the API refuses with NO_LIVE_DATA instead.
 */
export function useScopedWallet(): {
  gate: WalletGate;
  walletsState: Resource<{ wallets: Wallet[] }> & { reload: () => void };
  wallets: Wallet[];
  wallet: Wallet | null;
  select: (id: string) => void;
} {
  const w = useWallet();
  const gate = walletGate(w.mode, w.sessionChecked, w.authenticated);
  const walletsState = useResource(`wallets:${w.mode}:${gate}:${w.authenticatedAddress ?? ""}`, gate === "ready" ? () => api.getWallets() : null, () => void w.refreshSession());
  const [picked, setPicked] = useState<string | null>(null);
  const wallets = walletsState.status === "ok" ? walletsState.data.wallets : [];
  const sessionWalletId = w.mode === "api" ? w.wallets[0]?.id : undefined;
  const wallet = wallets.find((x) => x.id === picked) ?? wallets.find((x) => x.id === sessionWalletId) ?? wallets[0] ?? null;
  return { gate, walletsState, wallets, wallet, select: setPicked };
}
