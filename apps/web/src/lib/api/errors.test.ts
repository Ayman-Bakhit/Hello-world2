import { NO_LIVE_DATA } from "@project-name/shared";
import { describe, expect, it } from "vitest";
import { describeApiError } from "./errors";
import { ApiClientError } from "./http";

const e = (status: number, code: string, message = "server text", fields?: Record<string, string[]>) => new ApiClientError(status, code, message, fields);

describe("describeApiError: one consistent mapping", () => {
  it("401 -> authentication required", () => {
    const v = describeApiError(e(401, "UNAUTHENTICATED"));
    expect(v).toMatchObject({ kind: "unauthenticated", title: "AUTHENTICATION REQUIRED", retryable: false });
  });
  it("403 -> not allowed", () => expect(describeApiError(e(403, "ORIGIN_NOT_ALLOWED")).kind).toBe("forbidden"));
  it("404 NO_LIVE_DATA is distinct from a plain 404", () => {
    const empty = describeApiError(e(404, NO_LIVE_DATA));
    expect(empty).toMatchObject({ kind: "no_live_data", title: "NO LIVE DATA YET" });
    expect(empty.message).toBe("Your wallet is authenticated, but no live data has been indexed for it yet. Use SYNC WALLET to read it from the blockchain.");
    expect(describeApiError(e(404, "NOT_FOUND")).kind).toBe("not_found");
  });
  it("400 keeps field messages for display", () => {
    const v = describeApiError(e(400, "VALIDATION_ERROR", "x", { feeSplit: ["fee split totals 10001 basis points; it must be exactly 10000"] }));
    expect(v.kind).toBe("validation");
    expect(v.fields).toEqual({ feeSplit: ["fee split totals 10001 basis points; it must be exactly 10000"] });
  });
  it("409 and 422 show our own (safe) message", () => {
    expect(describeApiError(e(409, "LIMIT_REACHED", "At most 50 launch configurations per account"))).toMatchObject({ kind: "conflict", message: "At most 50 launch configurations per account" });
    expect(describeApiError(e(422, "CHARITY_NOT_VERIFIED", "This charity is not verified"))).toMatchObject({ kind: "rejected" });
  });
  it("sync cooldown shows its own message; indexing-not-configured is explicit; neither leaks 5xx text", () => {
    expect(describeApiError(e(429, "SYNC_COOLDOWN", "This wallet was synced very recently. Try again in 12s."))).toMatchObject({ kind: "rate_limited", message: "This wallet was synced very recently. Try again in 12s." });
    expect(describeApiError(e(503, "INDEXING_UNAVAILABLE", "SOLANA_RPC_URL is not set"))).toMatchObject({ title: "INDEXING NOT CONFIGURED" });
    expect(JSON.stringify(describeApiError(e(503, "INDEXING_UNAVAILABLE", "SOLANA_RPC_URL is not set")))).not.toContain("SOLANA_RPC_URL");
  });
  it("429 is retryable", () => expect(describeApiError(e(429, "RATE_LIMITED"))).toMatchObject({ kind: "rate_limited", retryable: true }));
  it("network failures are retryable and friendly", () => {
    expect(describeApiError(e(0, "NETWORK_ERROR"))).toMatchObject({ kind: "network", retryable: true });
  });
  it("500 and unknown errors NEVER leak server text, stack traces, or internals", () => {
    const leaky = "TypeError: cannot read x\n    at Object.<anonymous> (/srv/app/secret.ts:10:5) password=hunter2";
    for (const err of [e(500, "INTERNAL_ERROR", leaky), e(502, "HTTP_ERROR", leaky), e(418, "TEAPOT", leaky), new Error(leaky), "string error", null]) {
      const v = describeApiError(err);
      const text = JSON.stringify(v);
      expect(text, String(err)).not.toMatch(/hunter2|secret\.ts|at Object|TypeError/);
    }
    expect(describeApiError(e(500, "INTERNAL_ERROR")).kind).toBe("server");
  });
});
