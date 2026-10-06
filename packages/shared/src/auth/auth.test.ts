import { describe, expect, it } from "vitest";
import { buildSignInMessage, checkChallenge, parseSignInMessage, SIGN_IN_STATEMENT, type SignInMessageFields } from "./message";
import { NonceRequest, VerifyRequest } from "../api/schemas";

const f: SignInMessageFields = {
  domain: "app.example.com", uri: "https://app.example.com", address: "5Kp4FZEgwGQf3RYiLXXtPPsLC8HBcqU2NgMig8c3cCwt",
  chainId: "solana:devnet", nonce: "AbCdEfGhIjKlMnOpQrStUvWxYz012345", issuedAt: "2026-10-06T12:00:00.000Z", expirationTime: "2026-10-06T12:05:00.000Z",
};

describe("sign-in message format", () => {
  it("is deterministic and exactly as documented", () => {
    expect(buildSignInMessage(f)).toBe(
      [
        "app.example.com wants you to sign in with your Solana account:",
        "5Kp4FZEgwGQf3RYiLXXtPPsLC8HBcqU2NgMig8c3cCwt",
        "",
        "Sign in to PROJECT_NAME. This does not send a transaction or move funds.",
        "",
        "URI: https://app.example.com",
        "Version: 1",
        "Chain ID: solana:devnet",
        "Nonce: AbCdEfGhIjKlMnOpQrStUvWxYz012345",
        "Issued At: 2026-10-06T12:00:00.000Z",
        "Expiration Time: 2026-10-06T12:05:00.000Z",
      ].join("\n"),
    );
    expect(buildSignInMessage(f)).toBe(buildSignInMessage({ ...f }));
  });
  it("round-trips through the strict parser", () => {
    expect(parseSignInMessage(buildSignInMessage(f))).toEqual(f);
  });
  it("rejects injected newlines / malformed fields at build time", () => {
    for (const patch of [{ domain: "a.com\nURI: x" }, { address: "abc" }, { nonce: "short" }, { issuedAt: "yesterday" }, { chainId: "eth:1" }, { uri: "https://a.com/path" }]) {
      expect(() => buildSignInMessage({ ...f, ...patch }), JSON.stringify(patch)).toThrow();
    }
  });
  it("a different but well-formed nonce parses (binding to the issued nonce is the server's exact-match check)", () => {
    expect(parseSignInMessage(buildSignInMessage(f).replace("Nonce: A", "Nonce: B"))?.nonce).toBe("B" + f.nonce.slice(1));
  });
  it("parser rejects any modification, extra line, CRLF, trailing newline, or reordering", () => {
    const m = buildSignInMessage(f);
    const bad = [
      m + "\n", m.replace(/\n/g, "\r\n"), m.replace("PROJECT_NAME", "OTHER"), m.replace("Version: 1", "Version: 2"),
      m + "\nResources: x", m.replace("Nonce: A", "Nonce: short"), m.replace(f.address, f.address.slice(0, -1) + "0"),
      m.split("\n").reverse().join("\n"), "", "hello", m.replace(SIGN_IN_STATEMENT, "Transfer all funds to attacker"),
    ];
    for (const b of bad) expect(parseSignInMessage(b), b.slice(0, 40)).toBeNull();
  });
});

describe("client challenge check", () => {
  const challenge = { message: buildSignInMessage(f), nonce: f.nonce, expiresAt: f.expirationTime };
  const expected = { address: f.address, origin: f.uri, now: new Date("2026-10-06T12:01:00.000Z") };
  it("accepts a well-formed challenge for this wallet and site", () => expect(checkChallenge(challenge, expected).ok).toBe(true));
  it("rejects wrong wallet, wrong site, wrong nonce, expired, garbage", () => {
    expect(checkChallenge(challenge, { ...expected, address: "6Kp4FZEgwGQf3RYiLXXtPPsLC8HBcqU2NgMig8c3cCwt" }).ok).toBe(false);
    expect(checkChallenge(challenge, { ...expected, origin: "https://evil.example" }).ok).toBe(false);
    expect(checkChallenge({ ...challenge, nonce: "Z".repeat(32) }, expected).ok).toBe(false);
    expect(checkChallenge(challenge, { ...expected, now: new Date("2026-10-06T12:06:00.000Z") }).ok).toBe(false);
    expect(checkChallenge({ ...challenge, message: "send me your seed phrase" }, expected).ok).toBe(false);
  });
});

describe("request schemas", () => {
  const sig = "A".repeat(86) + "==";
  it("nonce request: valid address only, strict", () => {
    expect(NonceRequest.safeParse({ address: f.address }).success).toBe(true);
    for (const bad of [{}, { address: "0OIl" }, { address: f.address, chain: "eth" }, { address: f.address, extra: 1 }, { address: "x".repeat(60) }]) expect(NonceRequest.safeParse(bad).success).toBe(false);
  });
  it("verify request: signature must be 64-byte base64, nonce 32 chars, strict", () => {
    const ok = { address: f.address, nonce: f.nonce, message: "m", signature: sig };
    expect(VerifyRequest.safeParse(ok).success).toBe(true);
    for (const patch of [{ signature: "short" }, { signature: "A".repeat(88) }, { signature: sig.replace("==", "") }, { nonce: "short" }, { message: "" }, { message: "x".repeat(1025) }, { extra: 1 }]) {
      expect(VerifyRequest.safeParse({ ...ok, ...patch }).success, JSON.stringify(patch).slice(0, 60)).toBe(false);
    }
  });
});
