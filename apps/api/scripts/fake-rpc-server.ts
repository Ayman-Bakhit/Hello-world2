/**
 * LOCAL TEST SERVER. A deterministic fake Solana JSON-RPC node for browser tests and manual runs.
 * It is NOT a blockchain, serves invented data for ANY address, and must never be used with production config.
 *
 *   pnpm --filter @project-name/api fake:rpc          # listens on 127.0.0.1:8899 (FAKE_RPC_PORT to change)
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 SOLANA_CLUSTER=devnet pnpm dev:api
 *
 * Any wallet gets: 3.5 SOL, one SPL token account (a fixed fake mint with hostile-looking metadata, to exercise the
 * untrusted-metadata UI), and 3 transactions (SOL received, token received, a failed one).
 * POST /__control/new-tx?address=ADDR adds one more incoming SOL transfer, so a refresh has something new to index.
 * GET  /__control/stats shows how many RPC calls were served per method (used to prove a repeat sync is cheap).
 */
import { createServer } from "node:http";
import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/addresses";
import {
  SYSTEM_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, buildRpcTransaction, buildTokenAccountEntry, fakeBase58, fakeSignature,
  fakeTokenAccount, stringifyLossless, type TxSpec,
} from "@project-name/shared";
import { METAPLEX_METADATA_PROGRAM } from "../src/solana/rpc";

const PORT = Number(process.env.FAKE_RPC_PORT ?? 8899);
const SOL = 1_000_000_000n;
// A syntactically valid 32-byte address (the provider validates addresses before any request). It is not a real mint.
const MINT = getAddressDecoder().decode(new Uint8Array(32).fill(7));
const SLOT = 5_000n;

const specs = new Map<string, TxSpec>(); // signature -> spec
const histories = new Map<string, TxSpec[]>(); // address -> specs (oldest first)
const stats: Record<string, number> = {};

function history(address: string): TxSpec[] {
  const existing = histories.get(address);
  if (existing) return existing;
  const payer = fakeBase58("payer", 44);
  const sig = (n: number) => fakeSignature(`${address}:${n}`);
  const list: TxSpec[] = [
    { signature: sig(1), slot: 1001, blockTime: 1_760_000_000, fee: 5000, accounts: [{ key: payer, pre: 9n * SOL, post: 8n * SOL - 5000n }, { key: address, pre: 0, post: SOL }], programs: [SYSTEM_PROGRAM] },
    {
      signature: sig(2), slot: 1002, blockTime: 1_760_000_100, fee: 5000,
      accounts: [{ key: payer, pre: 8n * SOL, post: 8n * SOL - 5000n }, { key: fakeTokenAccount(`${address}:tok`), pre: 0, post: 0 }],
      tokens: [{ index: 1, mint: MINT, owner: address, pre: 0n, post: 1_500_000n, decimals: 6 }], programs: [TOKEN_PROGRAM],
    },
    { signature: sig(3), slot: 1003, blockTime: 1_760_000_200, fee: 5000, err: { InstructionError: [0, "Custom"] }, accounts: [{ key: address, pre: SOL, post: SOL - 5000n }], programs: [SYSTEM_PROGRAM] },
  ];
  for (const s of list) specs.set(s.signature, s);
  histories.set(address, list);
  return list;
}

