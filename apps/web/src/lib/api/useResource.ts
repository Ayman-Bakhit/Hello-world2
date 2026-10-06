"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { describeApiError, type ApiErrorView } from "./errors";

export type Resource<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "error"; error: ApiErrorView };

type Action<T> = { type: "idle" } | { type: "loading" } | { type: "ok"; data: T } | { type: "error"; error: ApiErrorView };

function reducer<T>(_s: Resource<T>, a: Action<T>): Resource<T> {
  switch (a.type) {
    case "idle": return { status: "idle" };
    case "loading": return { status: "loading" };
    case "ok": return { status: "ok", data: a.data };
    case "error": return { status: "error", error: a.error };
  }
}

/**
 * Loads data through the typed API client.
 *  - `key` identifies the request (change it to refetch). Pass `fetcher = null` to stay idle (e.g. not authenticated yet).
 *  - Errors are converted to safe, displayable `ApiErrorView`s; the raw error never reaches the UI.
 *  - `onUnauthorized` runs when the API says 401, so the app can re-check the session instead of showing stale auth state.
 */
export function useResource<T>(
  key: string,
  fetcher: (() => Promise<T>) | null,
  onUnauthorized?: () => void,
): Resource<T> & { reload: () => void } {
  const [state, dispatch] = useReducer(reducer<T>, { status: fetcher ? "loading" : "idle" } as Resource<T>);
  const [nonce, bump] = useReducer((n: number) => n + 1, 0);
  const fetcherRef = useRef(fetcher);
  const unauthRef = useRef(onUnauthorized);
  useEffect(() => {
    fetcherRef.current = fetcher;
    unauthRef.current = onUnauthorized;
  });
  const enabled = fetcher !== null;

  useEffect(() => {
    const f = fetcherRef.current;
    if (!enabled || !f) {
      dispatch({ type: "idle" });
      return;
    }
    let live = true;
    dispatch({ type: "loading" });
    f().then(
      (data) => { if (live) dispatch({ type: "ok", data }); },
      (e: unknown) => {
        if (!live) return;
        const error = describeApiError(e);
        dispatch({ type: "error", error });
        if (error.kind === "unauthenticated") unauthRef.current?.();
      },
    );
    return () => { live = false; };
  }, [key, enabled, nonce]);

  const reload = useCallback(() => bump(), []);
  return { ...state, reload };
}
