"use client";

import { useWallet } from "@/state/wallet";
import { Badge } from "./Badge";

/** Pure: the three explicit states. CONNECTED is never shown as AUTHENTICATED. Mock mode never authenticates. */
export function authStatusLabel(s: { mode: "mock" | "api"; connected: boolean; authenticated: boolean }): { label: string; tone: "neutral" | "demo" | "good" } {
  if (s.authenticated) return { label: "AUTHENTICATED", tone: "good" };
  if (s.connected) return { label: s.mode === "mock" ? "CONNECTED · DEMO" : "CONNECTED", tone: "demo" };
  return { label: "DISCONNECTED", tone: "neutral" };
}

export function AuthStatusPill() {
  const w = useWallet();
  const s = authStatusLabel(w);
  return (
    <span className="flex items-center gap-2">
      <Badge tone={s.tone}>{s.label}</Badge>
      <span className="hidden sm:inline-flex"><Badge tone="neutral">CHAIN ACCESS · READ-ONLY</Badge></span>
    </span>
  );
}
