/** Approved UI copy for regulated-adjacent claims. Import these instead of free-typing. */
export const COPY = {
  taxExposure: "Estimated tax exposure",
  taxReserve: "Estimated tax reserve",
  taxPlanning: "Tax planning estimate",
  donation: "Potentially deductible charitable contribution. Consult a tax professional.",
  donationNote: "Tax treatment depends on your circumstances and applicable law.",
  verified: "VERIFIED TRANSPARENCY",
  riskPanel: "RISK INDICATORS",
  demo: "DEMO DATA",
  irsCharity: "https://www.irs.gov/charities-non-profits/charitable-organizations",
  irsCrypto: "https://www.irs.gov/filing/digital-assets",
} as const;

/** Phrases that must never appear in shipped UI copy. Used by a copy-lint test. */
export const BANNED_PHRASES = [
  "guaranteed tax write-off",
  "tax loophole",
  "tax avoidance",
  "guaranteed profit",
  "risk-free",
  "safe crypto",
  "anti-rug",
  "your tax bill",
  "irs-ready",
  "tax filing ready",
  "guaranteed tax result",
  "verified tax return",
] as const;
