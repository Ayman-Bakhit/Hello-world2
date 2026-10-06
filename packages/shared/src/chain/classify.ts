import {
  ASSOCIATED_TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM, KNOWN_DEX_PROGRAMS, MEMO_PROGRAMS, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM,
  type NormalizedTransaction,
} from "./types";
import { formatUnits } from "./units";

/**
 * CONSERVATIVE transaction classification. A label is only produced when the wallet's own balance changes AND the
 * programs involved make it unambiguous. Everything else is "unknown", on purpose.
 *
 * It describes WHAT MOVED for one wallet. It is NOT a tax classification: nothing here says a transaction is
 * taxable, a disposal, income, or a gift. The tax engine will consume these records later.
 */
export const CLASSIFIER_VERSION = "1";

export type TxClass = "transfer" | "swap" | "token_receipt" | "token_send" | "fee" | "unknown";

export interface AssetDelta {
  /** "native" for SOL, otherwise the mint address */
  asset: string;
  /** signed base units for THIS wallet. SOL excludes the network fee (reported separately). */
  delta: bigint;
  decimals: number;
}

export interface TxClassification {
  kind: TxClass;
  /** Human-readable evidence for the label. Always present, so every label is explainable. */
  reason: string;
  deltas: AssetDelta[];
  feeLamports: bigint;
  walletPaidFee: boolean;
  version: string;
}

const BENIGN = new Set([SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, ...MEMO_PROGRAMS, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ASSOCIATED_TOKEN_PROGRAM]);
const SOL_ONLY = new Set([SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, ...MEMO_PROGRAMS]);

const unknown = (reason: string, deltas: AssetDelta[], fee: bigint, paid: boolean): TxClassification => ({ kind: "unknown", reason, deltas, feeLamports: fee, walletPaidFee: paid, version: CLASSIFIER_VERSION });

export function classifyTransaction(wallet: string, tx: NormalizedTransaction): TxClassification {
  const fee = tx.fee;
  const paid = tx.accountKeys[0] === wallet;
  const idx = tx.accountKeys.indexOf(wallet);

  if (tx.failed) {
    return paid
      ? { kind: "fee", reason: "Transaction failed on-chain; the wallet paid only the network fee", deltas: [], feeLamports: fee, walletPaidFee: true, version: CLASSIFIER_VERSION }
      : unknown("Transaction failed on-chain and the wallet did not pay its fee", [], fee, false);
  }

  const deltas: AssetDelta[] = [];
  if (idx >= 0) {
    const raw = tx.postBalances[idx]! - tx.preBalances[idx]!;
    const nonFee = paid ? raw + fee : raw;
    if (nonFee !== 0n) deltas.push({ asset: "native", delta: nonFee, decimals: 9 });
  }
  // Token balance changes owned by the wallet, summed per mint across its token accounts.
  const byMint = new Map<string, { delta: bigint; decimals: number }>();
  const bump = (mint: string, d: bigint, decimals: number) => byMint.set(mint, { delta: (byMint.get(mint)?.delta ?? 0n) + d, decimals });
  for (const b of tx.preTokenBalances) if (b.owner === wallet) bump(b.mint, -b.amount, b.decimals);
  for (const b of tx.postTokenBalances) if (b.owner === wallet) bump(b.mint, b.amount, b.decimals);
  for (const [mint, v] of [...byMint].sort(([a], [b]) => a.localeCompare(b))) if (v.delta !== 0n) deltas.push({ asset: mint, delta: v.delta, decimals: v.decimals });

  const sol = deltas.find((d) => d.asset === "native");
  const tokens = deltas.filter((d) => d.asset !== "native");
  const programs = tx.programIds;
  const dex = programs.map((p) => KNOWN_DEX_PROGRAMS[p]).filter((n): n is string => Boolean(n));
  const only = (allowed: Set<string>) => programs.every((p) => allowed.has(p));
  const mk = (kind: TxClass, reason: string): TxClassification => ({ kind, reason, deltas, feeLamports: fee, walletPaidFee: paid, version: CLASSIFIER_VERSION });

  if (idx < 0 && tokens.length === 0) return unknown("Wallet is not an account in this transaction and no token balance is attributed to it", deltas, fee, paid);

  if (deltas.length === 0) {
    return paid
      ? mk("fee", "No asset movement for this wallet; it only paid the network fee")
      : unknown("No balance change attributable to this wallet", deltas, fee, paid);
  }

  if (tokens.length === 0 && sol) {
    return only(SOL_ONLY)
      ? mk("transfer", `${sol.delta > 0n ? "Received" : "Sent"} ${formatUnits(sol.delta < 0n ? -sol.delta : sol.delta, 9)} SOL; only the System Program (and compute/memo) was involved`)
      : unknown("SOL balance changed through programs other than the System Program", deltas, fee, paid);
  }

  if (!sol && tokens.length === 1 && only(BENIGN)) {
    const t = tokens[0]!;
    return mk(t.delta > 0n ? "token_receipt" : "token_send", `${t.delta > 0n ? "Received" : "Sent"} a single token (mint ${t.asset}) with only token/system programs involved`);
  }

  const out = deltas.filter((d) => d.delta < 0n), inn = deltas.filter((d) => d.delta > 0n);
  if (out.length > 0 && inn.length > 0) {
    if (dex.length > 0) return mk("swap", `Assets decreased (${out.length}) and increased (${inn.length}) through a recognized DEX program: ${[...new Set(dex)].join(", ")}`);
    return unknown("Some assets decreased and others increased, but no recognized DEX program was involved", deltas, fee, paid);
  }
  return unknown(
    sol && tokens.length > 0
      ? "SOL and token balances changed in the same direction; not enough evidence for a label"
      : "Token balances changed in a pattern this classifier does not label",
    deltas, fee, paid,
  );
}

/**
 * The asset shown in single-asset views: the largest token delta if any (by raw magnitude), else SOL, else the fee.
 * Display convenience only; the full delta list is always available.
 */
export function primaryDelta(c: Pick<TxClassification, "deltas">): AssetDelta | null {
  const token = c.deltas.filter((d) => d.asset !== "native").sort((a, b) => (a.delta === b.delta ? 0 : (a.delta < 0n ? -a.delta : a.delta) < (b.delta < 0n ? -b.delta : b.delta) ? 1 : -1))[0];
  return token ?? c.deltas.find((d) => d.asset === "native") ?? null;
}
