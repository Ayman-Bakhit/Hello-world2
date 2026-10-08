import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEPLOYMENT_POLICY, REAL_EXECUTION_ENABLED, isApproved } from "./deploymentPolicy";

const DOC = readFileSync(join(__dirname, "../../../docs/LIQUIDITY_AND_FEE_ARCHITECTURE_RESEARCH.md"), "utf8");
const OWNER = readFileSync(join(__dirname, "../../../docs/PRODUCT_OWNER_DECISIONS.md"), "utf8");

describe("LIQUIDITY_AND_FEE_ARCHITECTURE_RESEARCH.md (research only)", () => {
  it("has the 17 required sections in order", () => {
    const heads = [...DOC.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
    expect(heads).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  });
  it("states that it decides and builds nothing, and keeps execution disabled", () => {
    expect(DOC).toMatch(/Nothing here is built, approved or decided/);
    expect(DOC).toContain("`REAL_EXECUTION_ENABLED` and `executionPermitted` are unchanged");
    expect(REAL_EXECUTION_ENABLED).toBe(false);
  });
  it("separates supply allocation from the fee split and names all four architectures", () => {
    expect(DOC).toMatch(/independent/); expect(DOC).toContain("8/40/52");
    for (const a of ["Architecture A", "Architecture B", "Architecture C", "Architecture D"]) expect(DOC, a).toContain(a);
  });
  it("labels evidence, and contains no address-shaped value, no em dash and no overclaim of VERIFIED", () => {
    for (const t of ["[SRC]", "[IDL]", "[DOCS]", "[KNOWN]", "[INFER]", "[UNKNOWN]"]) expect(DOC, t).toContain(t);
    expect(DOC.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)?.filter((w) => !/^[A-Za-z_]+$/.test(w) || /\d/.test(w))).toBeUndefined();
    expect(DOC).not.toMatch(/—/);
  });
  it("adds only PENDING owner questions, and approves no decision", () => {
    expect(OWNER).toContain("Liquidity and fee architecture decisions");
    expect(OWNER).toMatch(/every item is PENDING/);
    for (const id of ["LIQUIDITY_STRATEGY", "TAX_RESERVE_FUNDING", "PROTOCOL_DESTINATION"] as const) {
      const d = DEPLOYMENT_POLICY.decisions.find((x) => x.id === id)!;
      expect(d.status, id).toBe("PENDING"); expect(isApproved(d), id).toBe(false);
    }
  });
});
