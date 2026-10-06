import { getProgramDerivedAddress, getAddressEncoder, isAddress, type Address } from "@solana/addresses";
import {
  ChainParseError, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, normalizeBalance, normalizeRpcTransaction, normalizeSignatures, normalizeSlot,
  normalizeTokenAccounts, parseJsonLossless, parseMetaplexMetadata, stringifyLossless,
  type OnchainTokenMetadata, type SignatureInfo, type TokenAccountObservation, BASE58_SIGNATURE,
} from "@project-name/shared";
import { z } from "zod";
import { SolanaRpcError, type FetchedTransaction, type SolanaRpc, type TokenMetadataSource } from "./types";

export const METAPLEX_METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 1024 * 1024;

export interface ProviderOptions {
  url: string;
  cluster: string;
  commitment: "finalized" | "confirmed";
  timeoutMs: number;
  /** extra attempts for timeouts / 429 / 5xx */
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

const Envelope = z.object({ id: z.unknown(), result: z.unknown().optional(), error: z.object({ code: z.number().optional(), message: z.string().optional() }).passthrough().optional() }).passthrough();
const AccountInfo = z.object({
  context: z.object({ slot: z.union([z.number(), z.bigint()]) }).passthrough(),
  value: z.union([z.null(), z.object({ data: z.tuple([z.string(), z.literal("base64")]), owner: z.string() }).passthrough()]),
}).passthrough();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * JSON-RPC 2.0 over fetch. Server-side only. Every response is size-capped, parsed losslessly, checked against an
 * envelope, and then validated by the shared normalizers; malformed data throws SolanaRpcError("malformed").
 * Errors never include the URL (it may carry an API key).
 */
export class JsonRpcSolanaProvider implements SolanaRpc, TokenMetadataSource {
  readonly cluster: string;
  private nextId = 1;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly o: ProviderOptions) {
    this.cluster = o.cluster;
    this.fetchImpl = o.fetchImpl ?? ((...a) => fetch(...a));
  }

