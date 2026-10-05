"use client";

import { Badge } from "./Badge";
import { WalletMenu } from "./WalletMenu";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-canvas/85 px-4 py-2.5 backdrop-blur">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open navigation"
          className="grid h-8 w-8 place-items-center rounded-md border border-line-strong text-muted lg:hidden"
        >
          <span aria-hidden className="block h-px w-4 bg-current shadow-[0_5px_0_currentColor,0_-5px_0_currentColor]" />
        </button>
        <span className="hidden sm:block"><Badge tone="neutral">SOLANA · NOT CONNECTED</Badge></span>
      </div>
      <WalletMenu />
    </header>
  );
}
