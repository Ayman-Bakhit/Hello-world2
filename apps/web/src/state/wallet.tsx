"use client";

import { createContext, useCallback, useContext, useMemo, useReducer, useState, type ReactNode } from "react";
import { DEMO_WALLET_POOL } from "@/mock";
import type { Wallet, WalletProviderId } from "@/lib/types";

/**
 * MOCK wallet state. No wallet adapter is loaded, no extension is contacted, nothing is signed.
 * Replace with Wallet Standard adapters + server-verified sign-in (see docs/FRONTEND.md).
 */
interface WalletState {
  provider: WalletProviderId | null;
  wallets: Wallet[];
}

type Action =
  | { type: "connect"; provider: WalletProviderId }
  | { type: "add" }
  | { type: "remove"; id: string }
  | { type: "label"; id: string; label: string }
  | { type: "disconnect" };

function reducer(state: WalletState, action: Action): WalletState {
  switch (action.type) {
    case "connect": {
      const first = DEMO_WALLET_POOL[0]!;
      return { provider: action.provider, wallets: [{ ...first, provider: action.provider }] };
    }
    case "add": {
      if (!state.provider) return state;
      const next = DEMO_WALLET_POOL.find((w) => !state.wallets.some((x) => x.id === w.id));
      return next ? { ...state, wallets: [...state.wallets, { ...next, provider: state.provider }] } : state;
    }
    case "remove": {
      const wallets = state.wallets.filter((w) => w.id !== action.id);
      return wallets.length === 0 ? { provider: null, wallets: [] } : { ...state, wallets };
    }
    case "label":
      return {
        ...state,
        wallets: state.wallets.map((w) => (w.id === action.id ? { ...w, label: action.label.slice(0, 24) } : w)),
      };
    case "disconnect":
      return { provider: null, wallets: [] };
  }
}

interface WalletContextValue {
  connected: boolean;
  provider: WalletProviderId | null;
  wallets: Wallet[];
  canAddWallet: boolean;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  connect: (p: WalletProviderId) => void;
  addWallet: () => void;
  removeWallet: (id: string) => void;
  labelWallet: (id: string, label: string) => void;
  disconnect: () => void;
}

const Ctx = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { provider: null, wallets: [] });
  const [modalOpen, setModalOpen] = useState(false);

  const connect = useCallback((provider: WalletProviderId) => {
    dispatch({ type: "connect", provider });
    setModalOpen(false);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      connected: state.wallets.length > 0,
      provider: state.provider,
      wallets: state.wallets,
      canAddWallet: state.provider !== null && state.wallets.length < DEMO_WALLET_POOL.length,
      modalOpen,
      openModal: () => setModalOpen(true),
      closeModal: () => setModalOpen(false),
      connect,
      addWallet: () => dispatch({ type: "add" }),
      removeWallet: (id) => dispatch({ type: "remove", id }),
      labelWallet: (id, label) => dispatch({ type: "label", id, label }),
      disconnect: () => dispatch({ type: "disconnect" }),
    }),
    [state, modalOpen, connect],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside WalletProvider");
  return v;
}