  private async callOnce(method: string, params: unknown[]): Promise<unknown> {
    const id = this.nextId++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.o.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: ctl.signal, redirect: "error" });
      if (res.status === 429 || res.status >= 500) throw new SolanaRpcError("http", `RPC node responded with HTTP ${res.status}`, true);
      if (!res.ok) throw new SolanaRpcError("http", `RPC node responded with HTTP ${res.status}`);
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_RESPONSE_BYTES) throw new SolanaRpcError("malformed", "RPC response too large");
      const text = await res.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new SolanaRpcError("malformed", "RPC response too large");
      let json: unknown;
      try { json = parseJsonLossless(text); } catch { throw new SolanaRpcError("malformed", "RPC response is not valid JSON"); }
      const env = Envelope.safeParse(json);
      if (!env.success || env.data.id !== id) throw new SolanaRpcError("malformed", "RPC response envelope is invalid");
      if (env.data.error) {
        const m = (env.data.error.message ?? "").replace(/https?:\/\/\S+/g, "[url]").slice(0, 160);
        throw new SolanaRpcError("rpc", `RPC error${env.data.error.code !== undefined ? ` ${env.data.error.code}` : ""}: ${m}`, env.data.error.code === -32005);
      }
      if (!("result" in env.data)) throw new SolanaRpcError("malformed", "RPC response has no result");
      return env.data.result;
    } catch (e) {
      if (e instanceof SolanaRpcError) throw e;
      if ((e as { name?: string }).name === "AbortError") throw new SolanaRpcError("timeout", "RPC request timed out", true);
      throw new SolanaRpcError("network", "Could not reach the RPC node", true);
    } finally {
      clearTimeout(timer);
    }
  }

  private async call(method: string, params: unknown[]): Promise<unknown> {
    const attempts = (this.o.maxRetries ?? 1) + 1;
    for (let i = 1; ; i++) {
      try {
        return await this.callOnce(method, params);
      } catch (e) {
        if (!(e instanceof SolanaRpcError) || !e.retryable || i >= attempts) throw e;
        await sleep(200 * i);
      }
    }
  }

  private guard<T>(f: () => T): T {
    try { return f(); } catch (e) {
      if (e instanceof ChainParseError) throw new SolanaRpcError("malformed", e.message);
      throw e;
    }
  }

  private static address(a: string): string {
    if (!isAddress(a)) throw new SolanaRpcError("malformed", "invalid address");
    return a;
  }

  async getSlot(): Promise<bigint> {
    const r = await this.call("getSlot", [{ commitment: this.o.commitment }]);
    return this.guard(() => normalizeSlot(r));
  }

  async getBalance(address: string): Promise<{ lamports: bigint; slot: bigint }> {
    const a = JsonRpcSolanaProvider.address(address);
    const r = await this.call("getBalance", [a, { commitment: this.o.commitment }]);
    return this.guard(() => normalizeBalance(r));
  }

  async getTokenAccountsByOwner(owner: string): Promise<{ accounts: TokenAccountObservation[]; slot: bigint }> {
    const o = JsonRpcSolanaProvider.address(owner);
    const accounts: TokenAccountObservation[] = [];
    let slot = 0n;
    for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
      const r = await this.call("getTokenAccountsByOwner", [o, { programId }, { encoding: "jsonParsed", commitment: this.o.commitment }]);
      const part = this.guard(() => normalizeTokenAccounts(r, programId));
      accounts.push(...part.accounts);
      if (part.slot > slot) slot = part.slot;
    }
    return { accounts, slot };
  }

  async getSignaturesForAddress(address: string, opts: { limit: number; before?: string; until?: string }): Promise<SignatureInfo[]> {
    const a = JsonRpcSolanaProvider.address(address);
    if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 1000) throw new SolanaRpcError("malformed", "invalid signature limit");
    for (const s of [opts.before, opts.until]) if (s !== undefined && !BASE58_SIGNATURE.safeParse(s).success) throw new SolanaRpcError("malformed", "invalid signature cursor");
    const cfg: Record<string, unknown> = { limit: opts.limit, commitment: this.o.commitment };
    if (opts.before) cfg.before = opts.before;
    if (opts.until) cfg.until = opts.until;
    const r = await this.call("getSignaturesForAddress", [a, cfg]);
    const list = this.guard(() => normalizeSignatures(r));
    if (list.length > opts.limit) throw new SolanaRpcError("malformed", "RPC returned more signatures than requested");
    return list;
  }

  async getTransaction(signature: string): Promise<FetchedTransaction | null> {
    if (!BASE58_SIGNATURE.safeParse(signature).success) throw new SolanaRpcError("malformed", "invalid signature");
    const r = await this.call("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: this.o.commitment }]);
    if (r === null) return null;
    const normalized = this.guard(() => normalizeRpcTransaction(r));
    if (normalized.signature !== signature) throw new SolanaRpcError("malformed", "RPC returned a different transaction than requested");
    const payloadJson = stringifyLossless(r);
    if (payloadJson.length > MAX_PAYLOAD_BYTES) throw new SolanaRpcError("malformed", "transaction payload too large");
    return { normalized, payloadJson };
  }

  async getTokenMetadata(mint: string): Promise<OnchainTokenMetadata | null> {
    const m = JsonRpcSolanaProvider.address(mint);
    const enc = getAddressEncoder();
    const [pda] = await getProgramDerivedAddress({
      programAddress: METAPLEX_METADATA_PROGRAM as Address,
      seeds: [new TextEncoder().encode("metadata"), enc.encode(METAPLEX_METADATA_PROGRAM as Address), enc.encode(m as Address)],
    });
    const r = await this.call("getAccountInfo", [pda, { encoding: "base64", commitment: this.o.commitment }]);
    const info = this.guard(() => { const p = AccountInfo.safeParse(r); if (!p.success) throw new ChainParseError("malformed account info"); return p.data; });
    if (info.value === null) return null;
    if (info.value.owner !== METAPLEX_METADATA_PROGRAM) return null;
    const bytes = Buffer.from(info.value.data[0], "base64");
    if (bytes.length > 2048) return null;
    return this.guard(() => parseMetaplexMetadata(new Uint8Array(bytes)));
  }
}
