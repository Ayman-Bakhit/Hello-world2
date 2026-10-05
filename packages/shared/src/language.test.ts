import { describe, expect, it } from "vitest";
import { BANNED_PHRASES, COPY } from "./language.js";

describe("approved copy", () => {
  it("contains no banned phrases", () => {
    const text = Object.values(COPY).join(" ").toLowerCase();
    for (const p of BANNED_PHRASES) expect(text).not.toContain(p);
  });
});
