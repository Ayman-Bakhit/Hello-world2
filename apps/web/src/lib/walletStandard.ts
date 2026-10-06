import { getWallets } from "@wallet-standard/app";
import type { Wallet as StdWallet, WalletAccount } from "@wallet-standard/base";
import type { StandardConnectFeature, StandardDisconnectFeature } from "@wallet-standard/features";
import type { SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import type { WalletProviderId } from "./types";

/**
 * Browser wallet access via the Wallet Standard (Phantom, Solflare, Backpack and any compatible wallet
 * register themselves). This module only asks a wallet to (1) connect and (2) sign a TEXT MESSAGE.
 * It never touches private keys and never requests a transaction.
 */

export const CANONICAL_WALLETS: Array<{ id: WalletProviderId; name: string; installUrl: string }> = [
  { id: "phantom", name: "Phantom", installUrl: "https://phantom.app/download" },
  { id: "solflare", name: "Solflare", installUrl: "https://solflare.com/download" },
  { id: "backpack", name: "Backpack", installUrl: "https://backpack.app/downloads" },
];

export type SolanaWallet = StdWallet;

/** Can connect and sign messages on a Solana chain. */
export function isSolanaSigner(w: StdWallet): boolean {
  return "standard:connect" in w.features && "solana:signMessage" in w.features && w.chains.some((c) => c.startsWith("solana:"));
}

export const canonicalIdFor = (name: string): WalletProviderId | null =>
  CANONICAL_WALLETS.find((c) => name.toLowerCase().includes(c.name.toLowerCase()))?.id ?? null;

export interface DetectedWallet {
  /** unique key: the wallet's name */
  name: string;
  canonicalId: WalletProviderId | null;
  icon: string;
  wallet: SolanaWallet;
}

export const detectSolanaWallets = (all: readonly StdWallet[]): DetectedWallet[] =>
  all.filter(isSolanaSigner).map((w) => ({ name: w.name, canonicalId: canonicalIdFor(w.name), icon: w.icon, wallet: w }));

// ---- registry subscription (stable snapshot for useSyncExternalStore) ----
let cached: readonly StdWallet[] = [];
export function subscribeWallets(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const api = getWallets();
  const off = [api.on("register", cb), api.on("unregister", cb)];
  return () => off.forEach((f) => f());
}
export function getWalletsSnapshot(): readonly StdWallet[] {
  if (typeof window === "undefined") return cached;
  const cur = getWallets().get();
  if (cur.length !== cached.length || cur.some((w, i) => w !== cached[i])) cached = cur;
  return cached;
}
export const getServerWalletsSnapshot = (): readonly StdWallet[] => [];

// ---- operations ----
export async function connectWallet(w: SolanaWallet): Promise<{ address: string; account: WalletAccount }> {
  const feature = (w.features["standard:connect"] as StandardConnectFeature["standard:connect"]);
  const { accounts } = await feature.connect();
  const account = accounts.find((a) => a.features.includes("solana:signMessage")) ?? accounts[0];
  if (!account) throw new Error("The wallet did not return an account");
  return { address: account.address, account };
}

export async function disconnectWallet(w: SolanaWallet): Promise<void> {
  const f = w.features["standard:disconnect"] as StandardDisconnectFeature["standard:disconnect"] | undefined;
  try { await f?.disconnect(); } catch { /* best effort */ }
}

/** Asks the wallet to sign UTF-8 text. Verifies the wallet signed exactly the bytes we sent. */
export async function signMessageWithWallet(w: SolanaWallet, account: WalletAccount, text: string): Promise<Uint8Array> {
  const feature = w.features["solana:signMessage"] as SolanaSignMessageFeature["solana:signMessage"];
  const message = new TextEncoder().encode(text);
  const [out] = await feature.signMessage({ account, message });
  if (!out) throw new Error("The wallet returned no signature");
  const signed = out.signedMessage;
  if (signed.length !== message.length || signed.some((b, i) => b !== message[i])) throw new Error("The wallet signed different bytes than requested");
  if (out.signature.length !== 64) throw new Error("The wallet returned a malformed signature");
  return out.signature;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Human-safe message for the connect/sign flow. Never echoes raw wallet/API internals. */
export function describeAuthError(e: unknown): string {
  const err = e as { code?: unknown; name?: string; message?: string; status?: number };
  const msg = (err?.message ?? "").toLowerCase();
  if (err?.code === 4001 || /reject|declin|denied|cancel|user closed/.test(msg)) return "Request declined in your wallet. Nothing was sent and nothing was signed.";
  if (err?.name === "ApiClientError") {
    if (err.code === "NETWORK_ERROR" || err.status === 0) return "Could not reach the API. Is it running?";
    if (err.status === 401) return "Sign-in failed. Request a new challenge and try again.";
    if (err.status === 429) return "Too many attempts. Wait a moment and try again.";
    if (err.status === 403) return "This site is not allowed to sign in to the API (origin mismatch).";
    return "The API rejected the request.";
  }
  if (/different (bytes|site|wallet)|challenge/.test(msg)) return err.message ?? "The sign-in challenge looked wrong, so it was not signed.";
  return "Wallet request failed. Try again.";
}
