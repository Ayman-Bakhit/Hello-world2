import { sha256Hex } from "./hash";

// Solana address helpers (shape only: they never say an account exists or who controls it).
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A Solana public key: base58 that decodes to exactly 32 bytes. (Shape only: it does not say the account exists or who controls it.) */
export function isValidSolanaAddress(s: unknown): s is string {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  let n = 0n;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return false;
    n = n * 58n + BigInt(v);
  }
  const lead = s.length - s.replace(/^1+/, "").length;
  const bytes = (n === 0n ? 0 : Math.ceil(n.toString(16).length / 2)) + lead;
  return bytes === 32;
}

/** base58-encodes bytes (leading zero bytes become leading '1'). Used by fixtures to make well-formed 32-byte public keys. */
export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
  return out;
}
/** A deterministic, well-formed 32-byte base58 address for fixtures. FIXTURE ONLY: nobody holds a key for it. */
export function fixtureAddress(seed: string): string {
  const hex = sha256Hex(`fixture-address:${seed}`);
  return base58Encode(Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))));
}


/** Number of bytes a base58 string decodes to, or null when it is not base58. 32 = a public key; 64 = the shape of a secret key. */
export function base58ByteLength(s: string): number | null {
  if (s.length === 0) return null;
  let n = 0n;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const lead = s.length - s.replace(/^1+/, "").length;
  return (n === 0n ? 0 : Math.ceil(n.toString(16).length / 2)) + lead;
}
