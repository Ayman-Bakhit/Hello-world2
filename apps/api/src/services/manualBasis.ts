import {
  centsToDecimal, rawToDecimal, type ManualBasisDetail, type ManualBasisView, type ManualBasisReview,
} from "@project-name/shared";
import { historyIntact, history, type BasisRow, type RevisionRow } from "../db/manualBasisRepos";
import type { Pool } from "../db/pool";
import { reviewView } from "./tax";

const iso = (t: number) => new Date(t * 1000).toISOString();
const label = (a: string) => (a === "native" ? "SOL" : a);

export function revisionView(b: Pick<BasisRow, "decimals">, r: RevisionRow) {
  return {
    revision: r.revision, action: r.action, status: r.status, quantity: rawToDecimal(r.quantity, b.decimals), quantityRaw: r.quantity.toString(), acquiredAt: iso(r.acquiredAt),
    costBasis: centsToDecimal(r.costBasisCents), costBasisCents: r.costBasisCents.toString(), currency: r.currency,
    reason: r.reason as ManualBasisView["reason"], signature: r.signature, notes: r.notes, acknowledgedOverlap: r.acknowledgedOverlap, changeReason: r.changeReason, createdAt: r.createdAt,
  };
}

/** Always labeled USER_PROVIDED and verifiedOnChain:false. The review is the latest tax calculation's view of this record. */
export function basisView(b: BasisRow, review: ManualBasisReview | null): ManualBasisView {
  return {
    id: b.id, walletId: b.walletId, asset: label(b.asset), mint: b.asset === "native" ? null : b.asset, decimals: b.decimals, source: "USER_PROVIDED", verifiedOnChain: false,
    ...revisionView(b, b.current), createdAt: b.createdAt, updatedAt: b.current.createdAt, review: review ? reviewView(review) : null,
  };
}

export async function basisDetail(pool: Pool, b: BasisRow, review: ManualBasisReview | null): Promise<ManualBasisDetail & { historyIntact: boolean }> {
  const h = await history(pool, b.id);
  return { record: basisView(b, review), history: h.map((r) => revisionView(b, r)), historyIntact: historyIntact(b.id, h) };
}
