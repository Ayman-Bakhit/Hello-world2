/**
 * MANUAL real-network smoke test. NOT part of `pnpm test` and never run in CI.
 * It performs a handful of READ-ONLY JSON-RPC calls against the node in SOLANA_RPC_URL for a public address you choose,
 * and prints what came back (never the URL). It sends nothing, signs nothing, and needs no private key.
 *
 *   SOLANA_RPC_URL=https://api.devnet.solana.com SMOKE_WALLET_ADDRESS=<public address> pnpm --filter @project-name/api smoke:rpc
 *
 * Use it to check, against a real node, the things the fake cannot prove: that real responses pass our validation,
 * and that the Metaplex metadata lookup works. Use devnet unless you know what you are doing.
 */
import { JsonRpcSolanaProvider } from "../src/solana/rpc";

const url = process.env.SOLANA_RPC_URL;
const address = process.env.SMOKE_WALLET_ADDRESS;
if (!url || !address) {
  console.error("Set SOLANA_RPC_URL and SMOKE_WALLET_ADDRESS (a PUBLIC address). See the header of this file.");
  process.exit(2);
}
const cluster = process.env.SOLANA_CLUSTER ?? "devnet";
const p = new JsonRpcSolanaProvider({ url, cluster, commitment: "finalized", timeoutMs: 15_000, maxRetries: 1 });

let failures = 0;
async function step<T>(name: string, f: () => Promise<T>, show: (r: T) => string): Promise<T | null> {
  try {
    const r = await f();
    console.log(`OK   ${name}: ${show(r)}`);
    return r;
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${(e as Error).name}: ${(e as Error).message}`);
    return null;
  }
}

console.log(`cluster=${cluster} address=${address} (read-only)`);
await step("getSlot", () => p.getSlot(), (s) => String(s));
await step("getBalance", () => p.getBalance(address), (b) => `${b.lamports} lamports at slot ${b.slot}`);
const tokens = await step("getTokenAccountsByOwner", () => p.getTokenAccountsByOwner(address), (t) => `${t.accounts.length} token account(s)`);
const sigs = await step("getSignaturesForAddress(limit 3)", () => p.getSignaturesForAddress(address, { limit: 3 }), (s) => `${s.length} signature(s)`);
if (sigs?.[0]) await step("getTransaction(newest)", () => p.getTransaction(sigs[0]!.signature), (t) => (t ? `slot ${t.normalized.slot}, ${t.normalized.programIds.length} program(s), payload ${t.payloadJson.length} bytes` : "null"));
const mint = tokens?.accounts[0]?.mint;
if (mint) await step("getTokenMetadata(first mint)", () => p.getTokenMetadata(mint), (m) => (m ? `name=${JSON.stringify(m.name)} symbol=${JSON.stringify(m.symbol)} (UNTRUSTED)` : "no metadata account"));
console.log(failures === 0 ? "\nSMOKE OK" : `\n${failures} step(s) failed`);
process.exit(failures === 0 ? 0 : 1);
