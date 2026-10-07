import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BANNED_PHRASES } from "@project-name/shared";
import { describe, expect, it } from "vitest";

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const roots = [join(__dirname, "../src"), join(__dirname, "../../../packages/shared/src")];

describe("copy lint over API + shared sources", () => {
  const files = roots.flatMap(walk).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith("language.ts"));
  it("has no banned marketing/tax phrases and no positive safety or immutability claims", () => {
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const t = readFileSync(f, "utf8").toLowerCase();
      for (const p of BANNED_PHRASES) expect(t, `${f}: "${p}"`).not.toContain(p);
      expect(t, `${f}: tax bill field`).not.toMatch(/taxbill|tax_bill/);
      expect(t, `${f}: safety claim`).not.toMatch(/100% safe|completely safe|totally safe/);
    }
  });
  it("never stores or accepts key material: no such field names in schemas or SQL", () => {
    // deployment.ts is the one file that must NAME key material, because it holds the guard that refuses it (and prose saying none is collected)
    const guard = files.filter((f) => f.endsWith("packages/shared/src/deployment.ts") || f.endsWith("packages/shared/src/deploymentPolicy.ts"));
    expect(guard).toHaveLength(2);
    for (const f of files.filter((x) => !guard.includes(x))) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/private_?key|seed_?phrase|mnemonic|secret_?key/i);
    }
    // inside the guard file, key material may appear only as refusal logic or "never collected" prose, never as a field of a schema
    for (const gf of guard) {
      const g = readFileSync(gf, "utf8");
      expect(g, gf).not.toMatch(/z\.(string|object)\(.*(privateKey|secretKey|seedPhrase|mnemonic)/i);
      expect(g, gf).not.toMatch(/\b(privateKey|secretKey|seedPhrase|mnemonic)\s*:/);
    }
  });
});
