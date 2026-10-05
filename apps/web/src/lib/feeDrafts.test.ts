import { describe, expect, it } from "vitest";
import { draftsFromSplit, parseFeeDrafts } from "./feeDrafts";

const base = draftsFromSplit({ creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 });

describe("parseFeeDrafts (delegates to shared math)", () => {
  it("accepts the default 60/15/15/10", () => {
    const r = parseFeeDrafts(base);
    expect(r.split).toEqual({ creator: 6000, taxReserve: 1500, charity: 1500, protocol: 1000 });
    expect(r.totalBps).toBe(10_000);
    expect(r.messages).toEqual([]);
  });
  it("rejects 100.01% with a precise message", () => {
    const r = parseFeeDrafts({ ...base, creator: "60.01" });
    expect(r.split).toBeNull();
    expect(r.totalBps).toBe(10_001);
    expect(r.messages[0]).toContain("100.01%");
    expect(r.messages[0]).toContain("Remove 0.01%");
  });
  it("rejects 99.99%", () => {
    const r = parseFeeDrafts({ ...base, creator: "59.99" });
    expect(r.split).toBeNull();
    expect(r.messages[0]).toContain("Add 0.01%");
  });
  it("rejects unparseable input without a total", () => {
    for (const bad of ["", "abc", "10.123", "-1", "1e1"]) {
      const r = parseFeeDrafts({ ...base, charity: bad });
      expect(r.split).toBeNull();
      expect(r.totalBps).toBeNull();
      expect(r.messages[0]).toContain("Charity");
    }
  });
  it("allows 100% to one bucket and 0% elsewhere", () => {
    expect(parseFeeDrafts({ creator: "100", taxReserve: "0", charity: "0", protocol: "0" }).split).not.toBeNull();
  });
});
