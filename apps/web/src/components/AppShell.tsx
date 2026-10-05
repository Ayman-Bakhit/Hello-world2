"use client";

import { useState, type ReactNode } from "react";
import { DemoDataBanner } from "./DemoDataBanner";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { WalletConnectModal } from "./WalletConnectModal";

export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface/50 lg:block">
        <Sidebar />
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
          <aside className="rise absolute inset-y-0 left-0 w-64 border-r border-line bg-surface">
            <Sidebar onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      ) : null}

      <div className="min-w-0">
        <TopBar onMenu={() => setDrawer(true)} />
        <DemoDataBanner />
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 text-[11px] leading-relaxed text-faint sm:px-6">
          Demo build. Figures are illustrative. Tax figures are planning estimates, not tax advice. Nothing here is
          financial, legal, or tax advice, and no outcome is guaranteed.
        </footer>
      </div>
      <WalletConnectModal />
    </div>
  );
}
