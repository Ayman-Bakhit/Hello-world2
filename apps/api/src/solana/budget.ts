import { SolanaRpcError, type SolanaRpc, type TokenMetadataSource } from "./types";

/** Counts every RPC call and refuses once the budget is spent, so no sync can loop or hammer a node. */
export class CountingRpc implements SolanaRpc, TokenMetadataSource {
  calls = 0;
  constructor(private readonly rpc: SolanaRpc, private readonly meta: TokenMetadataSource | null, private readonly max: number) {}
  get cluster() { return this.rpc.cluster; }
  private async tick<T>(f: () => Promise<T>): Promise<T> {
    if (this.calls >= this.max) throw new SolanaRpcError("budget", "RPC call budget for this sync is exhausted");
    this.calls++;
    return f();
  }
  getSlot() { return this.tick(() => this.rpc.getSlot()); }
  getBalance(a: string) { return this.tick(() => this.rpc.getBalance(a)); }
  getTokenAccountsByOwner(o: string) { return this.tick(() => this.rpc.getTokenAccountsByOwner(o)); }
  getSignaturesForAddress(a: string, o: { limit: number; before?: string; until?: string }) { return this.tick(() => this.rpc.getSignaturesForAddress(a, o)); }
  getTransaction(s: string) { return this.tick(() => this.rpc.getTransaction(s)); }
  getTokenMetadata(m: string) {
    if (!this.meta) throw new SolanaRpcError("not_configured", "no metadata source");
    return this.tick(() => this.meta!.getTokenMetadata(m));
  }
}
