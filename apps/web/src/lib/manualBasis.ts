import { ManualBasisValidationError, formatUnits, normalizeManualBasis, type TaxDetailsResponse } from "@project-name/shared";

/** One thing the Tax Center says needs cost basis. Derived ONLY from the API's tax events. */
export interface MissingBasisItem {
  key: string;
  kind: "DISPOSAL" | "TRANSFER_IN";
  /** "SOL" or mint */
  asset: string;
  mint: string | null;
  decimals: number;
  /** exact decimal quantity that needs basis */
  quantity: string;
  /** transaction signature the user may tie the basis to */
  signature: string;
  timestamp: string | null;
}

export function missingBasisItems(d: TaxDetailsResponse): MissingBasisItem[] {
  const out: MissingBasisItem[] = [];
  for (const e of d.events) {
    if (e.kind === "SELL" && e.missing.includes("COST_BASIS")) {
      out.push({ key: e.id, kind: "DISPOSAL", asset: e.asset, mint: e.mint, decimals: e.decimals, quantity: formatUnits(BigInt(e.uncoveredQuantity), e.decimals), signature: e.signature, timestamp: e.timestamp });
    } else if (e.kind === "TRANSFER_IN" && e.status === "UNRESOLVED" && e.missing.includes("TRANSFER_MATCH")) {
      out.push({ key: e.id, kind: "TRANSFER_IN", asset: e.asset, mint: e.mint, decimals: e.decimals, quantity: formatUnits(BigInt(e.quantity), e.decimals), signature: e.signature, timestamp: e.timestamp });
    }
  }
  return out;
}

export interface BasisFormDraft {
  asset: string;
  decimals: string;
  quantity: string;
  acquiredAt: string;
  costBasis: string;
  reason: string;
  signature: string;
  notes: string;
}
export const EMPTY_BASIS_DRAFT: BasisFormDraft = { asset: "", decimals: "", quantity: "", acquiredAt: "", costBasis: "", reason: "EXCHANGE_PURCHASE", signature: "", notes: "" };

export const draftFromItem = (i: MissingBasisItem): BasisFormDraft => ({
  ...EMPTY_BASIS_DRAFT, asset: i.mint ?? "native", decimals: i.mint ? String(i.decimals) : "", quantity: i.quantity, signature: i.kind === "TRANSFER_IN" ? i.signature : "",
});

/** Client-side check with the SAME shared rules as the server (the server remains authoritative). Returns field errors or the request body. */
export function draftToRequest(d: BasisFormDraft, nowMs: number): { ok: true; body: Record<string, unknown> } | { ok: false; fields: Record<string, string[]> } {
  const decimals = d.decimals.trim() === "" ? null : Number(d.decimals);
  try {
    normalizeManualBasis(
      { asset: d.asset.trim(), decimals: decimals !== null && Number.isFinite(decimals) ? decimals : null, quantity: d.quantity.trim(), acquiredAt: d.acquiredAt.trim(), costBasis: d.costBasis.trim(), currency: "USD", reason: d.reason, signature: d.signature.trim() || null, notes: d.notes || null },
      { knownDecimals: d.asset.trim() === "native" ? 9 : null, nowUnix: Math.floor(nowMs / 1000) },
    );
  } catch (e) {
    if (e instanceof ManualBasisValidationError) return { ok: false, fields: e.fields };
    throw e;
  }
  return {
    ok: true,
    body: {
      asset: d.asset.trim(), ...(decimals !== null && d.asset.trim() !== "native" ? { decimals } : {}), currency: "USD", quantity: d.quantity.trim(), acquiredAt: d.acquiredAt.trim(), costBasis: d.costBasis.trim(),
      reason: d.reason, ...(d.signature.trim() ? { signature: d.signature.trim() } : {}), ...(d.notes.trim() ? { notes: d.notes } : {}),
    },
  };
}
