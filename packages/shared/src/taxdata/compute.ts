import { valueCents } from "../chain/units";
import { estimateTax, realize } from "../tax/engine";
import type { AcquisitionLot, Disposal, RealizedEvent } from "../tax/types";
import {
  TaxInputError, type MissingKind, type PriceQuote, type RealizedSlice, type Requirement, type TaxCalcInput, type TaxCalcResult, type TaxEvent,
  type TaxEventKind, type TaxEventStatus, type TaxTxInput,
} from "./types";

const abs = (n: bigint) => (n < 0n ? -n : n);
const KINDS: TaxEventKind[] = ["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT", "FEE", "UNKNOWN"];

function validate(tx: TaxTxInput): void {
  if (!tx.id || !tx.signature || !tx.walletId) throw new TaxInputError("transaction is missing id, signature or wallet");
  if (tx.occurredAt !== null && (!Number.isSafeInteger(tx.occurredAt) || tx.occurredAt < 0)) throw new TaxInputError(`transaction ${tx.signature}: invalid timestamp`);
  if (tx.feeLamports !== null && tx.feeLamports < 0n) throw new TaxInputError(`transaction ${tx.signature}: negative fee`);
  for (const d of tx.deltas) {
    if (!d.asset) throw new TaxInputError(`transaction ${tx.signature}: delta without asset`);
    if (d.delta === 0n) throw new TaxInputError(`transaction ${tx.signature}: zero quantity`);
    if (!Number.isInteger(d.decimals) || d.decimals < 0 || d.decimals > 38) throw new TaxInputError(`transaction ${tx.signature}: invalid decimals`);
  }
  const seen = new Set<string>();
  for (const d of tx.deltas) {
    if (seen.has(d.asset)) throw new TaxInputError(`transaction ${tx.signature}: duplicate asset delta`);
    seen.add(d.asset);
  }
}

function make(tx: TaxTxInput, kind: TaxEventKind, asset: string, decimals: number, quantity: bigint, o: Partial<TaxEvent> = {}): TaxEvent {
  return {
    id: `${tx.id}:${asset}:${kind}`, txId: tx.id, signature: tx.signature, walletId: tx.walletId, timestamp: tx.occurredAt, kind, asset, decimals, quantity,
    usdValueCents: null, price: null, valuation: null, feeLamports: tx.feeLamports,
    classification: { kind: tx.kind, reason: tx.reason, version: tx.classifierVersion },
    status: "READY", reason: "", missing: [], confidence: "NONE", matchedWith: null, candidates: [], uncoveredQuantity: 0n, ...o,
  };
}

const unknownEvent = (tx: TaxTxInput, why: string): TaxEvent[] => {
  const first = tx.deltas[0];
  return [make(tx, "UNKNOWN", first?.asset ?? "native", first?.decimals ?? 9, first ? abs(first.delta) : 0n, {
    status: "UNRESOLVED", missing: ["CLASSIFICATION"], reason: `${why} Left as UNKNOWN: no tax meaning is assumed.`,
  })];
};