/** Metaplex "Metadata" account bytes (Key=4, update authority, mint, name, symbol, uri). Deliberately markup-looking text. */
function metadataBytes(): Buffer {
  const enc = new TextEncoder();
  const str = (s: string) => { const b = Buffer.from(enc.encode(s)); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  return Buffer.concat([Buffer.from([4]), Buffer.alloc(32, 1), Buffer.alloc(32, 2), str("<b>E2E Coin</b>"), str("E2E"), str("https://example.invalid/e2e.json")]);
}
let metadataPda: string | null = null;
async function pda(): Promise<string> {
  if (metadataPda) return metadataPda;
  const e = getAddressEncoder();
  const [a] = await getProgramDerivedAddress({ programAddress: METAPLEX_METADATA_PROGRAM as Address, seeds: [new TextEncoder().encode("metadata"), e.encode(METAPLEX_METADATA_PROGRAM as Address), e.encode(MINT as Address)] });
  return (metadataPda = a);
}

async function handle(method: string, p: unknown[]): Promise<unknown> {
  stats[method] = (stats[method] ?? 0) + 1;
  const ctx = { slot: Number(SLOT) };
  switch (method) {
    case "getSlot": return Number(SLOT);
    case "getBalance": return { context: ctx, value: 35n * SOL / 10n + BigInt(history(String(p[0])).length - 3) * SOL / 10n };
    case "getTokenAccountsByOwner": {
      const owner = String(p[0]);
      const program = (p[1] as { programId: string }).programId;
      return { context: ctx, value: program === TOKEN_PROGRAM ? [buildTokenAccountEntry({ tokenAccount: fakeTokenAccount(`${owner}:tok`), mint: MINT, owner, amount: 1_500_000n, decimals: 6 })] : program === TOKEN_2022_PROGRAM ? [] : [] };
    }
    case "getSignaturesForAddress": {
      const cfg = (p[1] ?? {}) as { limit?: number; before?: string; until?: string };
      let list = [...history(String(p[0]))].reverse(); // newest first
      if (cfg.before) { const i = list.findIndex((s) => s.signature === cfg.before); if (i >= 0) list = list.slice(i + 1); }
      if (cfg.until) { const i = list.findIndex((s) => s.signature === cfg.until); if (i >= 0) list = list.slice(0, i); }
      return list.slice(0, cfg.limit ?? 1000).map((s) => ({ signature: s.signature, slot: s.slot, err: s.err ?? null, memo: null, blockTime: s.blockTime, confirmationStatus: "finalized" }));
    }
    case "getTransaction": { const s = specs.get(String(p[0])); return s ? buildRpcTransaction(s) : null; }
    case "getAccountInfo": {
      if (String(p[0]) !== (await pda())) return { context: ctx, value: null };
      return { context: ctx, value: { lamports: 5616720, owner: METAPLEX_METADATA_PROGRAM, executable: false, rentEpoch: 0, space: 100, data: [metadataBytes().toString("base64"), "base64"] } };
    }
    default: throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
  }
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/__control/stats") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(stats)); return; }
  if (url.pathname === "/__control/new-tx" && req.method === "POST") {
    const address = url.searchParams.get("address") ?? "";
    const list = history(address);
    const n = list.length + 1;
    const spec: TxSpec = { signature: fakeSignature(`${address}:${n}`), slot: 1000 + n, blockTime: 1_760_000_000 + n * 100, fee: 5000, accounts: [{ key: fakeBase58("payer", 44), pre: 9n * SOL, post: 9n * SOL - 100_000_000n - 5000n }, { key: address, pre: 0, post: 100_000_000n }], programs: [SYSTEM_PROGRAM] };
    specs.set(spec.signature, spec);
    list.push(spec);
    res.end(JSON.stringify({ ok: true, signature: spec.signature }));
    return;
  }
  let body = "";
  req.on("data", (c: Buffer) => { body += c; if (body.length > 1_000_000) req.destroy(); });
  req.on("end", async () => {
    let id: unknown = null;
    try {
      const j = JSON.parse(body) as { id: unknown; method: string; params?: unknown[] };
      id = j.id;
      const result = await handle(j.method, j.params ?? []);
      res.setHeader("content-type", "application/json");
      res.end(stringifyLossless({ jsonrpc: "2.0", id, result }));
    } catch (e) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: (e as { code?: number }).code ?? -32000, message: (e as Error).message } }));
    }
  });
}).listen(PORT, "127.0.0.1", () => console.log(`fake Solana RPC (TEST ONLY) on http://127.0.0.1:${PORT}`));
