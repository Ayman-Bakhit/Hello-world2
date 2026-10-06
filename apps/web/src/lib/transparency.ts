import type { DataSource } from "@project-name/shared";

/**
 * The ONLY place a transparency badge is decided.
 * "VERIFIED TRANSPARENCY" requires the API to say verifiedOnChain AND all checks reported. Until on-chain
 * verification exists (it does not), every token shows how many checks were merely REPORTED, labeled DEMO.
 */
export function transparencyBadge(o: { reported: number; total: number; verifiedOnChain: boolean; dataSource: DataSource }): { label: string; tone: "good" | "info" | "neutral" } {
  const demo = o.dataSource === "demo" ? " · DEMO" : "";
  if (o.verifiedOnChain && o.reported === o.total) return { label: "VERIFIED TRANSPARENCY", tone: "good" };
  if (o.reported === o.total) return { label: `ALL ${o.total} CHECKS REPORTED${demo}`, tone: "info" };
  return { label: `${o.reported}/${o.total} CHECKS REPORTED${demo}`, tone: "neutral" };
}

export const DEMO_PROOF_BANNER = "BLOCKCHAIN VERIFICATION NOT YET CONNECTED. Nothing on this page is verified on-chain.";