/** Conservative adapter: one transaction -> tax events. Anything not clearly one of the known shapes is UNKNOWN. */
function eventsFromTx(tx: TaxTxInput, swapTreatment: TaxCalcInput["swapTreatment"]): TaxEvent[] {
  const fee = tx.feeLamports ?? 0n;
  if (tx.status === "failed") {
    // A failed transaction moves nothing. Deltas (if any were supplied) are ignored, never turned into lots.
    return fee > 0n
      ? [make(tx, "FEE", "native", 9, fee, { reason: "Failed transaction: only the network fee was paid. Recorded, not applied to cost basis or proceeds." })]
      : [make(tx, "UNKNOWN", "native", 9, 0n, { status: "EXCLUDED", reason: "Failed transaction and the wallet paid no fee: nothing moved." })];
  }
  if (tx.kind === "fee") {
    return fee > 0n
      ? [make(tx, "FEE", "native", 9, fee, { reason: "The wallet only paid a network fee. Recorded, not applied to cost basis or proceeds." })]
      : unknownEvent(tx, "Classified as fee-only but no fee is attributed to this wallet.");
  }
  const d = tx.deltas;
  const native = d.filter((x) => x.asset === "native");
  const tokens = d.filter((x) => x.asset !== "native");
  if (tx.kind === "transfer" && d.length === 1 && native.length === 1) {
    const x = native[0]!;
    return [make(tx, x.delta > 0n ? "TRANSFER_IN" : "TRANSFER_OUT", x.asset, x.decimals, abs(x.delta), { reason: `SOL ${x.delta > 0n ? "received" : "sent"}. Not a purchase or sale: origin/destination and purpose are not known.` })];
  }
  if ((tx.kind === "token_receipt" || tx.kind === "token_send") && d.length === 1 && tokens.length === 1) {
    const x = tokens[0]!;
    if ((tx.kind === "token_receipt") === x.delta > 0n) {
      return [make(tx, x.delta > 0n ? "TRANSFER_IN" : "TRANSFER_OUT", x.asset, x.decimals, abs(x.delta), { reason: `Token ${x.delta > 0n ? "received" : "sent"}. Not a purchase or sale: origin/destination and purpose are not known.` })];
    }
  }
  if (tx.kind === "swap" && d.some((x) => x.delta < 0n) && d.some((x) => x.delta > 0n)) {
    const assumed = swapTreatment === "DISPOSAL_AND_ACQUISITION";
    return d.map((x) =>
      make(tx, x.delta < 0n ? "SELL" : "BUY", x.asset, x.decimals, abs(x.delta), {
        status: assumed ? "READY" : "UNRESOLVED",
        missing: assumed ? [] : ["CLASSIFICATION"],
        reason: assumed
          ? `Swap leg treated as a ${x.delta < 0n ? "disposal" : "acquisition"} under the stated assumption (swapTreatment=DISPOSAL_AND_ACQUISITION). This is an assumption, not a legal conclusion; treatment varies by jurisdiction and circumstances.`
          : "Swap tax treatment is not assessed (swapTreatment=NOT_ASSESSED).",
      }),
    );
  }
  return unknownEvent(tx, `Classifier result "${tx.kind}" with ${d.length} asset movement(s) does not map to a known tax event shape.`);
}

function matchTransfers(events: TaxEvent[], windowSeconds: number): void {
  const transfers = events.filter((e) => e.kind === "TRANSFER_IN" || e.kind === "TRANSFER_OUT");
  const outs = transfers.filter((e) => e.kind === "TRANSFER_OUT");
  const ins = transfers.filter((e) => e.kind === "TRANSFER_IN");
  // 1. Proven matches: SAME signature, same asset, same quantity, different wallets (both are the user's own).
  for (const o of outs) {
    const i = ins.find((x) => x.matchedWith === null && x.signature === o.signature && x.asset === o.asset && x.quantity === o.quantity && x.walletId !== o.walletId);
    if (i && o.matchedWith === null) {
      o.matchedWith = i.id; i.matchedWith = o.id;
      for (const e of [o, i]) { e.status = "MATCHED"; e.reason = "Internal transfer between two of your own wallets, proven by the same transaction. No tax effect; cost basis carries over unchanged."; }
    }
  }
  // 2. Everything else stays unresolved. Same asset+quantity in different transactions is only SUGGESTED.
  for (const e of transfers) {
    if (e.matchedWith !== null) continue;
    e.status = "UNRESOLVED";
    e.missing = ["TRANSFER_MATCH"];
    e.reason = e.kind === "TRANSFER_IN"
      ? "Received from an unknown source. No cost basis is invented; it is unresolved until matched to a transfer out or an acquisition."
      : "Sent to an unknown destination. Not treated as a sale or a gift; unresolved until matched to a transfer in or classified.";
  }
  const open = transfers.filter((e) => e.matchedWith === null && e.timestamp !== null);
  for (const o of open.filter((e) => e.kind === "TRANSFER_OUT")) {
    for (const i of open.filter((e) => e.kind === "TRANSFER_IN")) {
      if (i.asset === o.asset && i.quantity === o.quantity && i.walletId !== o.walletId && i.signature !== o.signature && Math.abs(i.timestamp! - o.timestamp!) <= windowSeconds) {
        o.candidates.push(i.id); i.candidates.push(o.id);
      }
    }
  }
}

