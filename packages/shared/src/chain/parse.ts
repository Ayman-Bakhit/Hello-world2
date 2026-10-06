import { z } from "zod";
import {
  BASE58_PUBKEY, BASE58_SIGNATURE, ChainParseError,
  type NormalizedTokenBalance, type NormalizedTransaction, type OnchainTokenMetadata, type SignatureInfo, type TokenAccountObservation,
} from "./types";

/** Integers from RPC arrive as number, or as bigint when beyond 2^53 (see parseJsonLossless). */
const IntLike = z.union([z.number().int().nonnegative(), z.bigint().nonnegative()]).transform((v) => BigInt(v));
const DigitString = z.string().regex(/^\d{1,40}$/).transform((v) => BigInt(v));

const Instruction = z.object({ programId: z.string().optional() }).passthrough();
const TokenBalance = z
  .object({
    accountIndex: z.number().int().nonnegative(),
    mint: BASE58_PUBKEY,
    owner: BASE58_PUBKEY.nullish(),
    uiTokenAmount: z.object({ amount: DigitString, decimals: z.number().int().min(0).max(38) }).passthrough(),
  })
  .passthrough();

const RawTransactionSchema = z
  .object({
    slot: IntLike,
    blockTime: z.number().int().nonnegative().nullish(),
    transaction: z
      .object({
        signatures: z.array(BASE58_SIGNATURE).min(1),
        message: z
          .object({
            accountKeys: z.array(z.union([BASE58_PUBKEY, z.object({ pubkey: BASE58_PUBKEY }).passthrough()])).min(1),
            instructions: z.array(Instruction).default([]),
          })
          .passthrough(),
      })
      .passthrough(),
    meta: z
      .object({
        err: z.unknown().nullish(),
        fee: IntLike,
        preBalances: z.array(IntLike),
        postBalances: z.array(IntLike),
        preTokenBalances: z.array(TokenBalance).nullish(),
        postTokenBalances: z.array(TokenBalance).nullish(),
        innerInstructions: z.array(z.object({ instructions: z.array(Instruction).default([]) }).passthrough()).nullish(),
        loadedAddresses: z.object({ writable: z.array(BASE58_PUBKEY).default([]), readonly: z.array(BASE58_PUBKEY).default([]) }).partial().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

const toBalances = (xs: z.infer<typeof TokenBalance>[] | null | undefined): NormalizedTokenBalance[] =>
  (xs ?? []).map((b) => ({ accountIndex: b.accountIndex, mint: b.mint, owner: b.owner ?? null, amount: b.uiTokenAmount.amount, decimals: b.uiTokenAmount.decimals }));

/**
 * getTransaction (jsonParsed) result -> NormalizedTransaction. Throws ChainParseError on anything malformed:
 * wrong types, missing fields, inconsistent balance arrays. Never returns partially-trusted data.
 */
export function normalizeRpcTransaction(result: unknown): NormalizedTransaction {
  const r = RawTransactionSchema.safeParse(result);
  if (!r.success) throw new ChainParseError(`malformed transaction: ${r.error.issues[0]?.path.join(".") ?? "?"}`);
  const t = r.data;
  const keys = t.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const loaded = t.meta.loadedAddresses;
  // Versioned transactions: balance arrays are indexed over static keys + loaded writable + loaded readonly.
  if (keys.length < t.meta.preBalances.length && loaded) keys.push(...(loaded.writable ?? []), ...(loaded.readonly ?? []));
  if (t.meta.preBalances.length !== keys.length || t.meta.postBalances.length !== keys.length) {
    throw new ChainParseError("malformed transaction: balance arrays do not match account keys");
  }
  const programs: string[] = [];
  const add = (ix: { programId?: string | undefined }) => { if (ix.programId && !programs.includes(ix.programId)) programs.push(ix.programId); };
  t.transaction.message.instructions.forEach(add);
  (t.meta.innerInstructions ?? []).forEach((g) => g.instructions.forEach(add));
  const pre = toBalances(t.meta.preTokenBalances);
  const post = toBalances(t.meta.postTokenBalances);
  for (const b of [...pre, ...post]) if (b.accountIndex >= keys.length) throw new ChainParseError("malformed transaction: token balance index out of range");
  return {
    signature: t.transaction.signatures[0]!,
    slot: t.slot,
    blockTime: t.blockTime ?? null,
    failed: t.meta.err !== null && t.meta.err !== undefined,
    fee: t.meta.fee,
    accountKeys: keys,
    preBalances: t.meta.preBalances,
    postBalances: t.meta.postBalances,
    preTokenBalances: pre,
    postTokenBalances: post,
    programIds: programs,
  };
}

const SignatureEntry = z
  .object({ signature: BASE58_SIGNATURE, slot: IntLike, err: z.unknown().nullish(), blockTime: z.number().int().nonnegative().nullish() })
  .passthrough();

export function normalizeSignatures(result: unknown): SignatureInfo[] {
  const r = z.array(SignatureEntry).safeParse(result);
  if (!r.success) throw new ChainParseError("malformed signature list");
  return r.data.map((s) => ({ signature: s.signature, slot: s.slot, failed: s.err !== null && s.err !== undefined, blockTime: s.blockTime ?? null }));
}

export function normalizeBalance(result: unknown): { lamports: bigint; slot: bigint } {
  const r = z.object({ context: z.object({ slot: IntLike }).passthrough(), value: IntLike }).passthrough().safeParse(result);
  if (!r.success) throw new ChainParseError("malformed balance response");
  return { lamports: r.data.value, slot: r.data.context.slot };
}

export function normalizeSlot(result: unknown): bigint {
  const r = IntLike.safeParse(result);
  if (!r.success) throw new ChainParseError("malformed slot response");
  return r.data;
}

const TokenAccountEntry = z
  .object({
    pubkey: BASE58_PUBKEY,
    account: z
      .object({
        data: z
          .object({
            parsed: z
              .object({
                info: z
                  .object({
                    mint: BASE58_PUBKEY,
                    owner: BASE58_PUBKEY,
                    tokenAmount: z.object({ amount: DigitString, decimals: z.number().int().min(0).max(38) }).passthrough(),
                  })
                  .passthrough(),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export function normalizeTokenAccounts(result: unknown, programId: string): { accounts: TokenAccountObservation[]; slot: bigint } {
  const r = z.object({ context: z.object({ slot: IntLike }).passthrough(), value: z.array(z.unknown()) }).passthrough().safeParse(result);
  if (!r.success) throw new ChainParseError("malformed token accounts response");
  const accounts: TokenAccountObservation[] = [];
  for (const raw of r.data.value) {
    const e = TokenAccountEntry.safeParse(raw);
    if (!e.success) throw new ChainParseError("malformed token account entry");
    const i = e.data.account.data.parsed.info;
    accounts.push({ tokenAccount: e.data.pubkey, mint: i.mint, owner: i.owner, amount: i.tokenAmount.amount, decimals: i.tokenAmount.decimals, programId });
  }
  return { accounts, slot: r.data.context.slot };
}

// ---------- Metaplex Token Metadata account (v1 layout) ----------
const clean = (s: string, max: number): string | null => {
  // strip NUL padding and control characters; the result is plain text that is only ever rendered as text.
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/\u0000+$/g, "").replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "").trim().slice(0, max);
  return t.length > 0 ? t : null;
};
const safeUri = (s: string | null): string | null => (s && /^(https:\/\/|ipfs:\/\/|ar:\/\/)[^\s<>"']{1,200}$/.test(s) ? s : null);

/**
 * Parses the data of a Metaplex metadata PDA. Everything here is attacker-controlled text (the update
 * authority writes it). We only extract bounded strings and strip control/bidi characters. The uri is kept as
 * inert text and is NEVER fetched by this system.
 */
export function parseMetaplexMetadata(data: Uint8Array): OnchainTokenMetadata | null {
  if (data.length < 1 + 32 + 32 + 4) return null;
  if (data[0] !== 4) return null; // Key::MetadataV1
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 1 + 32 + 32;
  const dec = new TextDecoder("utf-8", { fatal: false });
  const readStr = (max: number): string | null => {
    if (o + 4 > data.length) return null;
    const len = view.getUint32(o, true);
    o += 4;
    if (len > max * 4 || o + len > data.length) return null;
    const s = dec.decode(data.subarray(o, o + len));
    o += len;
    return s;
  };
  const name = readStr(32), symbol = readStr(10), uri = readStr(200);
  if (name === null || symbol === null || uri === null) return null;
  return { name: clean(name, 32), symbol: clean(symbol, 10), uri: safeUri(clean(uri, 200)), source: "metaplex_onchain" };
}
