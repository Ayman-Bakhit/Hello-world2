import { stringifyLossless } from "./units";
import { SYSTEM_PROGRAM, TOKEN_PROGRAM } from "./types";

/**
 * Builders for RPC-shaped (jsonParsed) responses. TEST/FIXTURE USE ONLY: they let the test suite and the manual
 * browser run exercise the real parsing and indexing code with deterministic data. Never imported by app code.
 */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Deterministic base58-looking string of `len` characters derived from `seed`. */
export function fakeBase58(seed: string, len: number): string {
  let h = 2166136261;
  let out = "";
  for (let i = 0; out.length < len; i++) {
    h = Math.imul(h ^ (seed.charCodeAt(i % seed.length) + i), 16777619) >>> 0;
    out += B58[h % 58];
  }
  return out;
}
export const fakeSignature = (seed: string) => fakeBase58(`sig:${seed}`, 88);
export const fakeMint = (seed: string) => fakeBase58(`mint:${seed}`, 44);
export const fakeTokenAccount = (seed: string) => fakeBase58(`ata:${seed}`, 44);
export const fakeProgram = (seed: string) => fakeBase58(`prog:${seed}`, 44);

export interface AccountSpec { key: string; pre: bigint | number; post: bigint | number }
export interface TokenSpec { index: number; mint: string; owner: string | null; pre: bigint; post: bigint; decimals: number }
export interface TxSpec {
  signature: string;
  slot: number;
  blockTime: number | null;
  fee?: number;
  err?: unknown;
  accounts: AccountSpec[];
  tokens?: TokenSpec[];
  programs?: string[];
  innerPrograms?: string[];
}

const ui = (amount: bigint, decimals: number) => ({ amount: amount.toString(), decimals, uiAmount: Number(amount) / 10 ** decimals, uiAmountString: (Number(amount) / 10 ** decimals).toString() });

/** A getTransaction(encoding: jsonParsed) result object. */
export function buildRpcTransaction(s: TxSpec): Record<string, unknown> {
  const tok = (v: "pre" | "post") =>
    (s.tokens ?? []).map((t) => ({ accountIndex: t.index, mint: t.mint, ...(t.owner ? { owner: t.owner } : {}), programId: TOKEN_PROGRAM, uiTokenAmount: ui(v === "pre" ? t.pre : t.post, t.decimals) }));
  return {
    slot: s.slot,
    blockTime: s.blockTime,
    version: "legacy",
    transaction: {
      signatures: [s.signature],
      message: {
        accountKeys: s.accounts.map((a, i) => ({ pubkey: a.key, signer: i === 0, writable: true, source: "transaction" })),
        instructions: (s.programs ?? [SYSTEM_PROGRAM]).map((p) => ({ programId: p, accounts: [], data: "" })),
        recentBlockhash: fakeBase58("bh", 44),
      },
    },
    meta: {
      err: s.err ?? null,
      fee: s.fee ?? 5000,
      preBalances: s.accounts.map((a) => BigInt(a.pre)),
      postBalances: s.accounts.map((a) => BigInt(a.post)),
      preTokenBalances: tok("pre"),
      postTokenBalances: tok("post"),
      innerInstructions: s.innerPrograms ? [{ index: 0, instructions: s.innerPrograms.map((p) => ({ programId: p })) }] : [],
      logMessages: [],
    },
  };
}

/** Same object serialized the way the RPC would send it (BigInt written as exact integers). */
export const rpcTransactionJson = (s: TxSpec): string => stringifyLossless(buildRpcTransaction(s));

export function buildTokenAccountEntry(a: { tokenAccount: string; mint: string; owner: string; amount: bigint; decimals: number; program?: "spl-token" | "spl-token-2022" }) {
  return {
    pubkey: a.tokenAccount,
    account: {
      lamports: 2039280, owner: TOKEN_PROGRAM, executable: false, rentEpoch: 0, space: 165,
      data: { program: a.program ?? "spl-token", space: 165, parsed: { type: "account", info: { mint: a.mint, owner: a.owner, state: "initialized", isNative: false, tokenAmount: ui(a.amount, a.decimals) } } },
    },
  };
}
