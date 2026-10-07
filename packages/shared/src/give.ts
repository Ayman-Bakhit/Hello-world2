/**
 * Give / charity foundation (Slice 9). Pure domain rules; no I/O.
 *
 * Four things are kept apart on purpose:
 *   registry record      what a charity says it is (name, website, ...)
 *   verification evidence what someone checked, when, from which source, with what result
 *   donation record      a user's intended/recorded contribution; NOT proof a transfer happened
 *   receipt              a document reference; NOT proof of tax deductibility
 * Nothing here moves money. Slice 9 has no transfer path at all.
 */

export const CHARITY_VERIFICATION_STATES = ["UNVERIFIED", "PENDING_REVIEW", "VERIFIED", "SUSPENDED"] as const;
export type CharityVerificationState = (typeof CHARITY_VERIFICATION_STATES)[number];

export const EVIDENCE_SOURCE_TYPES = ["REGISTRY_LOOKUP", "OFFICIAL_DOCUMENT", "WEBSITE_CLAIM", "ADMIN_REVIEW", "FIXTURE"] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];
/** Source types that may support a VERIFIED state. A website alone never proves legitimacy. */
export const VERIFYING_SOURCE_TYPES: readonly EvidenceSourceType[] = ["REGISTRY_LOOKUP", "OFFICIAL_DOCUMENT", "ADMIN_REVIEW", "FIXTURE"];

export const EVIDENCE_STATUSES = ["SUPPORTS", "DOES_NOT_SUPPORT", "INCONCLUSIVE"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** 'demo' is not a lifecycle state: it marks a fixture record that never had, and can never get, an on-chain transaction. */
export const DONATION_STATUSES = ["draft", "pending", "confirmed", "failed", "cancelled", "demo"] as const;
export type DonationStatusValue = (typeof DONATION_STATUSES)[number];
export const DONATION_PROVENANCES = ["DEMO_FIXTURE", "USER_PLAN", "CHAIN_INDEXED"] as const;
export const USD_REFERENCE_SOURCES = ["FIXTURE", "USER_ENTERED_USDC_PAR", "PRICE_OBSERVATION"] as const;

export const RECEIPT_VERIFICATION_STATES = ["UNVERIFIED", "CHARITY_REPORTED", "VERIFIED"] as const;

export const GIVE_COPY = {
  verificationStatus: "Verification status",
  verificationSource: "Verification source",
  lastReviewed: "Last reviewed",
  evidence: "Evidence",
  noDonations: "NO DONATIONS YET",
  transfersDisabled: "Donation transfers are not enabled in this beta.",
  taxNote: "Potentially deductible charitable contribution. Consult a tax professional.",
  usdReference: "USD value is a reference value, not automatically the deductible amount.",
  demoReceipt: "DEMO RECEIPT",
  fixtureData: "FIXTURE DATA",
  notTaxReceipt: "NOT A TAX RECEIPT",
  receiptCaveat: "A receipt is a document reference. It does not prove that a contribution is deductible.",
  fixtureVerification: "Fixture record for development. This is not a real-world verification.",
  futureSigning: "A future version will ask you to review and explicitly sign a transaction in your wallet. Nothing is signed or sent now.",
} as const;

// ---------- untrusted metadata ----------
const CONTROL_PATTERN = "[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]";
const CONTROL_OR_BIDI = new RegExp(CONTROL_PATTERN, "g");
const HAS_CONTROL = new RegExp(CONTROL_PATTERN);

/** Plain text from an untrusted source: control and bidi-override characters removed, whitespace collapsed, length capped. */
export function cleanText(s: string, max: number): string {
  return s.replace(CONTROL_OR_BIDI, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Accepts only absolute http(s) URLs with a host, no credentials, no whitespace/control chars, <= 500 chars.
 * Returns the normalized URL or null. `httpsOnly` is used for logos and receipt documents.
 * This is validation, not endorsement: a valid URL says nothing about whether the site is legitimate.
 */
export function safeHttpUrl(raw: string | null | undefined, opts: { httpsOnly?: boolean } = {}): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 500) return null;
  if (HAS_CONTROL.test(raw) || /\s/.test(raw)) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && !opts.httpsOnly)) return null;
  if (u.username !== "" || u.password !== "" || u.hostname === "") return null;
  return u.toString();
}

// ---------- invariants (mirrored by DB constraints) ----------
export interface DonationFacts {
  status: DonationStatusValue;
  dataSource: "demo" | "database" | "chain";
  transactionSignature: string | null;
}

/** Returns a violation message, or null when the combination is allowed. */
export function donationInvariantViolation(d: DonationFacts): string | null {
  if (d.status === "confirmed") {
    if (!d.transactionSignature) return "a confirmed donation requires an on-chain transaction signature";
    if (d.dataSource !== "chain") return "a confirmed donation must come from indexed chain data";
  }
  if (d.status === "demo" && d.transactionSignature) return "a demo record cannot have a transaction";
  if ((d.status === "demo") !== (d.dataSource === "demo")) return "fixture data must be status demo, and demo status must be fixture data";
  return null;
}

/** What a verified charity badge may say, given its provenance. Never "safe" or "guaranteed". */
export function verificationLabel(state: CharityVerificationState, source: EvidenceSourceType | null): string {
  if (state === "VERIFIED") return source === "FIXTURE" ? "VERIFIED (FIXTURE, NOT REAL-WORLD)" : "VERIFIED";
  return { UNVERIFIED: "UNVERIFIED", PENDING_REVIEW: "PENDING REVIEW", SUSPENDED: "SUSPENDED" }[state];
}

/** Only a charity with a real (non-fixture) verifying source may ever be presented as real-world verified. */
export function isRealWorldVerified(state: CharityVerificationState, source: EvidenceSourceType | null): boolean {
  return state === "VERIFIED" && source !== null && source !== "FIXTURE" && VERIFYING_SOURCE_TYPES.includes(source);
}
