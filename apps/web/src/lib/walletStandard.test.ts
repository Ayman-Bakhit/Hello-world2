import { describe, expect, it } from "vitest";
import type { Wallet } from "@wallet-standard/base";
import { canonicalIdFor, connectWallet, describeAuthError, detectSolanaWallets, isSolanaSigner, signMessageWithWallet, toBase64 } from "./walletStandard";

const acct = (address: string, features: string[] = ["solana:signMessage"]) => ({ address, publicKey: new Uint8Array(32), chains: ["solana:devnet"], features }) as never;

function fakeWallet(over: { name?: string; features?: Record<string, unknown>; chains?: string[] } = {}): Wallet {
  return { version: "1.0.0", name: over.name ?? "Phantom", icon: "data:image/svg+xml;base64,AAAA", chains: over.chains ?? ["solana:mainnet"], accounts: [], features: over.features ?? { "standard:connect": {}, "solana:signMessage": {} } } as never;
}

describe("detection", () => {
  it("only wallets that can connect AND sign messages on solana qualify", () => {
    expect(isSolanaSigner(fakeWallet())).toBe(true);
    expect(isSolanaSigner(fakeWallet({ features: { "standard:connect": {} } }))).toBe(false);
    expect(isSolanaSigner(fakeWallet({ features: { "solana:signMessage": {} } }))).toBe(false);
    expect(isSolanaSigner(fakeWallet({ chains: ["ethereum:1"] }))).toBe(false);
  });
  it("maps Phantom / Solflare / Backpack and leaves others as generic", () => {
    expect(canonicalIdFor("Phantom")).toBe("phantom");
    expect(canonicalIdFor("Solflare")).toBe("solflare");
    expect(canonicalIdFor("Backpack")).toBe("backpack");
    expect(canonicalIdFor("Some Other Wallet")).toBeNull();
    const d = detectSolanaWallets([fakeWallet({ name: "Backpack" }), fakeWallet({ name: "Weird", features: {} }), fakeWallet({ name: "Other" })]);
    expect(d.map((x) => [x.name, x.canonicalId])).toEqual([["Backpack", "backpack"], ["Other", null]]);
  });
});

describe("connectWallet", () => {
  it("picks the account that supports signMessage", async () => {
    const w = fakeWallet({ features: { "standard:connect": { connect: async () => ({ accounts: [acct("X", []), acct("Y")] }) }, "solana:signMessage": {} } });
    expect((await connectWallet(w)).address).toBe("Y");
  });
  it("fails clearly when the wallet returns no account", async () => {
    const w = fakeWallet({ features: { "standard:connect": { connect: async () => ({ accounts: [] }) }, "solana:signMessage": {} } });
    await expect(connectWallet(w)).rejects.toThrow(/did not return an account/);
  });
});

describe("signMessageWithWallet", () => {
  const sig = new Uint8Array(64).fill(7);
  const walletSigning = (impl: (m: Uint8Array) => { signedMessage: Uint8Array; signature: Uint8Array }[]) =>
    fakeWallet({ features: { "standard:connect": {}, "solana:signMessage": { signMessage: async (i: { message: Uint8Array }) => impl(i.message) } } });

  it("returns the signature when the wallet signed exactly the requested bytes", async () => {
    const w = walletSigning((m) => [{ signedMessage: m, signature: sig }]);
    expect(await signMessageWithWallet(w, acct("A"), "hello")).toEqual(sig);
  });
  it("refuses if the wallet signed different bytes", async () => {
    const w = walletSigning(() => [{ signedMessage: new TextEncoder().encode("evil"), signature: sig }]);
    await expect(signMessageWithWallet(w, acct("A"), "hello")).rejects.toThrow(/different bytes/);
  });
  it("refuses malformed signatures and empty responses", async () => {
    await expect(signMessageWithWallet(walletSigning((m) => [{ signedMessage: m, signature: new Uint8Array(10) }]), acct("A"), "hi")).rejects.toThrow(/malformed/);
    await expect(signMessageWithWallet(walletSigning(() => []), acct("A"), "hi")).rejects.toThrow(/no signature/);
  });
});

describe("helpers", () => {
  it("base64 encodes bytes", () => {
    expect(toBase64(new Uint8Array([0, 255, 16]))).toBe(btoa("\x00\xff\x10"));
    expect(toBase64(new Uint8Array(64)).length).toBe(88);
  });
  it("turns errors into safe user messages", () => {
    expect(describeAuthError({ code: 4001 })).toMatch(/declined/);
    expect(describeAuthError(new Error("User rejected the request"))).toMatch(/declined/);
    expect(describeAuthError({ name: "ApiClientError", status: 0, code: "NETWORK_ERROR", message: "x" })).toMatch(/Could not reach/);
    expect(describeAuthError({ name: "ApiClientError", status: 401, message: "x" })).toMatch(/Sign-in failed/);
    expect(describeAuthError({ name: "ApiClientError", status: 403, message: "x" })).toMatch(/origin/);
    expect(describeAuthError(new Error("kaboom with secret details"))).not.toMatch(/secret/);
  });
});
