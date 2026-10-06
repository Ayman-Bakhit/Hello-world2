import type { SessionResponse } from "@project-name/shared";
import { describe, expect, it } from "vitest";
import { INITIAL_API_STATE, apiAuthReducer, deriveStatus, mockReducer, type ApiAuthAction, type ApiAuthState } from "./wallet";

const session = (authenticated: boolean): SessionResponse =>
  authenticated
    ? { authenticated: true, user: { id: "00000000-0000-4000-8000-000000000001" }, wallet: { id: "00000000-0000-4000-8000-000000000002", chain: "solana", address: "5Kp4FZEgwGQf3RYiLXXtPPsLC8HBcqU2NgMig8c3cCwt", label: null, ownershipVerified: true, dataSource: "database", createdAt: "x" }, session: { expiresAt: "x", authMethod: "wallet_signature" } }
    : { authenticated: false, user: null, wallet: null, session: null };
const run = (...actions: ApiAuthAction[]): ApiAuthState => actions.reduce(apiAuthReducer, INITIAL_API_STATE);

describe("api auth state machine", () => {
  it("starts disconnected", () => expect(deriveStatus(INITIAL_API_STATE)).toBe("disconnected"));
  it("connecting a wallet is CONNECTED, never AUTHENTICATED", () => {
    const s = run({ type: "connecting", walletName: "Phantom" }, { type: "connected", walletName: "Phantom", address: "A" });
    expect(deriveStatus(s)).toBe("connected");
    expect(s.session).toBeNull();
  });
  it("AUTHENTICATED only after a server-verified session arrives", () => {
    const connected = run({ type: "connected", walletName: "Phantom", address: "A" });
    expect(deriveStatus(apiAuthReducer(connected, { type: "signing-started" }))).toBe("signing");
    expect(deriveStatus(apiAuthReducer(connected, { type: "authenticated", session: session(true) }))).toBe("authenticated");
  });
  it("failed signing returns to connected with an error, not authenticated", () => {
    const s = run({ type: "connected", walletName: "P", address: "A" }, { type: "signing-started" }, { type: "challenge", challenge: { message: "m", expiresAt: "e" } }, { type: "sign-failed", error: "declined" });
    expect(deriveStatus(s)).toBe("connected");
    expect(s.error).toBe("declined");
    expect(s.challenge).toBeNull();
    expect(s.session).toBeNull();
  });
  it("an unauthenticated session response does not authenticate", () => {
    expect(deriveStatus(run({ type: "session-loaded", session: session(false) }))).toBe("disconnected");
    expect(deriveStatus(run({ type: "session-loaded", session: session(true) }))).toBe("authenticated");
  });
  it("signed-out resets everything", () => {
    const s = run({ type: "connected", walletName: "P", address: "A" }, { type: "authenticated", session: session(true) }, { type: "signed-out" });
    expect(s).toEqual(INITIAL_API_STATE);
  });
  it("connect failure clears wallet and shows the error", () => {
    const s = run({ type: "connecting", walletName: "P" }, { type: "connect-failed", error: "nope" });
    expect(deriveStatus(s)).toBe("disconnected");
    expect(s.error).toBe("nope");
  });
});

describe("mock (demo) reducer", () => {
  it("connects demo wallets and disconnects; has no concept of authentication", () => {
    const a = mockReducer({ provider: null, wallets: [] }, { type: "connect", provider: "phantom" });
    expect(a.wallets).toHaveLength(1);
    expect(mockReducer(a, { type: "disconnect" })).toEqual({ provider: null, wallets: [] });
    expect(Object.keys(a)).not.toContain("session");
  });
});
