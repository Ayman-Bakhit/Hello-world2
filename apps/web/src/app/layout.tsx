import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { LaunchProvider } from "@/state/launch";
import { WalletProvider } from "@/state/wallet";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PROJECT_NAME", template: "%s · PROJECT_NAME" },
  description: "Track your wallets. Prepare for taxes. Give automatically. Launch transparently. Demo build.",
};

export const viewport: Viewport = { themeColor: "#07090c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <LaunchProvider>
            <AppShell>{children}</AppShell>
          </LaunchProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
