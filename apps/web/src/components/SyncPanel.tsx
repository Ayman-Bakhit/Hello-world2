import type { SyncStatusResponse } from "@project-name/shared";
import type { ApiErrorView } from "@/lib/api/errors";
import { Badge } from "./Badge";
import { Button } from "./Button";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

/**
 * Read-only indexing control. Pure view (state comes from useWalletSync).
 * Demo wallets get nothing here: demo data is fixture data and is never "synced".
 */
export function SyncPanel({
  status, syncing, error, onSync,
}: { status: SyncStatusResponse | null; syncing: boolean; error: ApiErrorView | null; onSync: () => void }) {
  if (!status) return error ? <p role="alert" className="mt-3 text-xs text-loss">{error.message}</p> : null;
  if (status.state === "unsupported_demo_wallet") return null;

  const hasData = status.lastSuccessAt !== null;
  const run = status.lastRun;
  const partial = run?.status === "partial" && run.error;
  const label = syncing ? "INDEXING WALLET…" : hasData ? "REFRESH DATA" : "SYNC WALLET";
  return (
    <section aria-label="Blockchain indexing" className="mt-4 flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {syncing ? <Badge tone="info">INDEXING WALLET</Badge> : hasData ? <Badge tone="info">LIVE DATA</Badge> : <Badge>NO LIVE DATA YET</Badge>}
          <span className="text-xs text-muted">Read-only. Reads your public wallet data from Solana ({status.cluster}); nothing is signed or sent.</span>
        </div>
        <p className="mt-1.5 text-xs text-muted" aria-live="polite">
          {status.state === "indexing_unavailable"
            ? "This server is not connected to a Solana RPC node (SOLANA_RPC_URL), so wallets cannot be synced yet."
            : syncing
              ? "Reading balances and recent transactions. This page updates when it finishes."
              : hasData
                ? `Last synced ${when(status.lastSuccessAt)}${status.window ? ` · ${status.window.indexedCount} transaction${status.window.indexedCount === 1 ? "" : "s"} indexed${status.window.historyComplete ? " (full history)" : " (recent history only)"}` : ""}.`
                : "Nothing has been read from the blockchain for this wallet yet."}
        </p>
        {status.state === "failed" && run?.error ? <p role="alert" className="mt-1.5 text-xs text-loss">Last sync failed ({run.error.code}): {run.error.message}</p> : null}
        {partial ? <p className="mt-1.5 text-xs text-warn">Last sync was partial: {run.error!.message}</p> : null}
        {status.window?.hasGap ? <p className="mt-1.5 text-xs text-warn">Some transactions between syncs may be missing from the list.</p> : null}
        {error ? <p role="alert" className="mt-1.5 text-xs text-loss">{error.message}</p> : null}
      </div>
      <Button variant="primary" onClick={onSync} disabled={syncing || status.state === "indexing_unavailable"} aria-busy={syncing}>
        {label}
      </Button>
    </section>
  );
}
