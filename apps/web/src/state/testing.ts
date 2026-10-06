import type { WalletContextValue } from "./wallet";

/** Builds a complete wallet context value for rendering components in tests. Defaults to DISCONNECTED (api mode). */
export function makeWalletValue(over: Partial<WalletContextValue> = {}): WalletContextValue {
  const noop = () => undefined;
  return {
    mode: "api", status: "disconnected", connected: false, authenticated: false, ready: false, sessionChecked: true,
    refreshSession: async () => undefined, provider: null, walletName: null, address: null, authenticatedAddress: null,
    addressMismatch: false, wallets: [], detected: [], error: null, challenge: null, canAddWallet: false, modalOpen: false,
    openModal: noop, closeModal: noop, connect: noop, signIn: async () => undefined, signOut: async () => undefined,
    clearError: noop, addWallet: noop, removeWallet: noop, labelWallet: noop, disconnect: noop, ...over,
  };
}
