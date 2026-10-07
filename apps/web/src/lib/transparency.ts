import type { DataSource } from "@project-name/shared";

/**
 * Formats a badge. It does NOT decide verification: "VERIFIED TRANSPARENCY" is shown only when the SERVER says
 * `verifiedTransparency` (derived from objective on-chain checks). Reported checks are a creator's own disclosure and are labeled
 * as merely reported, with DEMO on demo data.
 */
export function transparencyBadge(o: { reported: number; total: number; verifiedTransparency: boolean; dataSource: DataSource }): { label: string; tone: "good" | "info" | "neutral" } {
  const demo = o.dataSource === "demo" ? " · DEMO" : "";
  if (o.verifiedTransparency) return { label: "VERIFIED TRANSPARENCY", tone: "good" };
  if (o.reported === o.total) return { label: `ALL ${o.total} CHECKS REPORTED${demo}`, tone: "info" };
  return { label: `${o.reported}/${o.total} CHECKS REPORTED${demo}`, tone: "neutral" };
}

export const DEMO_PROOF_BANNER = "BLOCKCHAIN VERIFICATION NOT YET CONNECTED. Nothing on this page is verified on-chain.";
