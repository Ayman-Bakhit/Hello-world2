import { z } from "zod";

/**
 * Normalized, validated shapes of Solana RPC data. Raw RPC JSON is UNTRUSTED: everything crosses this
 * boundary through the Zod schemas in ./parse before the rest of the system sees it.
 */

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const MEMO_PROGRAMS = ["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"] as const;
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const TOKEN_PROGRAMS = [TOKEN_PROGRAM, TOKEN_2022_PROGRAM] as const;

/**
 * Programs recognized as DEXes / aggregators, used ONLY as evidence for the "swap" classification.
 * This is a short, hand-maintained heuristic list that has NOT been verified against a live network in this
 * repository's test environment. A swap through an unlisted program is classified "unknown", never guessed.
 */
export const KNOWN_DEX_PROGRAMS: Readonly<Record<string, string>> = {
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter v6",
  JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB: "Jupiter v4",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM v4",
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "Raydium CLMM",
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca Whirlpools",
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: "Meteora DLMM",
};

export interface NormalizedTokenBalance {
  accountIndex: number;
  mint: string;
  /** null when the RPC did not report an owner (older transactions): such entries cannot be attributed to a wallet */
  owner: string | null;
  amount: bigint;
  decimals: number;
}

export interface NormalizedTransaction {
  signature: string;
  slot: bigint;
  /** unix seconds, or null when the node does not know the block time */
  blockTime: number | null;
  failed: boolean;
  fee: bigint;
  accountKeys: string[];
  preBalances: bigint[];
  postBalances: bigint[];
  preTokenBalances: NormalizedTokenBalance[];
  postTokenBalances: NormalizedTokenBalance[];
  /** outer + inner instruction program ids, de-duplicated, in first-seen order */
  programIds: string[];
}

export interface SignatureInfo {
  signature: string;
  slot: bigint;
  failed: boolean;
  blockTime: number | null;
}

export interface TokenAccountObservation {
  tokenAccount: string;
  mint: string;
  owner: string;
  /** raw base units */
  amount: bigint;
  decimals: number;
  programId: string;
}

export interface OnchainTokenMetadata {
  name: string | null;
  symbol: string | null;
  uri: string | null;
  source: "metaplex_onchain";
}

export class ChainParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainParseError";
  }
}

export const BASE58_PUBKEY = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
/** Transaction signatures are 64 bytes: 86 to 88 base58 characters. */
export const BASE58_SIGNATURE = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
