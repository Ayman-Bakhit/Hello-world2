import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { ManualBasisDetail, ManualBasisView } from "@project-name/shared";
import { EMPTY_BASIS_DRAFT } from "@/lib/manualBasis";
import { BasisHistory, ManualBasisForm, ManualBasisRecords, MissingBasisBanner } from "./ManualBasisPanel";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const MINT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const rec = (o: Partial<ManualBasisView> = {}): ManualBasisView => ({
  id: "11111111-1111-4111-8111-111111111111", walletId: "22222222-2222-4222-8222-222222222222", asset: MINT, mint: MINT, decimals: 6, source: "USER_PROVIDED", verifiedOnChain: false,
  revision: 1, action: "create", status: "active", quantity: "10", quantityRaw: "10000000", acquiredAt: "2023-01-02T03:04:05.000Z", costBasis: "50.00", costBasisCents: "5000", currency: "USD",
  reason: "EXCHANGE_PURCHASE", signature: null, notes: null, acknowledgedOverlap: false, changeReason: null, createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", review: { manualBasisId: "x", state: "OK", acknowledged: false, included: true, linkedEventId: null, conflicts: [], explanation: "" }, ...o,
});
const noop = () => undefined;

describe("missing cost basis workflow", () => {
  const item = { key: "k", kind: "DISPOSAL" as const, asset: MINT, mint: MINT, decimals: 6, quantity: "2.5", signature: "S", timestamp: "2024-01-02T00:00:00.000Z" };
  it("shows COST BASIS REQUIRED, the no-verified-basis wording, both buttons, and the USER-PROVIDED label; never says verified on-chain", () => {
    const out = html(<MissingBasisBanner items={[item]} recordCount={2} onAdd={noop} onReview={noop} />);
    expect(out).toContain("COST BASIS REQUIRED");
    expect(out).toContain("This asset has no verified historical cost basis.");
    expect(out).toContain("ADD COST BASIS");
    expect(out).toContain("REVIEW EXISTING BASIS (2)");
    expect(out).toContain("USER-PROVIDED TAX DATA");
    expect(out).toContain("cannot make missing prices or unknown transactions complete");
    expect(out).not.toMatch(/verified on-chain|VERIFIED ON-CHAIN/);
  });
  it("renders nothing when nothing is missing and there are no records", () => {
    expect(html(<MissingBasisBanner items={[]} recordCount={0} onAdd={noop} onReview={noop} />)).toBe("");
  });
});

describe("form", () => {
  it("has every field, USD only, the provenance badge, the no-rounding promise, and field errors", () => {
    const out = html(<ManualBasisForm draft={EMPTY_BASIS_DRAFT} setDraft={noop} onSubmit={noop} saving={false} fields={{ quantity: ["must be greater than zero"] }} error={null} />);
    for (const s of ["Asset (native, or token mint)", "Quantity (whole tokens)", "Acquisition date and time (UTC)", "Total cost basis (USD)", "Currency", "Reason / source", "Transaction signature (optional)", "Notes (optional, plain text)", "USER-PROVIDED TAX DATA", "Nothing is rounded", "must be greater than zero", "SAVE COST BASIS"]) expect(out, s).toContain(s);
    expect(out).toContain(">USD</option>");
  });
  it("revision form asks for a change reason and only offers the overlap acknowledgement when there is an overlap", () => {
    const a = html(<ManualBasisForm draft={EMPTY_BASIS_DRAFT} setDraft={noop} onSubmit={noop} saving={false} fields={null} error={null} revise={{ overlap: false }} />);
    expect(a).toContain("Why are you changing this?");
    expect(a).not.toContain("separate acquisition");
    expect(html(<ManualBasisForm draft={EMPTY_BASIS_DRAFT} setDraft={noop} onSubmit={noop} saving={false} fields={null} error={null} revise={{ overlap: true }} />)).toContain("separate acquisition");
  });
});

describe("records and audit history", () => {
  it("labels provenance, shows exact values, and lists duplicate conflicts with source, quantity and date", () => {
    const dup = rec({ review: { manualBasisId: "x", state: "POTENTIAL_DUPLICATE", acknowledged: false, included: false, linkedEventId: null, explanation: "Looks like a known acquisition.", conflicts: [{ source: "CHAIN", id: "e", signature: "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UNbmiMeFbvk", asset: MINT, quantity: "10000000", timestamp: "2023-01-02T00:00:00.000Z" }] } });
    const out = html(<ManualBasisRecords records={[dup, rec({ id: "33333333-3333-4333-8333-333333333333" })]} onHistory={noop} onRevise={noop} onVoid={noop} />);
    expect(out).toContain("USER-PROVIDED TAX DATA");
    expect(out).toContain("POTENTIAL DUPLICATE");
    expect(out).toContain("Excluded from the calculation until reviewed.");
    expect(out).toContain("Blockchain transaction");
    expect(out).toContain("10000000 base units");
    expect(out).toContain("$50.00 USD");
    expect(out).toContain("AUDIT HISTORY");
    expect(out).toContain("REVISE");
    expect(out).toContain("VOID");
    expect(out).not.toMatch(/delete/i);
  });
  it("notes and reasons are rendered as escaped text, never as markup", () => {
    const out = html(<ManualBasisRecords records={[rec({ notes: "<img src=x onerror=alert(1)><script>alert(2)</script>" })]} onHistory={noop} onRevise={noop} onVoid={noop} />);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
  });
  it("voided records can only show history", () => {
    const out = html(<ManualBasisRecords records={[rec({ status: "voided" })]} onHistory={noop} onRevise={noop} onVoid={noop} />);
    expect(out).toContain("VOIDED");
    expect(out).not.toContain(">REVISE<");
    expect(out).toContain("AUDIT HISTORY");
  });
  it("history lists every revision with the reason for change, and flags a broken hash chain", () => {
    const d = (intact: boolean): ManualBasisDetail & { historyIntact: boolean } => ({
      record: rec({ revision: 2 }), historyIntact: intact,
      history: [
        { revision: 1, action: "create", status: "active", quantity: "10", quantityRaw: "10000000", acquiredAt: "2023-01-02T00:00:00.000Z", costBasis: "50.00", costBasisCents: "5000", currency: "USD", reason: "OTHER", signature: null, notes: null, acknowledgedOverlap: false, changeReason: null, createdAt: "2025-01-01T00:00:00.000Z" },
        { revision: 2, action: "revise", status: "active", quantity: "12", quantityRaw: "12000000", acquiredAt: "2023-01-02T00:00:00.000Z", costBasis: "60.00", costBasisCents: "6000", currency: "USD", reason: "OTHER", signature: null, notes: null, acknowledgedOverlap: false, changeReason: "typo in quantity", createdAt: "2025-01-02T00:00:00.000Z" },
      ],
    });
    const ok = html(<BasisHistory detail={d(true)} />);
    expect(ok).toContain("typo in quantity");
    expect(ok).toContain("Earlier values are never overwritten");
    expect(ok).toContain("Hash chain intact");
    expect(html(<BasisHistory detail={d(false)} />)).toContain("Hash chain check FAILED");
  });
});
