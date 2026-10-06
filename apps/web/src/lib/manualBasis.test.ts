import { describe, expect, it } from "vitest";
import { EMPTY_BASIS_DRAFT, draftFromItem, draftToRequest, missingBasisItems } from "./manualBasis";
import type { TaxDetailsResponse } from "@project-name/shared";

const NOW = Date.UTC(2025, 0, 1);
const MINT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const ok = { ...EMPTY_BASIS_DRAFT, asset: MINT, decimals: "6", quantity: "2.5", acquiredAt: "2023-05-17T14:30:00Z", costBasis: "100.25" };

describe("cost basis form -> request (same strict rules as the server)", () => {
  it("valid draft becomes an exact request body; decimals omitted for SOL", () => {
    expect(draftToRequest(ok, NOW)).toEqual({ ok: true, body: expect.objectContaining({ asset: MINT, decimals: 6, quantity: "2.5", costBasis: "100.25", currency: "USD", reason: "EXCHANGE_PURCHASE" }) });
    const sol = draftToRequest({ ...ok, asset: "native", decimals: "", quantity: "1.000000001" }, NOW);
    expect(sol.ok && "decimals" in sol.body).toBe(false);
  });
  it("rejects zero/negative/over-precise quantity, bad cost, mint, timestamp, signature, unsafe notes, with field messages", () => {
    const f = (o: Partial<typeof ok>) => { const r = draftToRequest({ ...ok, ...o }, NOW); return r.ok ? {} : r.fields; };
    expect(f({ quantity: "0" }).quantity).toBeDefined();
    expect(f({ quantity: "-3" }).quantity).toBeDefined();
    expect(f({ quantity: "0.0000001" }).quantity![0]).toMatch(/rounded/);
    expect(f({ costBasis: "-1" }).costBasis).toBeDefined();
    expect(f({ costBasis: "1.999" }).costBasis).toBeDefined();
    expect(f({ asset: "nope" }).asset).toBeDefined();
    expect(f({ acquiredAt: "2099-01-01T00:00:00Z" }).acquiredAt).toBeDefined();
    expect(f({ acquiredAt: "yesterday" }).acquiredAt).toBeDefined();
    expect(f({ signature: "short" }).signature).toBeDefined();
    expect(f({ notes: "a\u0000" }).notes).toBeDefined();
    expect(f({ decimals: "" }).decimals).toBeDefined(); // unknown mint needs decimals
  });
  it("no silent rounding: u64-max exact string passes, one more decimal is refused", () => {
    expect(draftToRequest({ ...ok, asset: "native", decimals: "", quantity: "18446744073.709551615" }, NOW).ok).toBe(true);
    expect(draftToRequest({ ...ok, asset: "native", decimals: "", quantity: "0.0000000001" }, NOW).ok).toBe(false);
  });
});

describe("missing basis items come only from the API's events", () => {
  const ev = (o: Record<string, unknown>) => ({ id: "e", signature: "S".repeat(88), walletId: "w", timestamp: "2024-01-02T00:00:00.000Z", kind: "SELL", status: "DATA_REQUIRED", asset: MINT, mint: MINT, decimals: 6, quantity: "5000000", uncoveredQuantity: "2500000", missing: ["COST_BASIS"], origin: "CHAIN", manualBasisId: null, ...o }) as unknown as TaxDetailsResponse["events"][number];
  const d = (events: TaxDetailsResponse["events"]) => ({ events }) as TaxDetailsResponse;
  it("uncovered disposal quantity and unresolved transfers; nothing else", () => {
    const items = missingBasisItems(d([ev({}), ev({ id: "t", kind: "TRANSFER_IN", status: "UNRESOLVED", missing: ["TRANSFER_MATCH"], quantity: "10000000" }), ev({ id: "ok", status: "READY", missing: [] }), ev({ id: "p", missing: ["PRICE"] })]));
    expect(items.map((i) => [i.kind, i.quantity])).toEqual([["DISPOSAL", "2.5"], ["TRANSFER_IN", "10"]]);
  });
  it("prefill from a transfer-in ties the signature; from a disposal it does not", () => {
    const [disposal, transfer] = missingBasisItems(d([ev({}), ev({ id: "t", kind: "TRANSFER_IN", status: "UNRESOLVED", missing: ["TRANSFER_MATCH"], quantity: "10000000" })]));
    expect(draftFromItem(disposal!)).toMatchObject({ asset: MINT, decimals: "6", quantity: "2.5", signature: "" });
    expect(draftFromItem(transfer!).signature).toBe("S".repeat(88));
  });
});
