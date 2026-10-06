"use client";

import type { ReactNode } from "react";
import type { ApiErrorView } from "@/lib/api/errors";
import type { Resource } from "@/lib/api/useResource";
import { useWallet } from "@/state/wallet";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

/** Loading skeleton. Announced to assistive tech; never a blank screen. */
export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="rounded-lg border border-line bg-surface p-6">
      <p className="eyebrow mb-4">{label}…</p>
      <div className="space-y-3" aria-hidden>
        <div className="h-4 w-1/3 animate-pulse rounded bg-line" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-line" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-line" />
      </div>
    </div>
  );
}

/** "Nothing here yet" for authenticated, live users. Never filled with fictional values. */
export function NoLiveData({ title = "NO LIVE DATA YET", message = "Your wallet is authenticated, but no live data has been loaded for it yet." }: { title?: string; message?: string }) {
  return <EmptyState badge="NO LIVE DATA" title={title} description={message} />;
}

/** Pure view: easy to test. */
export function UnauthenticatedState({ onConnect, message }: { onConnect?: () => void; message?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface/60 p-8 text-center sm:p-12">
      <Badge tone="neutral">NOT SIGNED IN</Badge>
      <h2 className="mt-4 text-lg font-semibold">AUTHENTICATION REQUIRED</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted">{message ?? "Connect your wallet and sign the message to continue. A wallet connection alone is not enough: the server must verify your signature."}</p>
      {onConnect ? <div className="mt-6 flex justify-center"><Button variant="primary" onClick={onConnect}>CONNECT WALLET</Button></div> : null}
    </div>
  );
}

export function AuthRequired({ message }: { message?: string }) {
  const { openModal } = useWallet();
  return <UnauthenticatedState onConnect={openModal} {...(message ? { message } : {})} />;
}

/** Safe error display: only text produced by describeApiError, with field messages for validation. */
export function ApiErrorState({ error, onRetry }: { error: ApiErrorView; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-loss/30 bg-loss/[0.06] p-6">
      <Badge tone="bad">{error.kind === "rate_limited" ? "RATE LIMITED" : error.kind === "network" || error.kind === "server" ? "UNAVAILABLE" : "ERROR"}</Badge>
      <h2 className="mt-3 text-base font-semibold">{error.title}</h2>
      <p className="mt-1 text-sm text-muted">{error.message}</p>
      {error.fields ? (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-loss">
          {Object.entries(error.fields).flatMap(([k, msgs]) => msgs.map((m) => <li key={`${k}-${m}`}>{k === "_" ? m : `${k}: ${m}`}</li>))}
        </ul>
      ) : null}
      {error.retryable && onRetry ? <Button className="mt-4" onClick={onRetry}>RETRY</Button> : null}
    </div>
  );
}

/** A feature that exists in the UI but is intentionally not available yet. */
export function UnavailableState({ title = "FEATURE COMING SOON", message, compact }: { title?: string; message: string; compact?: boolean }) {
  if (compact) {
    return (
      <p className="rounded-md border border-dashed border-line-strong px-3 py-2 text-xs text-muted">
        <span className="mr-2 font-semibold tracking-wider text-faint">COMING LATER</span>
        {message}
      </p>
    );
  }
  return <EmptyState badge="COMING SOON" title={title} description={message} />;
}

/**
 * One consistent way to render an API resource:
 * loading -> skeleton; 401 -> AUTHENTICATION REQUIRED; no live data -> `noData`; other errors -> safe error; ok -> children.
 */
export function ResourceView<T>({
  resource, children, noData, loadingLabel,
}: {
  resource: Resource<T> & { reload: () => void };
  children: (data: T) => ReactNode;
  noData?: ReactNode;
  loadingLabel?: string;
}) {
  switch (resource.status) {
    case "idle":
    case "loading":
      return <LoadingState {...(loadingLabel ? { label: loadingLabel } : {})} />;
    case "error":
      if (resource.error.kind === "unauthenticated") return <AuthRequired />;
      if (resource.error.kind === "no_live_data") return <>{noData ?? <NoLiveData />}</>;
      return <ApiErrorState error={resource.error} onRetry={resource.reload} />;
    case "ok":
      return <>{children(resource.data)}</>;
  }
}