function priceEvents(events: TaxEvent[], priceAt: TaxCalcInput["priceAt"]): void {
  const legs = events.filter((e) => (e.kind === "BUY" || e.kind === "SELL") && e.status === "READY");
  for (const e of legs) {
    if (e.timestamp === null) { e.status = "DATA_REQUIRED"; e.missing = ["TIMESTAMP"]; e.reason += " Block time unknown: cannot price or compute holding period."; continue; }
    const q = priceAt(e.asset, e.timestamp);
    if (q && q.priceMicroUsd > 0n) {
      e.price = q; e.valuation = "PRICE"; e.usdValueCents = valueCents(e.quantity, e.decimals, q.priceMicroUsd); e.confidence = "ESTIMATED";
    }
  }
  // 1:1 swap: an unpriced leg may take the value of its priced counter-leg (fair value received = fair value given up).
  const byTx = new Map<string, TaxEvent[]>();
  for (const e of legs) byTx.set(e.txId, [...(byTx.get(e.txId) ?? []), e]);
  for (const g of byTx.values()) {
    const sells = g.filter((e) => e.kind === "SELL"), buys = g.filter((e) => e.kind === "BUY");
    if (sells.length === 1 && buys.length === 1) {
      const [s, b] = [sells[0]!, buys[0]!];
      if (s.usdValueCents === null && b.usdValueCents !== null && s.status === "READY") { s.usdValueCents = b.usdValueCents; s.valuation = "COUNTER_LEG"; s.confidence = "ESTIMATED"; }
      if (b.usdValueCents === null && s.usdValueCents !== null && b.status === "READY") { b.usdValueCents = s.usdValueCents; b.valuation = "COUNTER_LEG"; b.confidence = "ESTIMATED"; }
    }
  }
  for (const e of legs) {
    if (e.status === "READY" && e.usdValueCents === null) { e.status = "DATA_REQUIRED"; e.missing = ["PRICE"]; e.reason += " PRICE DATA UNAVAILABLE for this asset at this time; no value is assumed."; }
  }
}

/**
 * Pure tax calculation over the normalized transaction layer. Pooling is per asset across ALL supplied wallets
 * (the existing engine scope is the user). Inputs are never mutated. The result NEVER reports COMPLETE when a price,
 * cost basis, timestamp, classification, transfer match, or part of the history/holdings is missing.
 */
