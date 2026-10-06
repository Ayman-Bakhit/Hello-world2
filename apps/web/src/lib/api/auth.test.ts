import { SIGN_IN_STATEMENT, buildSignInMessage } from "@project-name/shared";
import { describe, expect, it, vi } from "vitest";
import { createAuthApi } from "./auth";

const f = { domain: "localhost:3000", uri: "http://localhost:3000", address: "5Kp4FZEgwGQf3RYiLXXtPPsLC8HBcqU2NgMig8c3cCwt", chainId: "solana:devnet", nonce: "AbCdEfGhIjKlMnOpQrStUvWxYz012345", issuedAt: "2026-10-06T12:00:00.000Z", expirationTime: "2026-10-06T12:05:00.000Z" };
const json = (b: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } }));

describe("auth api client", () => {
  it("nonce: POSTs the address with credentials included and validates the response", async () => {
    const message = buildSignInMessage(f);
    const fetchImpl = vi.fn(async (..._a: Parameters<typeof fetch>) => json({ nonce: f.nonce, message, domain: f.domain, chainId: f.chainId, issuedAt: f.issuedAt, expiresAt: f.expirationTime }));
    const api = createAuthApi({ baseUrl: "http://api.test/", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await api.requestNonce(f.address);
    expect(r.message).toContain(SIGN_IN_STATEMENT);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/auth/nonce");
    expect(init).toMatchObject({ method: "POST", credentials: "include", cache: "no-store", body: JSON.stringify({ address: f.address }) });
    expect((init as RequestInit).headers).not.toHaveProperty("authorization");
  });
  it("verify sends exactly address, nonce, message, signature; logout and session use the cookie only", async () => {
    const sess = { authenticated: false, user: null, wallet: null, session: null };
    const fetchImpl = vi.fn(async (..._a: Parameters<typeof fetch>) => json(sess));
    const api = createAuthApi({ baseUrl: "http://api.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = { address: f.address, nonce: f.nonce, message: "m", signature: "A".repeat(86) + "==" };
    await api.verify(body);
    expect(JSON.parse(String((fetchImpl.mock.calls[0]![1] as RequestInit).body))).toEqual(body);
    await api.getSession();
    expect(fetchImpl.mock.calls[1]![1]).toMatchObject({ method: "GET", credentials: "include" });
    fetchImpl.mockImplementationOnce(async () => json({ loggedOut: true }));
    await api.logout();
    expect(fetchImpl.mock.calls[2]![1]).toMatchObject({ method: "POST", credentials: "include" });
  });
  it("maps 401 AUTH_FAILED and rejects responses that violate the contract", async () => {
    const bad = createAuthApi({ baseUrl: "http://x", fetchImpl: (async () => json({ error: { code: "AUTH_FAILED", message: "Sign-in failed." } }, 401)) as unknown as typeof fetch });
    await expect(bad.verify({ address: f.address, nonce: f.nonce, message: "m", signature: "A".repeat(86) + "==" })).rejects.toMatchObject({ status: 401, code: "AUTH_FAILED" });
    const weird = createAuthApi({ baseUrl: "http://x", fetchImpl: (async () => json({ authenticated: "yes" })) as unknown as typeof fetch });
    await expect(weird.getSession()).rejects.toThrow();
  });
});
