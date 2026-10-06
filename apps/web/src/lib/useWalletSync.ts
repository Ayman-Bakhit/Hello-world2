"use client";

import type { SyncStatusResponse } from "@project-name/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api/client";
import { describeApiError, type ApiErrorView } from "./api/errors";

export interface WalletSync {
  status: SyncStatusResponse | null;
  /** true between pressing the button and the server accepting the request */
  starting: boolean;
  /** problem loading the status or starting a sync (safe, displayable) */
  error: ApiErrorView | null;
  /** true while a run is in progress on the server (also true right after start) */
  syncing: boolean;
  start: () => Promise<void>;
}

const POLL_MS = 1500;

/**
 * Status of the wallet's read-only indexing, plus the action to start it. Polls only while a run is in progress,
 * and calls `onFinished` once when a run ends so the screen can reload portfolio/transactions.
 * A sync reads the blockchain. It never asks the wallet to sign anything.
 */
export function useWalletSync(walletId: string, onFinished: () => void): WalletSync {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<ApiErrorView | null>(null);
  const finished = useRef(onFinished);
  const prev = useRef<SyncStatusResponse["state"] | null>(null);
  useEffect(() => { finished.current = onFinished; });

  const refresh = useCallback(async (): Promise<SyncStatusResponse | null> => {
    try {
      const st = await api.getWalletSync(walletId);
      setStatus(st);
      setError(null);
      return st;
    } catch (e) {
      setError(describeApiError(e));
      return null;
    }
  }, [walletId]);

  useEffect(() => {
    let live = true;
    api.getWalletSync(walletId).then(
      (st) => { if (live) { setStatus(st); setError(null); } },
      (e: unknown) => { if (live) setError(describeApiError(e)); },
    );
    return () => { live = false; };
  }, [walletId]);

  const syncing = status?.state === "syncing";
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [syncing, refresh]);

  useEffect(() => {
    const now = status?.state ?? null;
    if (prev.current === "syncing" && now !== null && now !== "syncing") finished.current();
    prev.current = now;
  }, [status]);

  const start = useCallback(async (): Promise<void> => {
    setStarting(true);
    setError(null);
    let accepted = false;
    try {
      await api.startWalletSync(walletId);
      accepted = true;
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setStarting(false);
    }
    const st = await refresh();
    // A fast sync can finish before the first poll ever sees "syncing"; the transition check would miss it.
    if (accepted && st && st.state !== "syncing") finished.current();
  }, [walletId, refresh]);

  return { status, starting, error, syncing: syncing || starting, start };
}
