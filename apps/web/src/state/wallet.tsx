"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode,
} from "react";
import { checkChallenge, type SessionResponse } from "@project-name/shared";
import type { WalletAccount } from "@wallet-standard/base";
import { API_MODE, type ApiMode } from "@/lib/api/config";
import { authApi } from "@/lib/api/auth";
import {
  canonicalIdFor, connectWallet, describeAuthError, detectSolanaWallets, disconnectWallet, getServerWalletsSnapshot,
  getWalletsSnapshot, signMessageWithWallet, subscribeWallets, toBase64, type DetectedWallet,
} from "@/lib/walletStandard";
import { DEMO_WALLET_POOL } from "@/mock";
import type { Wallet, WalletProviderId } from "@/lib/types";

/**
 * Wallet state. Two modes, chosen by NEXT_PUBLIC_API_MODE:
 *
 *  - "api"  : REAL. Wallet Standard connect, server challenge, wallet signs a text message, API verifies the
 *             ed25519 signature and sets an HttpOnly session cookie. Status moves
 *             disconnected -> connected -> signing -> authenticated.
 *             CONNECTED means only "the extension exposed an address". It proves nothing about ownership.
 *             AUTHENTICATED means the server verified a signature from that address.
 *  - "mock" : DEMO. No extension, no network. Never reports authenticated.
 *
 * Nothing secret is ever held here: the session token exists only in an HttpOnly cookie the browser JS cannot read.
 */

export type WalletStatus = "disconnected" | "connecting" | "connected" | "signing" | "authenticated";

// ---------------- mock (demo) reducer: unchanged behavior ----------------
interface MockState { provider: WalletProviderId | null; wallets: Wallet[] }
type MockAction =
  | { type: "connect"; provider: WalletProviderId }
  | { type: "add" }
  | { type: "remove"; id: string }
  | { type: "label"; id: string; label: string }
  | { type: "disconnect" };

export function mockReducer(state: MockState, action: MockAction): MockState {
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
      return { ...state, wallets: state.wallets.map((w) => (w.id === action.id ? { ...w, label: action.label.slice(0, 24) } : w)) };
    case "disconnect":
      return { provider: null, wallets: [] };
  }
}

// ---------------- api (real) reducer ----------------
export interface ApiAuthState {
  walletName: string | null;
  /** address the extension exposed. NOT proof of ownership. */
  address: string | null;
  connecting: boolean;
  signing: boolean;
  session: SessionResponse | null;
  error: string | null;
  challenge: { message: string; expiresAt: string } | null;
}
export const INITIAL_API_STATE: ApiAuthState = { walletName: null, address: null, connecting: false, signing: false, session: null, error: null, challenge: null };

export type ApiAuthAction =
  | { type: "session-loaded"; session: SessionResponse }
  | { type: "connecting"; walletName: string }
  | { type: "connected"; walletName: string; address: string }
  | { type: "connect-failed"; error: string }
  | { type: "signing-started" }
  | { type: "challenge"; challenge: { message: string; expiresAt: string } }
  | { type: "authenticated"; session: SessionResponse }
  | { type: "sign-failed"; error: string }
  | { type: "signed-out" }
  | { type: "clear-error" };

export function apiAuthReducer(s: ApiAuthState, a: ApiAuthAction): ApiAuthState {
  switch (a.type) {
    case "session-loaded":
      return { ...s, session: a.session.authenticated ? a.session : null };
    case "connecting":
      return { ...s, connecting: true, walletName: a.walletName, error: null };
    case "connected":
      return { ...s, connecting: false, walletName: a.walletName, address: a.address, error: null };
    case "connect-failed":
      return { ...s, connecting: false, walletName: null, address: null, error: a.error };
    case "signing-started":
      return { ...s, signing: true, error: null, challenge: null };
    case "challenge":
      return { ...s, challenge: a.challenge };
    case "authenticated":
      return { ...s, signing: false, challenge: null, error: null, session: a.session };
    case "sign-failed":
      return { ...s, signing: false, challenge: null, error: a.error };
    case "signed-out":
      return { ...INITIAL_API_STATE };
    case "clear-error":
      return { ...s, error: null };
  }
}

export function deriveStatus(s: ApiAuthState): WalletStatus {
  if (s.signing) return "signing";
  if (s.session?.authenticated) return "authenticated";
  if (s.connecting) return "connecting";
  if (s.address) return "connected";
  return "disconnected";
}

// ---------------- context ----------------
interface WalletContextValue {
  mode: ApiMode;
  status: WalletStatus;
  /** A wallet is connected (api: extension exposed an address; mock: demo wallet). NOT proof of ownership. */
  connected: boolean;
  /** The server verified a wallet signature and issued a session. Always false in mock mode. */
  authenticated: boolean;
  /** Safe to use the signed-in parts of the app: api -> authenticated, mock -> demo connection. */
  ready: boolean;
  provider: WalletProviderId | null;
  walletName: string | null;
  /** address the wallet extension exposed (api) or the demo address (mock) */
  address: string | null;
  /** address the server authenticated, if any */
  authenticatedAddress: string | null;
  /** connected extension address differs from the authenticated session's wallet */
  addressMismatch: boolean;
  wallets: Wallet[];
  detected: DetectedWallet[];
  error: string | null;
  challenge: { message: string; expiresAt: string } | null;
  canAddWallet: boolean;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  /** api: wallet name from the Wallet Standard registry. mock: provider id. */
  connect: (nameOrProvider: string) => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
  addWallet: () => void;
  removeWallet: (id: string) => void;
  labelWallet: (id: string, label: string) => void;
  disconnect: () => void;
}