export function computeTax(input: TaxCalcInput): TaxCalcResult {
  const { method, taxYear } = input;
  const seenId = new Set<string>(), seenSig = new Set<string>();
  const txs: TaxTxInput[] = [];
  let duplicatesIgnored = 0;
  for (const t of input.txs) {
    const key = `${t.walletId}|${t.signature}`;
    if (seenId.has(t.id) || seenSig.has(key)) { duplicatesIgnored++; continue; }
    validate(t);
    seenId.add(t.id); seenSig.add(key); txs.push(t);
  }
  txs.sort((a, b) => (a.occurredAt ?? Infinity) - (b.occurredAt ?? Infinity) || a.signature.localeCompare(b.signature) || a.id.localeCompare(b.id));

  const events = txs.flatMap((t) => eventsFromTx(t, input.swapTreatment));
  for (const o of input.openingLots ?? []) {
    if (o.quantity <= 0n) throw new TaxInputError(`opening lot ${o.id}: quantity must be positive`);
    if (o.costBasisCents < 0n) throw new TaxInputError(`opening lot ${o.id}: negative cost basis`);
    if (!Number.isSafeInteger(o.acquiredAt) || o.acquiredAt < 0) throw new TaxInputError(`opening lot ${o.id}: invalid acquisition time`);
    events.push({
      id: `opening:${o.id}`, txId: `opening:${o.id}`, signature: `opening:${o.id}`, walletId: o.walletId, timestamp: o.acquiredAt, kind: "BUY", asset: o.asset, decimals: o.decimals,
      quantity: o.quantity, usdValueCents: o.costBasisCents, price: null, valuation: null, feeLamports: null,
      classification: { kind: "opening_lot", reason: "User-supplied opening lot", version: "1" }, status: "READY",
      reason: "User-supplied opening lot (cost basis entered by the user, not derived from any transaction).", missing: [], confidence: "ESTIMATED", matchedWith: null, candidates: [], uncoveredQuantity: 0n,
    });
  }
  matchTransfers(events, input.candidateWindowSeconds ?? 3600);
  priceEvents(events, input.priceAt);

  // ---- lots and disposals (only READY BUY/SELL with a value and a time) ----
  const lots: AcquisitionLot[] = [];
  for (const e of events) if (e.kind === "BUY" && e.status === "READY") lots.push({ lotId: e.id, sourceTxId: e.txId, asset: e.asset, decimals: e.decimals, quantity: e.quantity, acquiredAt: e.timestamp!, costBasisCents: e.usdValueCents! });
  const sells = events.filter((e) => e.kind === "SELL" && e.status === "READY").sort((a, b) => a.timestamp! - b.timestamp! || a.id.localeCompare(b.id));
  // Availability is method-independent (see TAX_ENGINE.md), so uncovered quantity can be found before calling the engine.
  const consumed = new Map<string, bigint>();
  const disposals: Disposal[] = [];
  for (const s of sells) {
    const eligible = lots.filter((l) => l.asset === s.asset && l.acquiredAt <= s.timestamp!).reduce((n, l) => n + l.quantity, 0n);
    const free = eligible - (consumed.get(s.asset) ?? 0n);
    const covered = free <= 0n ? 0n : free < s.quantity ? free : s.quantity;
    s.uncoveredQuantity = s.quantity - covered;
    if (covered > 0n) {
      const proceeds = covered === s.quantity ? s.usdValueCents! : (s.usdValueCents! * covered) / s.quantity;
      disposals.push({ txId: s.id, asset: s.asset, decimals: s.decimals, quantity: covered, disposedAt: s.timestamp!, proceedsCents: proceeds });
      consumed.set(s.asset, (consumed.get(s.asset) ?? 0n) + covered);
    }
    if (s.uncoveredQuantity > 0n) {
      s.status = "DATA_REQUIRED"; s.missing = ["COST_BASIS"];
      s.reason += ` Cost basis missing for ${s.uncoveredQuantity} base units: no acquisition record exists for them in the indexed history. Only the covered part is realized.`;
    }
  }
  const realizedEngine: RealizedEvent[] = realize(lots, disposals, method).events;
  const byId = new Map(events.map((e) => [e.id, e]));
  const realized: RealizedSlice[] = realizedEngine.map((r) => {
    const d = byId.get(r.transaction_id)!, l = byId.get(r.lot_id)!;
    return {
      disposalEventId: d.id, lotEventId: l.id, asset: r.asset, decimals: d.decimals, quantity: r.quantity, acquiredAt: r.acquisition_timestamp, disposedAt: r.disposal_timestamp,
      costBasisCents: r.cost_basis, unitCostBasisMicro: r.acquisition_price_micro, proceedsCents: r.proceeds, gainLossCents: r.gain_loss, holdingPeriod: r.holding_period,
      disposalSignature: d.signature, acquisitionSignature: l.signature, walletId: d.walletId, sourceWalletIdOfLot: l.walletId,
      proceedsPrice: d.price, costPrice: l.price, feeLamports: d.feeLamports,
    };
  });

  // ---- requirements and status ----
  const count = (f: (e: TaxEvent) => boolean) => events.filter(f).length;
  const reqs: Requirement[] = [];
  const add = (r: Requirement) => { if (r.count > 0) reqs.push(r); };
  const missing = (k: MissingKind) => count((e) => e.missing.includes(k));
  const cov = input.coverage;
  add({ kind: "PRICE", severity: "blocks_total", count: missing("PRICE"), message: "Price data unavailable: a historical USD price is required for these events. No price is assumed." });
  add({ kind: "COST_BASIS", severity: "blocks_total", count: missing("COST_BASIS"), message: "Data required: cost basis is missing for these disposals (no matching acquisition in the indexed history)." });
  add({ kind: "TIMESTAMP", severity: "blocks_total", count: missing("TIMESTAMP"), message: "Data required: the block time is unknown for these events." });
  add({ kind: "CLASSIFICATION", severity: "incomplete", count: missing("CLASSIFICATION"), message: "UNKNOWN or unassessed transactions: these are not included in any figure." });
  add({ kind: "TRANSFER_MATCH", severity: "incomplete", count: missing("TRANSFER_MATCH"), message: "Unresolved transfers: not matched to a counterpart; no cost basis is invented for received assets and sent assets are not treated as sales." });
  add({ kind: "HISTORY", severity: "incomplete", count: !cov.historyComplete || cov.hasGap ? 1 : 0, message: "Wallet history is incomplete: older transactions are not indexed, or transactions between syncs may be missing. Acquisitions before the indexed window are unknown." });
  add({ kind: "HOLDINGS", severity: "incomplete", count: cov.holdingsComplete ? 0 : 1, message: "Holdings are incomplete: the last sync could not list every token." });
  add({ kind: "RATES", severity: "info", count: input.rates ? 0 : 1, message: "Tax rates were not supplied, so no exposure estimate is shown. Realized gains and losses are still listed." });
  if (!cov.synced) reqs.unshift({ kind: "SYNC", severity: "blocks_total", count: 1, message: "Unavailable: no wallet has been synced yet." });

  const status = !cov.synced ? "UNAVAILABLE" : reqs.some((r) => r.severity === "blocks_total") ? "DATA_REQUIRED" : reqs.some((r) => r.severity === "incomplete") ? "PARTIAL" : "COMPLETE";

  let estimate = null as TaxCalcResult["estimate"], exposure: bigint | null = null;
  if (status !== "UNAVAILABLE") {
    const rates = input.rates ?? { shortTermRateBps: 0, longTermRateBps: 0, stateRateBps: 0 };
    estimate = estimateTax(realizedEngine, { jurisdiction: "US", taxYear, ...rates });
    exposure = input.rates ? estimate.estimatedExposureCents : null;
  }

  const counts = Object.fromEntries(KINDS.map((k) => [k, count((e) => e.kind === k)])) as Record<TaxEventKind, number>;
  const stat = (s: TaxEventStatus) => count((e) => e.status === s);
  const used = new Map<string, PriceQuote>();
  for (const e of events) if (e.price) used.set(`${e.asset}@${e.timestamp}`, e.price);
  const canonicalInput = [
    `v=1 method=${method} year=${taxYear} swap=${input.swapTreatment} cov=${cov.synced}/${cov.historyComplete}/${cov.hasGap}/${cov.holdingsComplete}`,
    ...(input.openingLots ?? []).map((o) => `open ${o.id} ${o.walletId} ${o.asset}:${o.decimals}:${o.quantity} t=${o.acquiredAt} cost=${o.costBasisCents}`).sort(),
    ...txs.map((t) => `tx ${t.walletId} ${t.signature} ${t.id} ${t.status} ${t.kind}@${t.classifierVersion} t=${t.occurredAt} fee=${t.feeLamports} ${t.deltas.map((d) => `${d.asset}:${d.decimals}:${d.delta}`).sort().join(",")}`),
    ...[...used].sort(([a], [b]) => a.localeCompare(b)).map(([k, p]) => `px ${k} ${p.priceMicroUsd} ${p.source} ${p.observedAt}`),
  ].join("\n");

  return {
    status, method, taxYear, swapTreatment: input.swapTreatment, events, realized, estimate, exposureCents: exposure, requirements: reqs,
    counts: { ...counts, unresolved: stat("UNRESOLVED"), dataRequired: stat("DATA_REQUIRED"), matched: stat("MATCHED"), duplicatesIgnored },
    canonicalInput, feePolicy: "RECORDED_NOT_APPLIED",
  };
}
