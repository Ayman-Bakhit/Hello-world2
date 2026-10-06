import type {
  NormalizedTransaction, OnchainTokenMetadata, SignatureInfo, TokenAccountObservation,
} from "@project-name/shared";

/** A transaction as fetched: the validated form plus the ORIGINAL RPC JSON (stored untouched as the raw record). */
export interface FetchedTransaction {
  normalized: NormalizedTransaction;
  payloadJson: string;
}

/**
 * Read-only Solana access. Replaceable: production uses JsonRpcSolanaProvider (SOLANA_RPC_URL); tests use
 * FakeSolanaRpc. Nothing in this interface can send a transaction or request a signature.
 */
export interface SolanaRpc {
  readonly cluster: string;
  getSlot(): Promise<bigint>;
  getBalance(address: string): Promise<{ lamports: bigint; slot: bigint }>;
  /** All SPL Token and Token-2022 accounts owned by the wallet (zero balances included). */
  getTokenAccountsByOwner(owner: string): Promise<{ accounts: TokenAccountObservation[]; slot: bigint }>;
  /** Newest first. `before` pages backwards; `until` stops at (excludes) a known signature. */
  getSignaturesForAddress(address: string, opts: { limit: number; before?: string; until?: string }): Promise<SignatureInfo[]>;
  getTransaction(signature: string): Promise<FetchedTransaction | null>;
}

/** Token metadata is a separate, replaceable concern, and its output is untrusted. */
export interface TokenMetadataSource {
  /** null = the token has no metadata account (a definitive answer). Throws on transport/format failure. */
  getTokenMetadata(mint: string): Promise<OnchainTokenMetadata | null>;
}

export type RpcErrorKind = "timeout" | "network" | "http" | "rpc" | "malformed" | "budget" | "not_configured";

/** Sanitized: messages never contain the RPC URL, API keys, or response bodies. */
export class SolanaRpcError extends Error {
  constructor(public readonly kind: RpcErrorKind, message: string, public readonly retryable = false) {
    super(message);
    this.name = "SolanaRpcError";
  }
}

export function rpcErrorCode(e: unknown): { code: string; message: string } {
  if (e instanceof SolanaRpcError) {
    const code = { timeout: "RPC_TIMEOUT", network: "RPC_UNAVAILABLE", http: "RPC_UNAVAILABLE", rpc: "RPC_ERROR", malformed: "RPC_MALFORMED", budget: "RPC_BUDGET_EXCEEDED", not_configured: "RPC_NOT_CONFIGURED" }[e.kind];
    return { code, message: e.message };
  }
  return { code: "INTERNAL_ERROR", message: "Unexpected indexing error" };
}