const Ctx = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children, mode = API_MODE }: { children: ReactNode; mode?: ApiMode }) {
  const [mock, dispatchMock] = useReducer(mockReducer, { provider: null, wallets: [] });
  const [api, dispatch] = useReducer(apiAuthReducer, INITIAL_API_STATE);
  const [modalOpen, setModalOpen] = useState(false);

  // Non-serializable wallet handles live in refs (never rendered, never persisted).
  const walletRef = useRef<DetectedWallet | null>(null);
  const accountRef = useRef<WalletAccount | null>(null);

  const registry = useSyncExternalStore(subscribeWallets, getWalletsSnapshot, getServerWalletsSnapshot);
  const detected = useMemo(() => (mode === "api" ? detectSolanaWallets(registry) : []), [registry, mode]);

  // Ask the API who we are on load (the cookie is HttpOnly; only the server can read it).
  useEffect(() => {
    if (mode !== "api") return;
    let live = true;
    authApi.getSession().then((s) => { if (live) dispatch({ type: "session-loaded", session: s }); }).catch(() => undefined);
    return () => { live = false; };
  }, [mode]);

  const connect = useCallback((nameOrProvider: string) => {
    if (mode === "mock") {
      dispatchMock({ type: "connect", provider: nameOrProvider as WalletProviderId });
      setModalOpen(false);
      return;
    }
    const target = detected.find((d) => d.name === nameOrProvider);
    if (!target) {
      dispatch({ type: "connect-failed", error: "That wallet was not detected in this browser." });
      return;
    }
    dispatch({ type: "connecting", walletName: target.name });
    connectWallet(target.wallet)
      .then(({ address, account }) => {
        walletRef.current = target;
        accountRef.current = account;
        dispatch({ type: "connected", walletName: target.name, address });
      })
      .catch((e) => dispatch({ type: "connect-failed", error: describeAuthError(e) }));
  }, [mode, detected]);

  const signIn = useCallback(async () => {
    const address = api.address;
    const w = walletRef.current;
    const account = accountRef.current;
    if (!address || !w || !account) {
      dispatch({ type: "sign-failed", error: "Connect a wallet first." });
      return;
    }
    dispatch({ type: "signing-started" });
    try {
      const ch = await authApi.requestNonce(address);
      // Refuse to sign anything that is not exactly a sign-in message for this wallet and this site.
      const check = checkChallenge(ch, { address, origin: window.location.origin });
      if (!check.ok) throw new Error(`Refusing to sign: ${check.reason}`);
      dispatch({ type: "challenge", challenge: { message: ch.message, expiresAt: ch.expiresAt } });
      const signature = await signMessageWithWallet(w.wallet, account, ch.message);
      const session = await authApi.verify({ address, nonce: ch.nonce, message: ch.message, signature: toBase64(signature) });
      dispatch({ type: "authenticated", session });
      setModalOpen(false);
    } catch (e) {
      dispatch({ type: "sign-failed", error: describeAuthError(e) });
    }
  }, [api.address]);

  const signOut = useCallback(async () => {
    if (mode === "mock") {
      dispatchMock({ type: "disconnect" });
      return;
    }
    try { await authApi.logout(); } catch { /* the cookie is cleared server-side when reachable; state is reset regardless */ }
    if (walletRef.current) await disconnectWallet(walletRef.current.wallet);
    walletRef.current = null;
    accountRef.current = null;
    dispatch({ type: "signed-out" });
  }, [mode]);

  const value = useMemo<WalletContextValue>(() => {
    const sessionWallet = api.session?.wallet ?? null;
    const apiWallets: Wallet[] = sessionWallet
      ? [{ id: sessionWallet.id, address: sessionWallet.address, label: sessionWallet.label ?? "Wallet", provider: canonicalIdFor(api.walletName ?? "") }]
      : [];
    const authenticated = mode === "api" && Boolean(api.session?.authenticated);
    const status: WalletStatus = mode === "api" ? deriveStatus(api) : mock.wallets.length > 0 ? "connected" : "disconnected";
    const connected = mode === "api" ? api.address !== null : mock.wallets.length > 0;
    return {
      mode,
      status,
      connected,
      authenticated,
      ready: mode === "api" ? authenticated : mock.wallets.length > 0,
      provider: mode === "api" ? canonicalIdFor(api.walletName ?? "") : mock.provider,
      walletName: mode === "api" ? api.walletName : mock.provider,
      address: mode === "api" ? api.address : (mock.wallets[0]?.address ?? null),
      authenticatedAddress: authenticated ? (sessionWallet?.address ?? null) : null,
      addressMismatch: authenticated && api.address !== null && sessionWallet !== null && api.address !== sessionWallet.address,
      wallets: mode === "api" ? apiWallets : mock.wallets,
      detected,
      error: api.error,
      challenge: api.challenge,
      canAddWallet: mode === "mock" && mock.provider !== null && mock.wallets.length < DEMO_WALLET_POOL.length,
      modalOpen,
      openModal: () => setModalOpen(true),
      closeModal: () => setModalOpen(false),
      connect,
      signIn,
      signOut,
      clearError: () => dispatch({ type: "clear-error" }),
      addWallet: () => dispatchMock({ type: "add" }),
      removeWallet: (id) => dispatchMock({ type: "remove", id }),
      labelWallet: (id, label) => dispatchMock({ type: "label", id, label }),
      disconnect: () => { void signOut(); },
    };
  }, [mode, api, mock, detected, modalOpen, connect, signIn, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside WalletProvider");
  return v;
}
