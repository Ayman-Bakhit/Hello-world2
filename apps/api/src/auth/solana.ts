import { getPublicKeyFromAddress, isAddress, isOffCurveAddress, type Address } from "@solana/addresses";
import { isSignatureBytes, verifySignature } from "@solana/keys";

/**
 * Thin wrappers over the official Solana Kit packages. No cryptography is implemented here:
 * address decoding and ed25519 verification are @solana/addresses and @solana/keys (WebCrypto).
 */

/** A valid, on-curve 32-byte Solana address (a PDA or random 32 bytes off the curve cannot sign). */
export function parseSignerAddress(input: string): Address | null {
  if (!isAddress(input)) return null;
  try {
    return isOffCurveAddress(input) ? null : input;
  } catch {
    return null;
  }
}

/** Never throws: any malformed key, signature, or mismatch is simply `false`. */
export async function verifyEd25519(address: string, message: string, signature: Uint8Array): Promise<boolean> {
  const addr = parseSignerAddress(address);
  if (!addr || !isSignatureBytes(signature)) return false;
  try {
    const key = await getPublicKeyFromAddress(addr);
    return await verifySignature(key, signature, new TextEncoder().encode(message));
  } catch {
    return false;
  }
}
