import { NO_LIVE_DATA } from "@project-name/shared";
import { ApiClientError } from "./http";

export type ApiErrorKind =
  | "unauthenticated" | "forbidden" | "no_live_data" | "not_found" | "validation"
  | "rejected" | "conflict" | "rate_limited" | "server" | "network" | "unknown";

export interface ApiErrorView {
  kind: ApiErrorKind;
  /** Short heading for the UI. */
  title: string;
  /** Safe user-facing text. Never a stack trace and never raw server text for 5xx/unknown errors. */
  message: string;
  /** Field -> messages, for validation errors. */
  fields?: Record<string, string[]>;
  retryable: boolean;
  code?: string;
}

/**
 * ONE place that turns anything thrown by the API layer into something safe to show.
 * 4xx server messages are written by us (no internals) and may be shown; 5xx and unknown errors are replaced
 * with a generic message so server details can never leak into the UI.
 */
export function describeApiError(e: unknown): ApiErrorView {
  if (!(e instanceof ApiClientError)) {
    return { kind: "unknown", title: "TEMPORARILY UNAVAILABLE", message: "Something went wrong. Please try again.", retryable: true };
  }
  const code = e.code;
  const base = { code } as const;
  if (e.status === 0 || code === "NETWORK_ERROR") {
    return { ...base, kind: "network", title: "TEMPORARILY UNAVAILABLE", message: "Could not reach the API. Check that it is running, then retry.", retryable: true };
  }
  if (e.status === 401) {
    return { ...base, kind: "unauthenticated", title: "AUTHENTICATION REQUIRED", message: "Connect your wallet and sign the message to continue.", retryable: false };
  }
  if (e.status === 403) {
    return { ...base, kind: "forbidden", title: "NOT ALLOWED", message: "This site or session is not allowed to perform that action.", retryable: false };
  }
  if (e.status === 404) {
    if (code === NO_LIVE_DATA) {
      return { ...base, kind: "no_live_data", title: "NO LIVE DATA YET", message: "Your wallet is authenticated, but blockchain indexing has not been connected yet.", retryable: false };
    }
    return { ...base, kind: "not_found", title: "NOT FOUND", message: "That item does not exist or is not available to you.", retryable: false };
  }
  if (e.status === 400) {
    return { ...base, kind: "validation", title: "CHECK YOUR INPUT", message: "Some fields need attention.", ...(e.fields ? { fields: e.fields } : {}), retryable: false };
  }
  if (e.status === 409 || e.status === 422) {
    return { ...base, kind: e.status === 409 ? "conflict" : "rejected", title: e.status === 409 ? "CONFLICT" : "REQUEST REJECTED", message: e.message, retryable: false };
  }
  if (e.status === 429) {
    return { ...base, kind: "rate_limited", title: "SLOW DOWN", message: "Too many requests. Wait a moment, then retry.", retryable: true };
  }
  if (e.status >= 500) {
    return { ...base, kind: "server", title: "TEMPORARILY UNAVAILABLE", message: "The service had a problem. Please try again shortly.", retryable: true };
  }
  return { ...base, kind: "unknown", title: "TEMPORARILY UNAVAILABLE", message: "The request could not be completed.", retryable: true };
}
