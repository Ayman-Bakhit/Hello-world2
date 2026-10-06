import {
  ChainParseError, buildRpcTransaction, normalizeRpcTransaction, stringifyLossless,
  type OnchainTokenMetadata, type SignatureInfo, type TokenAccountObservation, type TxSpec,
} from "@project-name/shared";
import { SolanaRpcError, type FetchedTransaction, type SolanaRpc, type TokenMetadataSource } from "./types";

interface FakeWallet {
  lamports: bigint;
  tokens: TokenAccountObservation[];
}

/**
 * Deterministic in-memory Solana node for tests and the local browser run. It implements the same read-only interface
 * as the real provider, and its transactions are RPC-shaped JSON that goes through the REAL parser.
 * Test helpers (addWallet, addTx, fail, ...) are not part of the SolanaRpc interface.
 */
export class FakeSolanaRpc implements SolanaRpc, TokenMetadataSource {
  cluster = "devnet";
  slot = 1_000n;
  /** every call, in order: "method:arg" */
  readonly calls: string[] = [];
  private readonly wallets = new Map<string, FakeWallet>();
  private readonly sigs = new Map<string, SignatureInfo[]>(); // per address, newest first
  private readonly txs = new Map<string, unknown>(); // signature -> RPC result (or anything, to test malformed data)
  readonly metadata = new Map<string, OnchainTokenMetadata | null | "error">();
  /** when set, getBalance waits for it: lets a test hold a sync open */
  gate: Promise<void> | null = null;
  private failures: { method: string; error: SolanaRpcError; times: number }[] = [];

  addWallet(address: string, w: { lamports?: bigint; tokens?: TokenAccountObservation[] } = {}): this {
    this.wallets.set(address, { lamports: w.lamports ?? 0n, tokens: w.tokens ?? [] });
    return this;
  }
  setBalance(address: string, lamports: bigint): void {
    this.wallets.get(address)!.lamports = lamports;
  }
  setTokens(address: string, tokens: TokenAccountObservation[]): void {
    this.wallets.get(address)!.tokens = tokens;
  }
  /** Adds a transaction visible in the signature history of each listed address. */
  addTx(addresses: string[], spec: TxSpec): void {
    this.txs.set(spec.signature, buildRpcTransaction(spec));
    for (const a of addresses) {
      const list = (this.sigs.get(a) ?? []).filter((x) => x.signature !== spec.signature);
      list.push({ signature: spec.signature, slot: BigInt(spec.slot), failed: spec.err !== undefined && spec.err !== null, blockTime: spec.blockTime });
      list.sort((x, y) => (x.slot === y.slot ? 0 : x.slot < y.slot ? 1 : -1));
      this.sigs.set(a, list);
    }
  }
  /** The node still lists the signature but can no longer return the transaction. */
  removeTx(signature: string): void {
    this.txs.delete(signature);
  }
  /** Replace what getTransaction returns for a signature with arbitrary (possibly malformed) data. */
  overrideTx(signature: string, result: unknown): void {
    this.txs.set(signature, result);
  }
  /** Make the next `times` calls to `method` throw. */
  fail(method: string, error: SolanaRpcError, times = 1): void {
    this.failures.push({ method, error, times });
  }
  count(method: string): number {
    return this.calls.filter((c) => c.startsWith(`${method}:`)).length;
  }

  private enter(method: string, arg = ""): void {
    this.calls.push(`${method}:${arg}`);
    const f = this.failures.find((x) => x.method === method && x.times > 0);
    if (f) {
      f.times--;
      throw f.error;
    }
  }
  private wallet(address: string): FakeWallet {
    return this.wallets.get(address) ?? { lamports: 0n, tokens: [] };
  }

  async getSlot() { this.enter("getSlot"); return this.slot; }
  async getBalance(address: string) { this.enter("getBalance", address); if (this.gate) await this.gate; return { lamports: this.wallet(address).lamports, slot: this.slot }; }
  async getTokenAccountsByOwner(owner: string) { this.enter("getTokenAccountsByOwner", owner); return { accounts: [...this.wallet(owner).tokens], slot: this.slot }; }

  async getSignaturesForAddress(address: string, opts: { limit: number; before?: string; until?: string }): Promise<SignatureInfo[]> {
    this.enter("getSignaturesForAddress", address);
    let list = [...(this.sigs.get(address) ?? [])];
    if (opts.before) { const i = list.findIndex((s) => s.signature === opts.before); if (i >= 0) list = list.slice(i + 1); }
    if (opts.until) { const i = list.findIndex((s) => s.signature === opts.until); if (i >= 0) list = list.slice(0, i); }
    return list.slice(0, opts.limit);
  }

  async getTransaction(signature: string): Promise<FetchedTransaction | null> {
    this.enter("getTransaction", signature);
    if (!this.txs.has(signature)) return null;
    const result = this.txs.get(signature);
    try {
      return { normalized: normalizeRpcTransaction(result), payloadJson: stringifyLossless(result) };
    } catch (e) {
      if (e instanceof ChainParseError) throw new SolanaRpcError("malformed", e.message);
      throw e;
    }
  }

  async getTokenMetadata(mint: string): Promise<OnchainTokenMetadata | null> {
    this.enter("getTokenMetadata", mint);
    const m = this.metadata.get(mint);
    if (m === "error") throw new SolanaRpcError("network", "Could not reach the RPC node", true);
    return m ?? null;
  }
}
